import { sql } from './_lib/db.js';
import { verifyVapiSecret } from './_lib/vapi.js';
import { whatsappConfigured, sendPortfolio } from './_lib/whatsapp.js';
import { toE164 } from './_lib/phone.js';

// Vapi calls this mid-conversation when the assistant uses a tool. The result
// strings are read back to the LLM, so they're written as instructions.
async function handleWhatsApp(call, args) {
  const target = args.number ? toE164(args.number) : call.phone;
  if (!target) return 'No valid WhatsApp number. Politely ask the lead to repeat the number digit by digit.';

  if (!whatsappConfigured()) {
    // Degrade gracefully: log a task for a human instead of failing the call.
    if (call.place_id) {
      await sql`insert into lead_notes (place_id, author, status, note)
                values (${call.place_id}, ${'AI Caller'}, null,
                        ${`Lead asked for the portfolio on WhatsApp (${target}) — WhatsApp API not configured, SEND MANUALLY.`})`;
    }
    await sql`insert into wa_sends (place_id, to_number, kind, status, error)
              values (${call.place_id}, ${target}, 'portfolio', 'manual', 'whatsapp not configured')`;
    await sql`update ai_calls set whatsapp_number = ${target}, updated_at = now() where id = ${call.id}`;
    return 'Noted — the team will send it within the hour. Tell the lead the portfolio is on its way from our official number, do not say it was already sent.';
  }

  try {
    await sendPortfolio(target, call.lead_name);
    await sql`insert into wa_sends (place_id, to_number, kind, status)
              values (${call.place_id}, ${target}, 'portfolio', 'sent')`;
    await sql`update ai_calls set whatsapp_sent = true, whatsapp_number = ${target}, updated_at = now()
              where id = ${call.id}`;
    return 'Sent. Tell the lead the portfolio just arrived on their WhatsApp and ask them to take a look after the call.';
  } catch (err) {
    await sql`insert into wa_sends (place_id, to_number, kind, status, error)
              values (${call.place_id}, ${target}, 'portfolio', 'failed', ${String(err.message).slice(0, 500)})`;
    if (call.place_id) {
      await sql`insert into lead_notes (place_id, author, status, note)
                values (${call.place_id}, ${'AI Caller'}, null,
                        ${`WhatsApp send to ${target} FAILED (${String(err.message).slice(0, 200)}) — send the portfolio manually.`})`;
    }
    return 'The send did not go through. Tell the lead the team will WhatsApp it shortly — do not retry on this call.';
  }
}

async function handleDoNotCall(call) {
  if (call.place_id) {
    await sql`update leads set do_not_call = true, updated_at = now() where place_id = ${call.place_id}`;
    await sql`insert into lead_notes (place_id, author, status, note)
              values (${call.place_id}, ${'AI Caller'}, null, ${'Lead asked not to be called again — do-not-call flag set.'})`;
  }
  return 'Flagged — this business will never be called again. Apologize briefly and end the call now.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyVapiSecret(req)) return res.status(401).json({ error: 'Bad webhook secret' });

  const m = req.body?.message || {};
  if (m.type !== 'tool-calls') return res.status(200).json({ ok: true, ignored: m.type });

  const vapiCallId = m.call?.id;
  const [call] = vapiCallId
    ? await sql`select * from ai_calls where vapi_call_id = ${vapiCallId}`
    : [];
  if (!call) return res.status(200).json({ results: [] });

  const toolCalls = m.toolCallList || m.toolCalls || [];
  const results = [];
  for (const tc of toolCalls) {
    const name = tc.name || tc.function?.name;
    let args = tc.arguments ?? tc.function?.arguments ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }

    let result;
    if (name === 'send_whatsapp_materials') result = await handleWhatsApp(call, args);
    else if (name === 'flag_do_not_call') result = await handleDoNotCall(call);
    else result = `Unknown tool ${name}. Continue the conversation without it.`;

    results.push({ toolCallId: tc.id, result });
  }

  return res.status(200).json({ results });
}
