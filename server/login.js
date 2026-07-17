import { issueToken } from './_lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, password } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Enter your name' });

  const expected = process.env.TEAM_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'TEAM_PASSWORD is not configured on the server' });
  if (password !== expected) return res.status(401).json({ error: 'Wrong team password' });

  const cleanName = name.trim().slice(0, 60);
  return res.status(200).json({ token: issueToken(cleanName), name: cleanName });
}
