import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { toE164 } from './_lib/phone.js';
import { vapiConfigured, buildAssistant, createVapiCall } from './_lib/vapi.js';
import { activePersonaFor, buildSystemPrompt, buildFirstMessage } from './_lib/persona.js';

// Every guard lives server-side: the monthly budget, the daily cap, one call
// at a time, Dhaka business hours, and the do-not-call flag. The UI shows why
// a call was refused, but it can't bypass any of it.
export const EST_CALL_COST = 0.6; // reserved per in-flight call until Vapi reports actual cost
const budgetCap = () => Number(process.env.AI_CALL_MONTHLY_BUDGET || 50);
const dailyMax  = () => Number(process.env.AI_CALL_DAILY_MAX || 15);

export function withinCallingHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka', hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour').value) % 24;
  const day  = parts.find(p => p.type === 'weekday').value;
  if (day === 'Fri') return false; // the weekly holiday in Bangladesh
  return hour >= 10 && hour < 19;
}

export async function usageThisMonth() {
  const [row] = await sql`
    select
      coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now())), 0)::float as spent,
      count(*) filter (where status in ('queued','ringing','in-progress')
                       and updated_at > now() - interval '15 minutes')::int as in_flight,
      count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Dhaka')
                                            at time zone 'Asia/Dhaka')::int as today
    from ai_calls`;
  return {
    spent: +(+row.spent).toFixed(2),
    reserved: row.in_flight * EST_CALL_COST,
    in_flight: row.in_flight,
    today: row.today,
    budget: budgetCap(),
    daily_max: dailyMax(),
  };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const { place_id } = req.query || {};
    const calls = place_id
      ? await sql`select * from ai_calls where place_id = ${place_id} order by created_at desc limit 50`
      : await sql`select c.*, l.name as lead_current_name from ai_calls c
                  left join leads l on l.place_id = c.place_id
                  order by c.created_at desc limit 50`;
    return res.status(200).json({ calls, usage: await usageThisMonth() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!vapiConfigured()) {
    return res.status(500).json({
      error: 'AI calling is not configured. Set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID and VAPI_WEBHOOK_SECRET in Vercel, then redeploy.',
    });
  }

  const { place_id, test_number } = req.body || {};
  const isTest = !!test_number && !place_id;

  let lead = null;
  let number;
  if (isTest) {
    number = toE164(test_number);
    if (!number) return res.status(400).json({ error: 'That test number does not look like a phone number.' });
  } else {
    if (!place_id) return res.status(400).json({ error: 'place_id is required' });
    [lead] = await sql`select * from leads where place_id = ${place_id}`;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.do_not_call) return res.status(400).json({ error: `${lead.name} asked not to be called. The AI will not dial this lead.` });
    number = toE164(lead.phone);
    if (!number) return res.status(400).json({ error: 'This lead has no usable phone number.' });
    if (!withinCallingHours()) {
      return res.status(400).json({ error: 'Outside calling hours (10:00–19:00 Dhaka time, closed Friday). Leads only get called when a human could have.' });
    }
  }

  const usage = await usageThisMonth();
  if (usage.in_flight > 0) {
    return res.status(409).json({ error: 'A call is already in progress — the pilot runs one call at a time. Try again in a minute.' });
  }
  if (!isTest && usage.today >= usage.daily_max) {
    return res.status(429).json({ error: `Daily limit reached (${usage.daily_max} calls). Resets at midnight Dhaka time.` });
  }
  if (usage.spent + usage.reserved + EST_CALL_COST > usage.budget) {
    return res.status(429).json({ error: `Monthly AI-call budget reached ($${usage.spent.toFixed(2)} of $${usage.budget}). Raise AI_CALL_MONTHLY_BUDGET to continue.` });
  }

  const persona = await activePersonaFor(session.name);
  const [voice] = await sql`select voice_id from voice_profiles where owner = ${session.name}`;
  const serverUrl = process.env.APP_URL || `https://${req.headers.host}`;

  const assistant = buildAssistant({
    systemPrompt: buildSystemPrompt(persona, lead, { callerName: session.name, isTest }),
    firstMessage: buildFirstMessage(lead),
    voiceId: voice?.voice_id || null,
    serverUrl,
  });

  const [row] = await sql`
    insert into ai_calls (place_id, lead_name, phone, started_by, is_test, status)
    values (${lead?.place_id || null}, ${lead?.name || 'Test call'}, ${number}, ${session.name}, ${isTest}, 'queued')
    returning id`;

  try {
    const call = await createVapiCall({ assistant, customerNumber: number, customerName: lead?.name });
    await sql`update ai_calls set vapi_call_id = ${call.id}, status = 'ringing', updated_at = now() where id = ${row.id}`;
    return res.status(200).json({ ok: true, call_id: row.id, vapi_call_id: call.id, usage: await usageThisMonth() });
  } catch (err) {
    await sql`update ai_calls set status = 'failed', ended_reason = ${String(err.message).slice(0, 500)}, updated_at = now() where id = ${row.id}`;
    return res.status(502).json({ error: err.message, details: err.details });
  }
}
