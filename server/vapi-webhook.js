import { sql, STATUSES } from './_lib/db.js';
import { verifyVapiSecret } from './_lib/vapi.js';
import { sendMail } from './_lib/mailer.js';
import { esc } from './_lib/report.js';

// Vapi's structured outcome → our pipeline status. Only statuses a human
// hasn't already escalated past get overwritten (never won/lost/quoted).
const OUTCOME_TO_STATUS = {
  interested: 'interested',
  callback: 'callback',
  not_interested: 'not_interested',
  unqualified: 'unqualified',
  do_not_call: 'not_interested',
};
const PROTECTED = ['won', 'lost', 'quoted'];
const POSITIVE = ['interested', 'callback'];

function pickReport(m) {
  const analysis = m.analysis || {};
  const artifact = m.artifact || {};
  const sd = analysis.structuredData || {};
  return {
    endedReason: m.endedReason || null,
    summary: analysis.summary || m.summary || null,
    transcript: artifact.transcript || m.transcript || null,
    recordingUrl: artifact.recordingUrl || m.recordingUrl || null,
    cost: Number.isFinite(+m.cost) ? +m.cost : 0,
    durationSeconds: Math.round(+m.durationSeconds || +m.durationMs / 1000 || 0) || null,
    outcome: sd.outcome || null,
    interest: Number.isFinite(+sd.interest_level) ? Math.round(+sd.interest_level) : null,
    positive: !!sd.positive,
    callbackAt: sd.callback_at || null,
    whatsappNumber: sd.whatsapp_number || null,
    keyPoints: sd.key_points || null,
  };
}

async function emailManager(call, r) {
  const rows = [
    ['Business', call.lead_name],
    ['Phone', call.phone],
    ['Outcome', r.outcome || '—'],
    ['Interest', r.interest != null ? `${r.interest}/10` : '—'],
    ['Callback', r.callbackAt || '—'],
    ['Duration', r.durationSeconds ? `${Math.round(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : '—'],
    ['Started by', call.started_by],
  ].map(([k, v]) => `<tr><td style="padding:6px 10px;color:#6b7280;font-size:12px;">${esc(k)}</td><td style="padding:6px 10px;font-size:13px;font-weight:600;">${esc(v)}</td></tr>`).join('');

  await sendMail({
    subject: `🔥 AI call: ${call.lead_name} — ${r.outcome || 'positive'}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;">
      <h2 style="font-size:16px;">Positive AI call result</h2>
      <table style="border:1px solid #e5e7eb;border-collapse:collapse;">${rows}</table>
      ${r.summary ? `<p style="font-size:13px;"><strong>Summary:</strong> ${esc(r.summary)}</p>` : ''}
      ${r.keyPoints ? `<p style="font-size:13px;"><strong>Key points:</strong> ${esc(r.keyPoints)}</p>` : ''}
      ${r.recordingUrl ? `<p style="font-size:12px;"><a href="${esc(r.recordingUrl)}">Call recording</a></p>` : ''}
    </div>`,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyVapiSecret(req)) return res.status(401).json({ error: 'Bad webhook secret' });

  const m = req.body?.message || {};
  const vapiCallId = m.call?.id;
  if (!vapiCallId) return res.status(200).json({ ok: true, ignored: 'no call id' });

  if (m.type === 'status-update') {
    const status = String(m.status || '').slice(0, 40);
    if (status && status !== 'ended') {
      await sql`update ai_calls set status = ${status}, updated_at = now()
                where vapi_call_id = ${vapiCallId} and status <> 'ended'`;
    }
    return res.status(200).json({ ok: true });
  }

  if (m.type !== 'end-of-call-report') return res.status(200).json({ ok: true, ignored: m.type });

  const r = pickReport(m);

  // Idempotent: Vapi retries webhooks; only the first transition to 'ended'
  // writes the report, updates the lead, and can email the manager.
  const [call] = await sql`
    update ai_calls set
      status = 'ended', ended_reason = ${r.endedReason}, outcome = ${r.outcome},
      interest_level = ${r.interest}, summary = ${r.summary}, transcript = ${r.transcript},
      recording_url = ${r.recordingUrl}, duration_seconds = ${r.durationSeconds},
      cost_usd = ${r.cost}, callback_at = ${r.callbackAt},
      whatsapp_number = coalesce(${r.whatsappNumber}, whatsapp_number),
      updated_at = now()
    where vapi_call_id = ${vapiCallId} and status <> 'ended'
    returning *`;
  if (!call) return res.status(200).json({ ok: true, duplicate: true });

  if (call.place_id && !call.is_test) {
    if (r.outcome === 'do_not_call') {
      await sql`update leads set do_not_call = true, updated_at = now() where place_id = ${call.place_id}`;
    }
    let newStatus = OUTCOME_TO_STATUS[r.outcome];
    // A real conversation happened but no clear label → at least mark contacted.
    if (!newStatus && r.durationSeconds > 30 && r.outcome !== 'no_answer') newStatus = 'contacted';
    if (newStatus && STATUSES.includes(newStatus)) {
      await sql`update leads set status = ${newStatus}, updated_at = now()
                where place_id = ${call.place_id} and status not in ('won','lost','quoted')`;
    }

    const noteBits = [
      `AI call ${r.outcome ? `— ${r.outcome}` : 'ended'}${r.interest != null ? ` (interest ${r.interest}/10)` : ''}.`,
      r.summary || '',
      r.callbackAt ? `Callback: ${r.callbackAt}` : '',
      r.keyPoints ? `Notes: ${r.keyPoints}` : '',
    ].filter(Boolean).join(' ');
    await sql`insert into lead_notes (place_id, author, status, note)
              values (${call.place_id}, ${'AI Caller'}, ${newStatus || null}, ${noteBits.slice(0, 2000)})`;
  }

  if ((r.positive || POSITIVE.includes(r.outcome)) && !call.is_test) {
    try {
      await emailManager(call, r);
      await sql`update ai_calls set manager_emailed = true where id = ${call.id}`;
    } catch {
      // Email is best-effort — a broken SMTP config must never lose the call report.
    }
  }

  return res.status(200).json({ ok: true });
}
