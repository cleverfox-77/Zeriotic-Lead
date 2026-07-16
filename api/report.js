import { requireAuth } from './_lib/auth.js';
import { buildReport } from './_lib/report.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    return res.status(200).json(await buildReport());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
