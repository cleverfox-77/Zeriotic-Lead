import { sql } from './db.js';
import { stripName } from './leadgen.js';

// ─────────────────────────────────────────────────────────────────────────────
// Why these two providers:
//   Google Custom Search JSON API is CLOSED to new Cloud projects (any new key
//   gets 403 forbidden no matter how it's configured), and Brave retired its
//   free tier in early 2026. Both were dead ends. Tavily still has a recurring
//   free monthly quota; Serper is the cheapest paid overflow.
// ─────────────────────────────────────────────────────────────────────────────
const TAVILY_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY || process.env.SERPER_KEY;

// Tavily's free tier is 1,000 credits per month and it RESETS monthly, so we
// spend it first and only fall through to paid Serper once it's gone.
export const TAVILY_MONTHLY_LIMIT = Number(process.env.TAVILY_MONTHLY_LIMIT || 1000);

const monthKey = () => new Date().toISOString().slice(0, 7);

// Only these two hosts matter — every other result is discarded, so we ask the
// providers to restrict rather than filtering a page of noise afterwards.
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com'];

export function providerStatus() {
  return { tavily: !!TAVILY_KEY, serper: !!SERPER_KEY };
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

function detailedError(prefix, status, body) {
  const msg = body?.error?.message || body?.message || body?.detail || body?.error || `HTTP ${status}`;
  const err = new Error(`${prefix}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  err.details = { http_status: status, reason: body?.error?.type || body?.code, raw_message: typeof msg === 'string' ? msg : undefined };
  return err;
}

async function tavilySearch(q) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_KEY}` },
      body: JSON.stringify({
        query: q,
        max_results: 10,
        search_depth: 'basic',        // 1 credit; "advanced" costs more and adds nothing here
        include_domains: SOCIAL_HOSTS,
      }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw detailedError('Tavily', r.status, j);
    return (j.results || []).map(x => ({ url: x.url, title: x.title || '' }));
  } finally { clearTimeout(tid); }
}

async function serperSearch(q) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  try {
    // Serper proxies real Google, so Google's site: operators work directly.
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${q} (${SOCIAL_HOSTS.map(h => `site:${h}`).join(' OR ')})`, num: 10 }),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw detailedError('Serper', r.status, j);
    return (j.organic || []).map(x => ({ url: x.link, title: x.title || '' }));
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
 * Spends Tavily's recurring free monthly quota first, then falls over to Serper
 * (paid, but ~$0.06 per 60-lead scan) once this month's Tavily count reaches
 * TAVILY_MONTHLY_LIMIT — or immediately if Tavily errors. Usage counts are
 * flushed once per batch, not per query, and persist in `api_usage` so the
 * switch survives cold starts.
 */
export async function createSearcher() {
  const month = monthKey();
  // Keep this a real number even when Tavily isn't configured: an Infinity here
  // makes the flush arithmetic NaN and Postgres rejects the insert.
  const tavilyEnabled = !!TAVILY_KEY;
  let tavilyCount = tavilyEnabled ? await getUsage('tavily', month) : 0;
  const startTavily = tavilyCount;
  let serperUsed = 0;

  return {
    status: providerStatus(),
    get tavilyUsedThisMonth() { return tavilyCount; },

    /**
     * Finds a business's social pages. Both providers are told to restrict to
     * facebook.com/instagram.com, so the name and city are the whole query —
     * no "facebook instagram" hint words needed (they'd only filter out good
     * pages whose text happens not to contain them).
     */
    async searchSocials(name, city) {
      const canTavily = tavilyEnabled && tavilyCount < TAVILY_MONTHLY_LIMIT;
      const canSerper = !!SERPER_KEY;
      const q = `"${name}"${city ? ' ' + city : ''}`;

      if (canTavily) {
        try {
          const results = await tavilySearch(q);
          tavilyCount++;
          return { results, provider: 'tavily' };
        } catch (err) {
          if (!canSerper) throw err;
          // Tavily failed (quota, outage) — fall through to Serper.
        }
      }

      if (canSerper) {
        const results = await serperSearch(q);
        serperUsed++;
        return { results, provider: 'serper' };
      }

      throw new Error('No search provider configured. Set TAVILY_API_KEY and/or SERPER_API_KEY.');
    },

    /** Persist this batch's usage. Call once when the batch finishes. */
    async flush() {
      await Promise.all([
        bumpUsage('tavily', tavilyCount - startTavily, month),
        bumpUsage('serper', serperUsed, month),
      ]);
    },
  };
}
