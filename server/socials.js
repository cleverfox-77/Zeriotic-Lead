import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { createSearcher, extractSocials } from './_lib/search.js';

// Batched on purpose: Brave's free tier is 1 query/second, so 60 businesses
// would take 60s inline and blow the function limit. The UI walks through
// leads in small batches instead, showing progress.
const MAX_BATCH = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const ids = (req.body?.place_ids || []).slice(0, MAX_BATCH);
  if (!ids.length) return res.status(400).json({ error: 'place_ids is required' });

  try {
    const leads = await sql`
      select place_id, name, search_location from leads where place_id = any(${ids})`;
    if (!leads.length) return res.status(200).json({ results: [] });

    const searcher = await createSearcher();
    // Read the provider flags off `status` rather than naming them here, so a
    // provider rename can't silently turn this into `!undefined && !undefined`
    // and reject every request.
    if (!Object.values(searcher.status).some(Boolean)) {
      return res.status(500).json({
        error: 'No search provider configured. Set TAVILY_API_KEY and/or SERPER_API_KEY, then redeploy.',
      });
    }

    const results = [];
    for (const l of leads) {
      const where = (l.search_location || '').split(',')[0];
      try {
        const { results: hits, provider } = await searcher.searchSocials(l.name, where);
        const { facebook_url, instagram_url } = extractSocials(hits, l.name);

        await sql`
          update leads
             set facebook_url = ${facebook_url},
                 instagram_url = ${instagram_url},
                 socials_checked_at = now()
           where place_id = ${l.place_id}`;

        results.push({ place_id: l.place_id, facebook_url, instagram_url, provider });
      } catch (err) {
        // One bad lookup shouldn't sink the batch.
        results.push({ place_id: l.place_id, error: err.message });
      }
    }

    await searcher.flush();

    return res.status(200).json({ results, tavilyUsedThisMonth: searcher.tavilyUsedThisMonth });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
