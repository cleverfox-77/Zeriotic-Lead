import { sql } from './db.js';

/**
 * A persona is what the employee trains: their pitch script, style notes, and
 * objection Q&A. buildSystemPrompt compiles the active persona + the lead's
 * data into the system prompt for one call. The guardrails here are fixed —
 * training can change what the AI says, never what it's allowed to do.
 */

export const DEFAULT_SCRIPT = `Introduce yourself and confirm you're speaking with someone from the business.
Say you're calling from Zeriotic, a web design agency in Dhaka.
The reason for the call: we noticed the business doesn't have its own website. Customers who search on Google right now find nothing they control — a professional website means more customers can find them, see their work and prices, and contact them directly.
If they have a Facebook page: acknowledge it's great they're active on Facebook, and explain a website works alongside it — Facebook reach is rented, a website is owned.
Goal of the call: get them interested enough to receive our portfolio on WhatsApp, or book a callback with a senior consultant.
If they ask about price: packages start affordable for small businesses, but exact pricing depends on what they need — the consultant will explain options on the follow-up call. Do not invent numbers.`;

export const DEFAULT_STYLE = `Warm, respectful, unhurried. Speak like a young Dhaka professional: Bangla sentences with natural English business words (website, Facebook page, customer, design). Address the person with respect (apni). Keep answers short — this is a phone call, not a lecture.`;

/** Latest active persona for this employee, else the team's latest, else the defaults. */
export async function activePersonaFor(owner) {
  const rows = await sql`
    select * from personas where status = 'active'
    order by (owner = ${owner}) desc, created_at desc limit 1`;
  if (rows.length) return rows[0];
  return { id: null, owner, version: 0, script: DEFAULT_SCRIPT, style_notes: DEFAULT_STYLE, qa_pairs: [] };
}

const clip = (s, n) => String(s || '').slice(0, n);

export function buildFirstMessage(lead) {
  const name = clip(lead?.name, 60);
  return name
    ? `Assalamu alaikum! Ami Zeriotic theke bolchi. ${name} er sathe ki kotha bolte parchi?`
    : `Assalamu alaikum! Ami Zeriotic theke bolchi. Ektu kotha bola jabe?`;
}

export function buildSystemPrompt(persona, lead, { callerName = '', isTest = false } = {}) {
  const qa = Array.isArray(persona.qa_pairs) ? persona.qa_pairs
    : (() => { try { return JSON.parse(persona.qa_pairs || '[]'); } catch { return []; } })();

  const leadBlock = lead ? [
    `Business name: ${clip(lead.name, 120)}`,
    lead.type ? `Category: ${clip(lead.type, 80)}` : '',
    lead.address ? `Address: ${clip(lead.address, 160)}` : '',
    lead.rating ? `Google rating: ${lead.rating} (${lead.reviews || 0} reviews)` : '',
    lead.facebook_url ? `They have a Facebook page: ${lead.facebook_url}` : 'No Facebook page found.',
    lead.instagram_url ? `They have Instagram: ${lead.instagram_url}` : '',
    `Key fact: our research found NO real website for this business. That is why we are calling.`,
  ].filter(Boolean).join('\n') : 'This is a TEST call to a team member, not a real lead. Run the pitch normally so they can evaluate it.';

  return `You are a business development executive making a phone call on behalf of Zeriotic, a web design agency in Dhaka, Bangladesh.${callerName ? ` You work with ${clip(callerName, 40)}'s team.` : ''}

LANGUAGE
Speak Banglish: natural spoken Bangla with everyday English business words mixed in, the way Dhaka professionals actually talk on the phone. If the person answers in pure English, switch to English. Keep every reply short — one to three sentences. Never read out URLs or spell things letter by letter.

THE LEAD
${leadBlock}

YOUR PITCH (follow this, in your own words)
${clip(persona.script, 4000)}

STYLE
${clip(persona.style_notes, 1500)}

${qa.length ? `OBJECTION HANDLING (trained answers — prefer these when the question matches)
${qa.slice(0, 20).map(p => `Q: ${clip(p.q, 200)}\nA: ${clip(p.a, 400)}`).join('\n')}
` : ''}WHATSAPP MATERIALS
If the lead asks for details, portfolio, examples, or pricing info in writing: first ask if the number you're calling has WhatsApp. If yes, use the send_whatsapp_materials tool. If no, ask which number has WhatsApp and pass it to the tool. After the tool confirms, tell them it's sent (or on its way) from our official number. Never promise anything the tool did not confirm.

HARD RULES — these override everything above
- If asked whether you are an AI or a robot, answer honestly and stay friendly.
- Never invent prices, discounts, client names, or deadlines that are not in the pitch above.
- If they say they are not interested, thank them politely and end the call — do not push twice.
- If they ask not to be called again, use the flag_do_not_call tool, apologize briefly, and end the call.
- If it is a wrong number or the person cannot talk, apologize and end the call quickly.
- Stay respectful in all circumstances, even if the person is rude.${isTest ? '\n- This is a test call: if asked, confirm it is a test of the Zeriotic AI caller.' : ''}`;
}
