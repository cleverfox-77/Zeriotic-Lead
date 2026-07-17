import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { providerStatus, getUsage, createSearcher, extractSocials, TAVILY_MONTHLY_LIMIT } from './_lib/search.js';
import { vapiStatus, vapiConfigured } from './_lib/vapi.js';
import { whatsappStatus, whatsappConfigured } from './_lib/whatsapp.js';
import { usageThisMonth, withinCallingHours } from './calls.js';

// Placeholders people paste in by mistake. The command from the README is the
// big one — pasting it instead of running it leaves the signing key set to a
// string that is published in this repo's .env.example.
const PLACEHOLDER_SECRET = /node -e|randomBytes|changeme|change-me|dev-only|your-secret|placeholder|example/i;

function secretQuality(value) {
  if (!value) return { ok: false, why: 'not set' };
  if (PLACEHOLDER_SECRET.test(value)) {
    return { ok: false, why: 'looks like a placeholder or the generator command pasted instead of run — anyone reading the public repo could guess it and forge logins' };
  }
  if (value.length < 32) return { ok: false, why: `only ${value.length} characters — short enough to brute-force; use 64 hex chars` };
  return { ok: true };
}

// Reports what the server actually resolved from its environment, so a misnamed
// or mis-pasted variable shows up plainly instead of as a confusing runtime
// failure. Never returns secret values — only whether they look sane.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const providers = providerStatus();
  const [tavily, serper] = await Promise.all([getUsage('tavily'), getUsage('serper')]);

  let db = false;
  try { await sql`select 1`; db = true; } catch {}

  // ?test=Some Business Name — runs ONE real search so you can confirm the
  // provider is actually returning Facebook/Instagram pages. Costs one query.
  let test;
  if (req.query?.test) {
    const name = String(req.query.test).slice(0, 100);
    try {
      const searcher = await createSearcher();
      const { results, provider } = await searcher.searchSocials(name, String(req.query.city || ''));
      await searcher.flush();
      test = {
        query_name: name,
        provider,
        raw_result_count: results.length,
        raw_urls: results.slice(0, 10).map(r => r.url),
        extracted: extractSocials(results, name),
        hint: results.length === 0
          ? 'The provider answered but found nothing for this business. Try one you know has a Facebook page.'
          : undefined,
      };
    } catch (err) {
      const d = err.details || {};
      let fix;
      if (d.http_status === 401 || /unauthor|invalid.*key|api key/i.test(err.message)) {
        fix = 'The API key was rejected. Check TAVILY_API_KEY / SERPER_API_KEY in Vercel (no quotes, no trailing spaces), then redeploy.';
      } else if (d.http_status === 429 || /quota|limit|credit/i.test(err.message)) {
        fix = 'Out of credits for this provider. Tavily resets monthly; Serper needs credits topped up. The app falls over to the other provider automatically when one is exhausted.';
      } else if (/No search provider configured/.test(err.message)) {
        fix = 'Set TAVILY_API_KEY (free, 1,000/month) and/or SERPER_API_KEY in Vercel, then redeploy.';
      }
      test = { query_name: name, error: err.message, error_details: d, fix };
    }
  }

  // AI-caller readiness. Cheap queries, and only when the tables exist —
  // a deployment that hasn't run the migration yet must not break Setup.
  let ai = {
    vapi: vapiStatus(),
    vapi_ready: vapiConfigured(),
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    whatsapp: whatsappStatus(),
    whatsapp_ready: whatsappConfigured(),
    calling_hours_now: withinCallingHours(),
  };
  try {
    const [usage, [voice]] = await Promise.all([
      usageThisMonth(),
      sql`select voice_id from voice_profiles where owner = ${session.name}`,
    ]);
    ai = { ...ai, usage, voice_trained: !!voice, migrated: true };
  } catch {
    ai = { ...ai, migrated: false };
  }

  return res.status(200).json({
    ...(test ? { test } : {}),
    ai,
    database: db,
    google_maps: !!process.env.GOOGLE_MAPS_API_KEY,
    security: {
      session_secret: secretQuality(process.env.SESSION_SECRET),
      cron_secret:    secretQuality(process.env.CRON_SECRET),
    },
    email: {
      smtp:    !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      manager: !!process.env.MANAGER_EMAIL,
      cron:    !!process.env.CRON_SECRET,
    },
    search: {
      tavily_configured: providers.tavily,
      serper_configured: providers.serper,
      tavily_used_this_month: tavily,
      tavily_limit:           TAVILY_MONTHLY_LIMIT,
      tavily_remaining:       Math.max(0, TAVILY_MONTHLY_LIMIT - tavily),
      serper_used_this_month: serper,
      active_provider: providers.tavily && tavily < TAVILY_MONTHLY_LIMIT ? 'tavily'
                     : providers.serper ? 'serper' : 'none',
    },
  });
}
