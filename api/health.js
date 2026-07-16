import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { providerStatus, getUsage, createSearcher, extractSocials, cseKeySource, BRAVE_MONTHLY_LIMIT } from './_lib/search.js';

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

  // ?test=Some Business Name — runs ONE real search so you can confirm the
  // search engine is actually configured to return Facebook/Instagram pages.
  // Costs one query against your quota. Returns raw URLs so a misconfigured CSE
  // (e.g. no sites added) shows up as an empty result rather than a silent
  // "no socials found" on every lead.
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
          ? 'Zero results. If using Google CSE, add facebook.com and instagram.com under "Sites to search".'
          : undefined,
      };
    } catch (err) {
      // Turn Google's terse setup errors into the actual fix.
      let fix;
      if (/does not have.*access|has not been used|is disabled|blocked/i.test(err.message)) {
        fix = 'Enable "Custom Search API" at console.cloud.google.com/apis/library/customsearch.googleapis.com '
            + 'for the project that owns this key — and if the key has API restrictions, add Custom Search API '
            + 'to its allowed list.';
      } else if (/API key not valid|invalid key/i.test(err.message)) {
        fix = 'The search API key is not valid for Custom Search. Check GOOGLE_CSE_API_KEY in Vercel.';
      } else if (/Invalid Value|invalid argument/i.test(err.message)) {
        fix = 'The search engine ID (GOOGLE_CSE_ID) looks wrong. Copy it from programmablesearchengine.google.com.';
      }
      test = { query_name: name, error: err.message, fix };
    }
  }

  return res.status(200).json({
    ...(test ? { test } : {}),
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
      // Which env var the CSE key actually came from. If this says
      // GOOGLE_MAPS_API_KEY, no dedicated search key was set and the Maps key is
      // being reused — it needs Custom Search API enabled *and* allowed by the
      // key's API restrictions.
      cse_key_source: cseKeySource(),
      brave_used_this_month:  brave,
      brave_limit:            BRAVE_MONTHLY_LIMIT,
      brave_remaining:        Math.max(0, BRAVE_MONTHLY_LIMIT - brave),
      google_used_this_month: google,
      active_provider: providers.brave && brave < BRAVE_MONTHLY_LIMIT ? 'brave'
                     : providers.google ? 'google' : 'none',
    },
  });
}
