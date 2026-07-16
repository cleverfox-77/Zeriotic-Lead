import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || '';

const sign = data => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueToken(name, ttlHours = 12) {
  const payload = Buffer.from(JSON.stringify({ name, exp: Date.now() + ttlHours * 3600e3 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || !SECRET) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  // timingSafeEqual throws on length mismatch, so guard first.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return !o.exp || Date.now() > o.exp ? null : o;
  } catch { return null; }
}

/** Returns the session, or writes a 401 and returns null. */
export function requireAuth(req, res) {
  const h = req.headers.authorization || '';
  const session = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!session) { res.status(401).json({ error: 'Not signed in' }); return null; }
  return session;
}
