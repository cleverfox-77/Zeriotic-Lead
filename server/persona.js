import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { DEFAULT_SCRIPT, DEFAULT_STYLE } from './_lib/persona.js';

const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY;

/**
 * The "learns from everything" loop, honestly implemented: Claude reads the
 * recent call transcripts and their outcomes, then proposes a sharper script
 * and style notes. The proposal lands as a DRAFT version — the AI never
 * changes its own pitch without a human clicking Activate.
 */
async function improveFromCalls(owner) {
  if (!ANTHROPIC_KEY()) {
    const err = new Error('Self-improvement needs ANTHROPIC_API_KEY set in Vercel.');
    err.status = 500;
    throw err;
  }

  const calls = await sql`
    select lead_name, outcome, interest_level, summary, transcript, duration_seconds
    from ai_calls
    where status = 'ended' and transcript is not null and is_test = false
    order by created_at desc limit 10`;
  if (calls.length < 3) {
    const err = new Error(`Need at least 3 completed real calls with transcripts to learn from (have ${calls.length}). Make some calls first.`);
    err.status = 400;
    throw err;
  }

  const [current] = await sql`
    select * from personas where status = 'active'
    order by (owner = ${owner}) desc, created_at desc limit 1`;
  const script = current?.script || DEFAULT_SCRIPT;
  const style  = current?.style_notes || DEFAULT_STYLE;

  const callDigest = calls.map((c, i) =>
    `### Call ${i + 1} — ${c.lead_name} | outcome: ${c.outcome || 'unknown'} | interest: ${c.interest_level ?? '?'}/10 | ${c.duration_seconds || 0}s
${String(c.transcript).slice(0, 3000)}`).join('\n\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are improving the pitch of an AI cold-caller that sells websites to small Dhaka businesses in Banglish. Study these real call transcripts and outcomes, find what worked and what lost people, and rewrite the pitch.

CURRENT SCRIPT:
${script}

CURRENT STYLE NOTES:
${style}

RECENT CALLS:
${callDigest}

Reply with ONLY a JSON object, no markdown fences:
{"script": "<improved pitch script, same structure and length ballpark as the current one>", "style_notes": "<improved style notes>", "rationale": "<3-5 bullet points: what you changed and which call evidence drove each change>"}`,
      }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Anthropic API error: ${body.error?.message || `HTTP ${r.status}`}`);
    err.status = 502;
    throw err;
  }

  const text = body.content?.map(b => b.text || '').join('') || '';
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ''));
  } catch {
    const err = new Error('The model returned an unparseable proposal — try again.');
    err.status = 502;
    throw err;
  }
  if (!parsed.script) {
    const err = new Error('The proposal had no script — try again.');
    err.status = 502;
    throw err;
  }
  return { ...parsed, calls_analyzed: calls.length };
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const personas = await sql`
      select id, owner, version, script, style_notes, qa_pairs, status, source, created_at
      from personas where owner = ${session.name} or status = 'active'
      order by created_at desc limit 30`;
    return res.status(200).json({
      personas,
      defaults: { script: DEFAULT_SCRIPT, style_notes: DEFAULT_STYLE },
      anthropic: !!ANTHROPIC_KEY(),
    });
  }

  if (req.method === 'POST') {
    const { improve, script, style_notes, qa_pairs } = req.body || {};

    if (improve) {
      try {
        const p = await improveFromCalls(session.name);
        const [{ v }] = await sql`select coalesce(max(version), 0) + 1 as v from personas where owner = ${session.name}`;
        const [draft] = await sql`
          insert into personas (owner, version, script, style_notes, qa_pairs, status, source)
          values (${session.name}, ${v}, ${String(p.script).slice(0, 8000)}, ${String(p.style_notes || '').slice(0, 3000)},
                  ${JSON.stringify([])}, 'draft', 'ai_improved')
          returning *`;
        return res.status(200).json({ draft, rationale: p.rationale || '', calls_analyzed: p.calls_analyzed });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }

    if (!script || !String(script).trim()) return res.status(400).json({ error: 'The script cannot be empty.' });
    const qa = Array.isArray(qa_pairs)
      ? qa_pairs.filter(p => p && p.q && p.a).map(p => ({ q: String(p.q).slice(0, 300), a: String(p.a).slice(0, 600) })).slice(0, 20)
      : [];
    const [{ v }] = await sql`select coalesce(max(version), 0) + 1 as v from personas where owner = ${session.name}`;
    await sql`update personas set status = 'archived' where owner = ${session.name} and status = 'active'`;
    const [row] = await sql`
      insert into personas (owner, version, script, style_notes, qa_pairs, status, source)
      values (${session.name}, ${v}, ${String(script).slice(0, 8000)}, ${String(style_notes || '').slice(0, 3000)},
              ${JSON.stringify(qa)}, 'active', 'manual')
      returning *`;
    return res.status(200).json({ persona: row });
  }

  if (req.method === 'PATCH') {
    const { id, action } = req.body || {};
    const [row] = await sql`select * from personas where id = ${id} and owner = ${session.name}`;
    if (!row) return res.status(404).json({ error: 'Version not found' });

    if (action === 'activate') {
      await sql`update personas set status = 'archived' where owner = ${session.name} and status = 'active'`;
      await sql`update personas set status = 'active' where id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'discard') {
      await sql`delete from personas where id = ${id} and status = 'draft'`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
