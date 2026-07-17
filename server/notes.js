import { requireAuth } from './_lib/auth.js';
import { sql, STATUSES } from './_lib/db.js';

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  // ── Activity trail for one lead ───────────────────────────────────────────
  if (req.method === 'GET') {
    const { place_id } = req.query || {};
    if (!place_id) return res.status(400).json({ error: 'place_id is required' });
    const notes = await sql`
      select id, author, status, note, created_at
        from lead_notes
       where place_id = ${place_id}
       order by created_at desc`;
    return res.status(200).json({ notes });
  }

  // ── Record a call outcome / note (optionally moving the lead's status) ─────
  if (req.method === 'POST') {
    const { place_id, note = '', status } = req.body || {};
    if (!place_id)   return res.status(400).json({ error: 'place_id is required' });
    if (!note.trim() && !status) return res.status(400).json({ error: 'Write a note or set a status' });
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    if (status) {
      await sql`update leads set status = ${status}, updated_at = now() where place_id = ${place_id}`;
    } else {
      await sql`update leads set updated_at = now() where place_id = ${place_id}`;
    }

    const [row] = await sql`
      insert into lead_notes (place_id, author, status, note)
      values (${place_id}, ${session.name}, ${status || null}, ${note.trim()})
      returning id, author, status, note, created_at`;

    return res.status(200).json({ note: row });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
