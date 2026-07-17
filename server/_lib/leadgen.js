// Lead-scoring engine. Runs server-side so the Google key never reaches a browser.

// Suffixes are plain strings appended to a base, so multi-part suffixes like
// ".com.bd" work exactly like ".com" — that is what makes greenleaf.com.bd
// (the standard Bangladeshi business domain) detectable at all.
export const TLD_GROUPS = {
  Common:       ['.com', '.net', '.org', '.co', '.info', '.biz'],
  Bangladesh:   ['.com.bd', '.net.bd', '.org.bd', '.bd'],
  India:        ['.in', '.co.in', '.net.in', '.org.in'],
  'New gTLD':   ['.xyz', '.online', '.site', '.store', '.shop', '.tech', '.space', '.website', '.digital', '.agency', '.studio', '.live', '.life', '.app', '.dev', '.me'],
  Regional:     ['.co.uk', '.uk', '.com.au', '.com.pk', '.com.sg', '.com.my', '.ae', '.lk', '.np', '.us', '.ca'],
};

export const ALL_TLDS = [...new Set(Object.values(TLD_GROUPS).flat())];

// Tuned for the Bangladesh market: .com.bd first, plus the gTLDs local
// businesses actually buy.
export const DEFAULT_TLDS = ['.com.bd', '.com', '.net', '.org', '.xyz', '.bd'];

// Hard ceiling on DNS lookups per business, so selecting every TLD can't
// blow the serverless time budget.
const MAX_CHECKS_PER_BUSINESS = 80;
const DNS_CONCURRENCY = 50;

export function stripName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    // corporate fillers
    .replace(/\b(and|the|a|an|of|inc|llc|ltd|co|corp|company|limited|group|services|solutions|associates|partners|international|enterprises|holdings|pvt|private)\b/g, ' ')
    // location / branch / positional noise that pollutes domain guesses
    .replace(/\b(by|branch|near|opposite|opp|beside|behind|floor|road|rd|block|sector|phase|main|new)\b/g, ' ')
    // standalone numbers ("Gulshan-2") and single letters ("Joe's" -> "s") carry no brand signal
    .replace(/\b(\d+|[a-z])\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// strong = built from >=2 words of the name -> a resolving one is worth a manual look.
// weak   = single generic words / initials -> these resolve to unrelated big sites
//          constantly, so they are info-only and NEVER disqualify a lead.
export function domainCandidates(name, tlds = DEFAULT_TLDS) {
  const w = stripName(name).split(' ').filter(Boolean);
  if (!w.length) return { strong: [], weak: [] };

  const strongBases = new Set(), weakBases = new Set();
  const addS = s => { if (s && s.length >= 5 && s.length <= 30) strongBases.add(s); };
  const addW = s => { if (s && s.length >= 3 && s.length <= 30) weakBases.add(s); };

  if (w.length === 1) {
    (w[0].length >= 6 ? addS : addW)(w[0]);
  } else {
    // Highest-signal shapes only. Every extra base multiplies by the TLD count,
    // so low-yield variants were dropped to buy room for more suffixes.
    addS(w.join(''));
    addS(w.join('-'));
    addS(w.slice(0, 2).join(''));
    addS(w[0] + w[w.length - 1]);
    addW(w[0]);
    addW(w.map(x => x[0]).join(''));
  }

  const build = set => [...set].flatMap(b => tlds.map(t => b + t));
  const strong    = build(strongBases);
  const strongSet = new Set(strong);
  return { strong, weak: build(weakBases).filter(d => !strongSet.has(d)) };
}

export async function dnsCheck(domain) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r    = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return false;
    const j = await r.json();
    return j.Status === 0 && Array.isArray(j.Answer) && j.Answer.length > 0;
  } catch { return false; }
}

/** Runs `fn` over `items` with bounded concurrency. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

/**
 * Classifies every business in one pass.
 *
 * All DNS lookups across all businesses go through a single global pool, rather
 * than a per-business pool run serially. Same number of lookups, a fraction of
 * the wall time, and concurrency stays bounded no matter how many businesses or
 * TLDs are in play.
 *
 * Returns one result per input, aligned by index.
 */
export async function classifyMany(names, tlds = DEFAULT_TLDS, doDNS = true) {
  const per = names.map(n => {
    const { strong, weak } = domainCandidates(n, tlds);
    const toCheck = [...strong, ...weak.slice(0, 8)].slice(0, MAX_CHECKS_PER_BUSINESS);
    return { strong: new Set(strong), toCheck };
  });

  if (!doDNS) {
    return per.map(p => ({ confidence: 'high', foundDomains: [], weakDomains: [], checked: 0 }));
  }

  // Flatten every (business, domain) pair into one work queue.
  const tasks = [];
  per.forEach((p, i) => p.toCheck.forEach(d => tasks.push({ i, d })));

  const hits = await pool(tasks, DNS_CONCURRENCY, t => dnsCheck(t.d));

  const out = per.map(p => ({ confidence: 'high', foundDomains: [], weakDomains: [], checked: p.toCheck.length }));
  hits.forEach((ok, k) => {
    if (!ok) return;
    const { i, d } = tasks[k];
    (per[i].strong.has(d) ? out[i].foundDomains : out[i].weakDomains).push(d);
  });
  out.forEach(o => { if (o.foundDomains.length) o.confidence = 'review'; });

  return out;
}

export async function geocode(addr, key) {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${key}`);
  const j = await r.json();
  if (j.status !== 'OK') throw new Error(`Geocoding failed (${j.status}) — check the location.`);
  const { lat, lng } = j.results[0].geometry.location;
  return { lat, lng, label: j.results[0].formatted_address };
}

export async function placesSearch(query, lat, lng, radius, key, pageToken) {
  const body = {
    textQuery: query,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    maxResultCount: 20,
  };
  if (pageToken) body.pageToken = pageToken;

  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus,places.primaryTypeDisplayName,places.googleMapsUri,nextPageToken',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json())?.error?.message || msg; } catch {}
    throw new Error(`Places API: ${msg}`);
  }
  return r.json();
}
