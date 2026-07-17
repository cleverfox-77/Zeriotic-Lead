import { sql } from './db.js';

/** Builds the full report payload. Shared by /api/report, the email button, and the weekly cron. */
export async function buildReport() {
  const [byStatus, byEmployee, totals, activity, daily] = await Promise.all([
    sql`select status, count(*)::int as count from leads group by status order by count desc`,

    sql`select delivered_to as employee,
               count(*)::int as total,
               count(*) filter (where status = 'won')::int          as won,
               count(*) filter (where status = 'lost')::int         as lost,
               count(*) filter (where status = 'interested')::int   as interested,
               count(*) filter (where status = 'contacted')::int    as contacted,
               count(*) filter (where status = 'unqualified')::int  as unqualified,
               count(*) filter (where status = 'new')::int          as untouched
          from leads
         group by delivered_to
         order by total desc`,

    sql`select count(*)::int                                        as total_leads,
               count(*) filter (where confidence = 'high')::int     as true_leads,
               count(*) filter (where status = 'won')::int          as won,
               count(*) filter (where status <> 'new')::int         as worked,
               count(distinct delivered_to)::int                    as employees,
               count(*) filter (where delivered_at > now() - interval '7 days')::int as new_this_week
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
  return {
    byStatus,
    byEmployee,
    totals: {
      ...t,
      conversion: t.total_leads ? +((t.won / t.total_leads) * 100).toFixed(1) : 0,
      worked_pct: t.total_leads ? +((t.worked / t.total_leads) * 100).toFixed(1) : 0,
    },
    activity,
    daily,
  };
}

export const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** Plain, table-based HTML — the markup email clients actually render reliably. */
export function renderReportHtml(d, { title = 'Lead Agent Report', period = '' } = {}) {
  const cell = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;';
  const head = 'padding:8px 10px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;';

  const stat = (label, value) => `
    <td style="padding:12px;border:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:#0a0a0a;">${esc(value)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:3px;">${esc(label)}</div>
    </td>`;

  const employeeRows = d.byEmployee.map(e => `
    <tr>
      <td style="${cell}font-weight:600;">${esc(e.employee || '—')}</td>
      <td style="${cell}">${e.total}</td>
      <td style="${cell}${e.untouched > 0 ? 'color:#b45309;font-weight:600;' : ''}">${e.untouched}</td>
      <td style="${cell}">${e.contacted}</td>
      <td style="${cell}">${e.interested}</td>
      <td style="${cell}">${e.unqualified}</td>
      <td style="${cell}font-weight:600;">${e.won}</td>
      <td style="${cell}">${e.total ? ((e.won / e.total) * 100).toFixed(0) : 0}%</td>
    </tr>`).join('');

  const statusRows = d.byStatus.map(s => `
    <tr>
      <td style="${cell}">${esc(s.status.replace(/_/g, ' '))}</td>
      <td style="${cell}">${s.count}</td>
      <td style="${cell}">${d.totals.total_leads ? Math.round((s.count / d.totals.total_leads) * 100) : 0}%</td>
    </tr>`).join('');

  const activityRows = d.activity.slice(0, 15).map(a => `
    <tr>
      <td style="${cell}">${esc(a.author)}</td>
      <td style="${cell}">${esc(a.name)}</td>
      <td style="${cell}">${esc((a.status || '').replace(/_/g, ' '))}</td>
      <td style="${cell}color:#6b7280;">${esc(a.note || '').slice(0, 90)}</td>
      <td style="${cell}color:#9ca3af;white-space:nowrap;">${new Date(a.created_at).toLocaleDateString()}</td>
    </tr>`).join('');

  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#0a0a0a;">
  <div style="max-width:760px;margin:0 auto;padding:24px;">
    <h1 style="margin:0;font-size:18px;font-weight:700;">${esc(title)}</h1>
    <p style="margin:4px 0 20px;font-size:12px;color:#6b7280;">${esc(period)}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;"><tr>
      ${stat('Total leads', d.totals.total_leads)}
      ${stat('New this week', d.totals.new_this_week)}
      ${stat('Worked', d.totals.worked_pct + '%')}
      ${stat('Won', d.totals.won)}
      ${stat('Conversion', d.totals.conversion + '%')}
    </tr></table>

    <h2 style="font-size:14px;margin:0 0 8px;">By employee</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      <tr><th style="${head}">Employee</th><th style="${head}">Leads</th><th style="${head}">Untouched</th><th style="${head}">Contacted</th><th style="${head}">Interested</th><th style="${head}">Unqualified</th><th style="${head}">Won</th><th style="${head}">Win rate</th></tr>
      ${employeeRows || `<tr><td colspan="8" style="${cell}color:#9ca3af;">No leads yet.</td></tr>`}
    </table>

    <h2 style="font-size:14px;margin:0 0 8px;">Pipeline</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      <tr><th style="${head}">Status</th><th style="${head}">Count</th><th style="${head}">Share</th></tr>
      ${statusRows || `<tr><td colspan="3" style="${cell}color:#9ca3af;">No leads yet.</td></tr>`}
    </table>

    <h2 style="font-size:14px;margin:0 0 8px;">Recent activity</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><th style="${head}">Who</th><th style="${head}">Lead</th><th style="${head}">Status</th><th style="${head}">Note</th><th style="${head}">When</th></tr>
      ${activityRows || `<tr><td colspan="5" style="${cell}color:#9ca3af;">Nothing logged yet.</td></tr>`}
    </table>

    <p style="margin-top:24px;font-size:11px;color:#9ca3af;">Sent automatically by Lead Agent.</p>
  </div></body></html>`;
}
