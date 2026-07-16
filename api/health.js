import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { providerStatus, getUsage, BRAVE_MONTHLY_LIMIT } from './_lib/search.js';

// Reports what the server actually resolved from its environment, so a
// misnamed variable shows up as "not configured" instead of a confusing
// runtime failure. Never returns secret values — only whether they are set.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const providers = providerStatus();
  const [brave, google] = await Promise.all([getUsage('brave'), getUsage('google')]);

  let db = false;
  try { await sql`select 1`; db = true; } catch {}

  return res.status(200).json({
    database: db,
    google_maps: !!process.env.GOOGLE_MAPS_API_KEY,
    email: {
      smtp:    !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      manager: !!process.env.MANAGER_EMAIL,
      cron:    !!process.env.CRON_SECRET,
    },
    search: {
      brave_configured:  providers.brave,
      google_configured: providers.google,
      brave_used_this_month:  brave,
      brave_limit:            BRAVE_MONTHLY_LIMIT,
      brave_remaining:        Math.max(0, BRAVE_MONTHLY_LIMIT - brave),
      google_used_this_month: google,
      active_provider: providers.brave && brave < BRAVE_MONTHLY_LIMIT ? 'brave'
                     : providers.google ? 'google' : 'none',
    },
  });
}
