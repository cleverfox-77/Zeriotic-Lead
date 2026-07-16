// Lead-scoring engine. Runs server-side so the Google key never reaches a browser.

export const ALL_TLDS     = ['.com','.net','.org','.in','.shop','.co','.io','.biz','.info','.online','.store','.uk','.us','.ca','.au'];
export const DEFAULT_TLDS = ['.com','.net','.in','.shop'];

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
  const strong = new Set(), weak = new Set();
  const addS = s => { if (s && s.length >= 5 && s.length <= 28) strong.add(s); };
  const addW = s => { if (s && s.length >= 3 && s.length <= 28) weak.add(s); };

  if (w.length === 1) {
    (w[0].length >= 6 ? addS : addW)(w[0]);
  } else {
    addS(w.join(''));
    addS(w.join('-'));
    addS(w.slice(0, 2).join(''));
    addS(w.slice(0, 2).join('-'));
    addS(w[0] + w[w.length - 1]);
    if (w.length >= 3) {
      addS(w.slice(0, 3).join(''));
      addS(w[0] + '-' + w[w.length - 1]);
    }
    addW(w[0]);
    addW(w.map(x => x[0]).join(''));
  }

  const build = set => [...set].flatMap(b => tlds.map(t => b + t));
  const strongList = build(strong);
  const strongSet  = new Set(strongList);
  return { strong: strongList, weak: build(weak).filter(d => !strongSet.has(d)) };
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

/** Runs `fn` over `items` with bounded concurrency (keeps serverless well under timeout). */
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

/** Classifies one business: 'high' (true lead) or 'review' (same-name domain exists). */
export async function classify(name, tlds, doDNS) {
  const { strong, weak } = domainCandidates(name, tlds);
  if (!doDNS) return { confidence: 'high', foundDomains: [], weakDomains: [], candidates: [...strong, ...weak].slice(0, 40) };

  const toCheck   = [...strong, ...weak.slice(0, 8)];
  const strongSet = new Set(strong);
  const results   = await pool(toCheck, 24, dnsCheck);

  const foundDomains = [], weakDomains = [];
  results.forEach((ok, k) => {
    if (!ok) return;
    (strongSet.has(toCheck[k]) ? foundDomains : weakDomains).push(toCheck[k]);
  });

  return {
    confidence: foundDomains.length ? 'review' : 'high',
    foundDomains,
    weakDomains,
    candidates: toCheck.slice(0, 40),
  };
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
