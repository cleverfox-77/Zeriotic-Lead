import { requireAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { classify, geocode, placesSearch, DEFAULT_TLDS } from './_lib/leadgen.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });

  const {
    location, query = 'local businesses', radius = 5000, maxPages = 2,
    tlds = DEFAULT_TLDS, dns = true, filters = {},
  } = req.body || {};

  if (!location?.trim()) return res.status(400).json({ error: 'Location is required' });

  const {
    minReviews = 0, minRating = 0, requirePhone = false, excludeClosed = true,
  } = filters;

  try {
    // 1. Resolve the search area.
    const geo = await geocode(location, key);

    // 2. Collect businesses (Places pagination needs ~2s between pages).
    const places = [];
    let token = null, page = 0;
    const pages = Math.min(Number(maxPages) || 1, 3);
    do {
      const data = await placesSearch(`${query} in ${location}`, geo.lat, geo.lng, radius, key, token);
      if (!data.places?.length) break;
      places.push(...data.places);
      token = data.nextPageToken || null;
      page++;
      if (token && page < pages) await sleep(2100);
    } while (token && page < pages);

    const scanned = places.length;

    // 3. Only businesses with no website on Maps can be leads.
    const noSite = places.filter(p => !p.websiteUri);
    const hasWebsite = scanned - noSite.length;

    // 4. Quality filters — the difference between a lead list and a phone book.
    const quality = noSite.filter(p => {
      if (excludeClosed && p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
      if (requirePhone && !p.nationalPhoneNumber) return false;
      if (minReviews > 0 && (p.userRatingCount ?? 0) < minReviews) return false;
      if (minRating  > 0 && (p.rating ?? 0)         < minRating)  return false;
      return true;
    });
    const failedQuality = noSite.length - quality.length;

    // 5. Dedup against everything the team has ever been given.
    const ids  = quality.map(p => p.id).filter(Boolean);
    const seen = ids.length
      ? new Set((await sql`select place_id from leads where place_id = any(${ids})`).map(r => r.place_id))
      : new Set();
    const fresh = quality.filter(p => !seen.has(p.id));
    const alreadyDelivered = quality.length - fresh.length;

    // 6. Classify the survivors (DNS domain check).
    const leads = [];
    for (const p of fresh) {
      const name = p.displayName?.text || 'Unknown';
      const c = await classify(name, tlds, dns);
      leads.push({
        place_id: p.id,
        name,
        address: p.formattedAddress || '',
        phone:   p.nationalPhoneNumber || '',
        type:    p.primaryTypeDisplayName?.text || '',
        rating:  p.rating ?? null,
        reviews: p.userRatingCount ?? 0,
        maps_url: p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`,
        g_search: `https://www.google.com/search?q=${encodeURIComponent(`"${name}" "${location}" website`)}`,
        confidence:    c.confidence,
        found_domains: c.foundDomains,
        weak_domains:  c.weakDomains,
        status: 'new',
        delivered_to: session.name,
      });
    }

    // 7. Record them as delivered so nobody on the team ever gets them again.
    //    ON CONFLICT guards against two employees scanning at the same moment.
    if (leads.length) {
      const cols = ['place_id','name','address','phone','type','rating','reviews','maps_url','g_search',
                    'search_location','search_query','confidence','found_domains','weak_domains','delivered_to','status'];
      const params = [];
      const tuples = leads.map((l, i) => {
        params.push(l.place_id, l.name, l.address, l.phone, l.type, l.rating, l.reviews, l.maps_url, l.g_search,
                    location, query, l.confidence, l.found_domains, l.weak_domains, session.name, 'new');
        return `(${cols.map((_, k) => `$${i * cols.length + k + 1}`).join(',')})`;
      });
      await sql.query(
        `insert into leads (${cols.join(',')}) values ${tuples.join(',')} on conflict (place_id) do nothing`,
        params,
      );
    }

    return res.status(200).json({
      area: geo.label,
      stats: {
        scanned,
        hasWebsite,
        failedQuality,
        alreadyDelivered,
        delivered: leads.length,
        trueLeads: leads.filter(l => l.confidence === 'high').length,
        toVerify:  leads.filter(l => l.confidence === 'review').length,
      },
      leads,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
