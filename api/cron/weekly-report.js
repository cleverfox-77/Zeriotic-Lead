import { buildReport, renderReportHtml } from '../_lib/report.js';
import { sendMail } from '../_lib/mailer.js';

// Weekly summary, triggered by Vercel Cron (see `crons` in vercel.json).
//
// This route has no login, so it is gated on CRON_SECRET: Vercel sends
// `Authorization: Bearer <CRON_SECRET>` when that env var is set. Without the
// guard, anyone hitting the URL could spam your manager and your SMTP quota.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET is not configured on the server' });
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const data = await buildReport();
    const html = renderReportHtml(data, {
      title: 'Lead Agent — Weekly Report',
      period: `Week ending ${new Date().toLocaleDateString()}`,
    });

    const { recipient } = await sendMail({
      subject: `Weekly lead report — ${data.totals.new_this_week} new leads, ${data.totals.won} won`,
      html,
    });

    return res.status(200).json({ ok: true, sentTo: recipient, leads: data.totals.total_leads });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
