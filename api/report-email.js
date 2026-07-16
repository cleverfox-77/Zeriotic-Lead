import { requireAuth } from './_lib/auth.js';
import { buildReport, renderReportHtml } from './_lib/report.js';
import { sendMail } from './_lib/mailer.js';

// On-demand: the "Email to manager" button on the Reports page.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    const data = await buildReport();
    const html = renderReportHtml(data, {
      title: 'Lead Agent — Report',
      period: `Sent by ${session.name} on ${new Date().toLocaleString()}`,
    });

    const { recipient } = await sendMail({
      subject: `Lead Agent report — ${data.totals.total_leads} leads, ${data.totals.won} won`,
      html,
    });

    return res.status(200).json({ ok: true, sentTo: recipient });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
