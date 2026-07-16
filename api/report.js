import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const [byStatus, byEmployee, totals, activity, daily] = await Promise.all([
    sql`select status, count(*)::int as count from leads group by status order by count desc`,

    sql`select delivered_to as employee,
               count(*)::int as total,
               count(*) filter (where status = 'won')::int          as won,
               count(*) filter (where status = 'lost')::int         as lost,
               count(*) filter (where status = 'interested')::int   as interested,
               count(*) filter (where status = 'contacted')::int    as contacted,
               count(*) filter (where status = 'new')::int          as untouched
          from leads
         group by delivered_to
         order by total desc`,

    sql`select count(*)::int                                        as total_leads,
               count(*) filter (where confidence = 'high')::int     as true_leads,
               count(*) filter (where status = 'won')::int          as won,
               count(*) filter (where status <> 'new')::int         as worked,
               count(distinct delivered_to)::int                    as employees
          from leads`,

    sql`select n.id, n.place_id, n.author, n.status, n.note, n.created_at, l.name
          from lead_notes n
          join leads l on l.place_id = n.place_id
         order by n.created_at desc
         limit 30`,

    sql`select to_char(delivered_at::date, 'YYYY-MM-DD') as day, count(*)::int as count
          from leads
         where delivered_at > now() - interval '14 days'
         group by day
         order by day`,
  ]);

  const t = totals[0] || {};
  return res.status(200).json({
    byStatus,
    byEmployee,
    totals: {
      ...t,
      conversion: t.total_leads ? +((t.won / t.total_leads) * 100).toFixed(1) : 0,
      worked_pct: t.total_leads ? +((t.worked / t.total_leads) * 100).toFixed(1) : 0,
    },
    activity,
    daily,
  });
}
