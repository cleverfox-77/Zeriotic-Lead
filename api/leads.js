import { requireAuth } from './_lib/auth.js';
import { sql, STATUSES } from './_lib/db.js';

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  // ── List leads, with filtering ────────────────────────────────────────────
  if (req.method === 'GET') {
    const { status = '', owner = '', confidence = '', q = '', minRating = '', minReviews = '', social = '', limit = '500' } = req.query || {};
    const where = [], params = [];
    const add = (clause, val) => { params.push(val); where.push(clause.replace('?', `$${params.length}`)); };

    if (status)     add('l.status = ?', status);
    if (owner)      add('l.delivered_to = ?', owner);
    if (confidence) add('l.confidence = ?', confidence);
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(l.name ilike ${p} or l.address ilike ${p} or l.phone ilike ${p})`);
    }
    if (minRating)  add('coalesce(l.rating,0) >= ?', Number(minRating));
    if (minReviews) add('coalesce(l.reviews,0) >= ?', Number(minReviews));

    // 'hot' = has a Facebook page but no website of their own: the best pitch.
    if (social === 'hot')       where.push(`(l.facebook_url is not null and l.confidence = 'high')`);
    else if (social === 'has')  where.push(`(l.facebook_url is not null or l.instagram_url is not null)`);
    else if (social === 'none') where.push(`(l.facebook_url is null and l.instagram_url is null)`);
    else if (social === 'unchecked') where.push(`l.socials_checked_at is null`);

    params.push(Math.min(Number(limit) || 500, 2000));
    const rows = await sql.query(
      `select l.*,
              (select count(*)::int from lead_notes n where n.place_id = l.place_id) as note_count,
              (select n.note from lead_notes n where n.place_id = l.place_id order by n.created_at desc limit 1) as last_note
         from leads l
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by l.updated_at desc
        limit $${params.length}`,
      params,
    );
    return res.status(200).json({ leads: rows });
  }

  // ── Update a lead's status (also logged to the activity trail) ─────────────
  if (req.method === 'PATCH') {
    const { place_id, status, note = '' } = req.body || {};
    if (!place_id) return res.status(400).json({ error: 'place_id is required' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });

    const updated = await sql`
      update leads set status = ${status}, updated_at = now()
       where place_id = ${place_id}
       returning place_id`;
    if (!updated.length) return res.status(404).json({ error: 'Lead not found' });

    await sql`
      insert into lead_notes (place_id, author, status, note)
      values (${place_id}, ${session.name}, ${status}, ${note})`;

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
