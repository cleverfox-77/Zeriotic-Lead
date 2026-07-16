import { sql } from './db.js';
import { stripName } from './leadgen.js';

// Env names vary, so accept the common spellings rather than failing silently
// on a near-miss. /api/health reports what the server actually resolved.
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY
               || process.env.BRAVE_SEARCH_KEY    || process.env.BRAVE_KEY;

// Falls back to the Maps key, which works ONLY if that key's project has Custom
// Search API enabled AND the key's API restrictions allow it. Reported by
// /api/health as `cse_key_source` so a silent fallback isn't mistaken for real
// configuration.
const CSE_KEY_SOURCE = ['GOOGLE_CSE_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_CSE_KEY',
                        'GOOGLE_CUSTOM_SEARCH_KEY', 'GOOGLE_MAPS_API_KEY']
                        .find(n => process.env[n]) || null;
const CSE_KEY = CSE_KEY_SOURCE ? process.env[CSE_KEY_SOURCE] : undefined;

export const cseKeySource = () => CSE_KEY_SOURCE;

const CSE_CX    = process.env.GOOGLE_CSE_ID       || process.env.GOOGLE_CSE_CX
               || process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CX;

// Switch to Google before Brave's free 2,000/month actually runs out.
export const BRAVE_MONTHLY_LIMIT   = Number(process.env.BRAVE_MONTHLY_LIMIT || 1900);
// Brave's free tier allows 1 query/second. This is the whole reason social
// lookup is a separate batched step instead of running inline in a scan.
const BRAVE_MIN_INTERVAL_MS = Number(process.env.BRAVE_MIN_INTERVAL_MS || 1100);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const monthKey = () => new Date().toISOString().slice(0, 7);

export function providerStatus() {
  return { brave: !!BRAVE_KEY, google: !!(CSE_KEY && CSE_CX) };
}

export async function getUsage(provider, month = monthKey()) {
  const rows = await sql`select count from api_usage where provider = ${provider} and month = ${month}`;
  return rows[0]?.count ?? 0;
}

async function bumpUsage(provider, n, month = monthKey()) {
  if (!Number.isFinite(n) || n <= 0) return;
  await sql`
    insert into api_usage (provider, month, count) values (${provider}, ${month}, ${n})
    on conflict (provider, month) do update set count = api_usage.count + ${n}`;
}

async function braveSearch(q) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`, {
      headers: { 'X-Subscription-Token': BRAVE_KEY, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json())?.error?.detail || msg; } catch {}
      const e = new Error(`Brave: ${msg}`);
      e.rateLimited = r.status === 429;
      throw e;
    }
    const j = await r.json();
    return (j.web?.results || []).map(x => ({ url: x.url, title: x.title || '' }));
  } finally { clearTimeout(tid); }
}

async function googleSearch(q) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 9000);
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(CSE_KEY)}&cx=${encodeURIComponent(CSE_CX)}&num=10&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google CSE: ${j?.error?.message || `HTTP ${r.status}`}`);
    return (j.items || []).map(x => ({ url: x.link, title: x.title || '' }));
  } finally { clearTimeout(tid); }
}

// Paths that are Facebook/Instagram plumbing rather than a business page.
const FB_SKIP = new Set(['profile.php','people','groups','events','watch','marketplace','login','sharer','tr','help','policies','permalink.php','story.php','photo.php','media','hashtag','search','public','settings','privacy','terms','notes','video','reel','story']);
const IG_SKIP = new Set(['p','reel','reels','explore','accounts','stories','tv','directory','about','legal','developer','privacy','terms']);

function firstMatch(results, host, skip, tokens) {
  // Escape for the pattern only — `host` stays plain so the URL we build back
  // out is a real URL and not one with a literal backslash in it.
  const re = new RegExp(`https?://(?:[a-z-]+\\.)?${host.replace(/\./g, '\\.')}/([^/?#\\s]+)`, 'i');
  for (const r of results) {
    const m = re.exec(r.url || '');
    if (!m) continue;
    const slug = decodeURIComponent(m[1]).toLowerCase();
    if (skip.has(slug)) continue;
    // Guard against the engine returning a same-city but different business:
    // require a distinctive word from the name to appear in the URL or title.
    const hay = `${r.url} ${r.title}`.toLowerCase();
    if (tokens.length && !tokens.some(t => hay.includes(t))) continue;
    return `https://www.${host}/${m[1]}`;
  }
  return null;
}

export function extractSocials(results, name) {
  const tokens = stripName(name).split(' ').filter(w => w.length >= 4);
  return {
    facebook_url:  firstMatch(results, 'facebook.com',  FB_SKIP, tokens),
    instagram_url: firstMatch(results, 'instagram.com', IG_SKIP, tokens),
  };
}

/**
 * Creates a searcher for one batch.
 *
 * Spends Brave's free quota first, then falls over to Google Custom Search once
 * this month's Brave count reaches BRAVE_MONTHLY_LIMIT (or if Brave errors /
 * rate-limits). Usage counts are flushed once per batch, not per query.
 */
export async function createSearcher() {
  const month = monthKey();
  // Keep this a real number even when Brave isn't configured: an Infinity here
  // makes the flush arithmetic NaN and Postgres rejects the insert. Whether
  // Brave is usable is decided by `braveEnabled`, not by a sentinel count.
  const braveEnabled = !!BRAVE_KEY;
  let braveCount = braveEnabled ? await getUsage('brave', month) : 0;
  const startBrave = braveCount;
  let googleUsed = 0;
  let lastBraveAt = 0;

  return {
    status: providerStatus(),
    get braveUsedThisMonth() { return braveCount; },

    /**
     * Finds a business's social pages.
     *
     * The query is provider-aware, because the two engines see different webs:
     *  - Brave searches everything, so it needs the "facebook instagram" hint to
     *    surface social pages instead of directories and news.
     *  - The Google CSE is configured to search ONLY facebook.com + instagram.com
     *    (see README), so the name and city are enough — adding those hint words
     *    there would just filter out perfectly good pages whose text happens not
     *    to contain them.
     */
    async searchSocials(name, city) {
      const canBrave  = braveEnabled && braveCount < BRAVE_MONTHLY_LIMIT;
      const canGoogle = !!(CSE_KEY && CSE_CX);
      const base = `"${name}"${city ? ' ' + city : ''}`;

      if (canBrave) {
        const wait = BRAVE_MIN_INTERVAL_MS - (Date.now() - lastBraveAt);
        if (wait > 0) await sleep(wait); // free tier: 1 query/sec
        lastBraveAt = Date.now();
        try {
          const results = await braveSearch(`${base} facebook instagram`);
          braveCount++;
          return { results, provider: 'brave' };
        } catch (err) {
          if (!canGoogle) throw err;
          // Brave failed (quota, rate limit, outage) — fall through to Google.
        }
      }

      if (canGoogle) {
        const results = await googleSearch(base);
        googleUsed++;
        return { results, provider: 'google' };
      }

      throw new Error(
        'No search provider configured. Set GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID (or BRAVE_SEARCH_API_KEY).',
      );
    },

    /** Persist this batch's usage. Call once when the batch finishes. */
    async flush() {
      await Promise.all([
        bumpUsage('brave', braveCount - startBrave, month),
        bumpUsage('google', googleUsed, month),
      ]);
    },
  };
}
