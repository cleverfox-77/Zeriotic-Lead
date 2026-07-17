import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const XI = 'https://api.elevenlabs.io/v1';
const KEY = () => process.env.ELEVENLABS_API_KEY;

// Instant voice clone from ~60–90s of speech recorded in the browser. The
// audio goes straight to ElevenLabs; we only keep the returned voice_id.
export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const [profile] = await sql`select owner, voice_id, voice_name, created_at from voice_profiles where owner = ${session.name}`;
    return res.status(200).json({ profile: profile || null, elevenlabs: !!KEY() });
  }

  if (req.method === 'DELETE') {
    const [old] = await sql`delete from voice_profiles where owner = ${session.name} returning voice_id`;
    if (old && KEY()) {
      // Best effort — an orphaned clone at ElevenLabs is harmless.
      await fetch(`${XI}/voices/${old.voice_id}`, { method: 'DELETE', headers: { 'xi-api-key': KEY() } }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!KEY()) return res.status(500).json({ error: 'Voice training is not configured — set ELEVENLABS_API_KEY in Vercel, then redeploy.' });

  const { audio, mime } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'No audio received' });

  const b64 = String(audio).replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 50_000) return res.status(400).json({ error: 'Recording too short — speak for at least 60 seconds so the clone sounds like you.' });
  if (bytes.length > 3_500_000) return res.status(400).json({ error: 'Recording too large — keep it under ~2 minutes.' });

  const form = new FormData();
  form.append('name', `lead-agent-${session.name}`.slice(0, 60));
  form.append('description', `Voice clone for ${session.name} (Zeriotic Lead Agent)`);
  form.append('files', new Blob([bytes], { type: mime || 'audio/webm' }), 'sample.webm');

  const r = await fetch(`${XI}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY() },
    body: form,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body.detail?.message || body.detail || `HTTP ${r.status}`;
    return res.status(502).json({ error: `ElevenLabs rejected the sample: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` });
  }

  // Replacing an old clone: remove it at ElevenLabs so free-tier voice slots don't fill up.
  const [old] = await sql`select voice_id from voice_profiles where owner = ${session.name}`;
  if (old && old.voice_id !== body.voice_id) {
    await fetch(`${XI}/voices/${old.voice_id}`, { method: 'DELETE', headers: { 'xi-api-key': KEY() } }).catch(() => {});
  }

  await sql`insert into voice_profiles (owner, voice_id, voice_name)
            values (${session.name}, ${body.voice_id}, ${`lead-agent-${session.name}`})
            on conflict (owner) do update set voice_id = ${body.voice_id}, created_at = now()`;

  return res.status(200).json({ ok: true, voice_id: body.voice_id });
}
