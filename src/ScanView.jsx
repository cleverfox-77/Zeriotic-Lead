import { useState, useEffect, useRef } from 'react';
import { api } from './api.js';
import { C, input, btn, label, card, th, td, Badge, SocialCell } from './ui.jsx';

// Mirrors api/_lib/leadgen.js. Multi-part suffixes (.com.bd) are the whole point:
// most Bangladeshi businesses sit on .com.bd, which single-suffix guessing missed.
const TLD_GROUPS = {
  Common:      ['.com', '.net', '.org', '.co', '.info', '.biz'],
  Bangladesh:  ['.com.bd', '.net.bd', '.org.bd', '.bd'],
  India:       ['.in', '.co.in', '.net.in', '.org.in'],
  'New gTLD':  ['.xyz', '.online', '.site', '.store', '.shop', '.tech', '.space', '.website', '.digital', '.agency', '.studio', '.live', '.life', '.app', '.dev', '.me'],
  Regional:    ['.co.uk', '.uk', '.com.au', '.com.pk', '.com.sg', '.com.my', '.ae', '.lk', '.np', '.us', '.ca'],
};
const DEFAULT_TLDS = ['.com.bd', '.com', '.net', '.org', '.xyz', '.bd'];

/** Location box with Google-Maps-style suggestions (debounced; server-proxied). */
function LocationInput({ value, onChange, disabled }) {
  const [suggestions, setSug] = useState([]);
  const [open, setOpen]       = useState(false);
  const [hi, setHi]           = useState(-1);
  const boxRef  = useRef(null);
  const skipRef = useRef(false); // don't re-query the text we just injected

  useEffect(() => {
    if (skipRef.current) { skipRef.current = false; return; }
    if (!value || value.trim().length < 3) { setSug([]); return; }
    const t = setTimeout(async () => {
      try {
        const { suggestions } = await api.autocomplete(value.trim());
        setSug(suggestions);
        setOpen(suggestions.length > 0);
        setHi(-1);
      } catch { setSug([]); }
    }, 350); // debounce: autocomplete is billed per request
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = s => { skipRef.current = true; onChange(s.text); setOpen(false); setSug([]); };

  const onKey = e => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(suggestions[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input style={input} value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Start typing — e.g. Gulshan, Dhaka"
        autoComplete="off" />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          {suggestions.map((s, i) => (
            <div key={s.text} onMouseDown={() => pick(s)} onMouseEnter={() => setHi(i)}
              style={{ padding: '8px 10px', cursor: 'pointer', background: i === hi ? C.panel : C.bg,
                borderBottom: i < suggestions.length - 1 ? `1px solid ${C.line}` : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.main}</div>
              {s.secondary && <div style={{ fontSize: 11, color: C.sub }}>{s.secondary}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScanView() {
  const [loc, setLoc]         = useState('');
  const [query, setQuery]     = useState('local businesses');
  const [radius, setRadius]   = useState(5000);
  const [maxPages, setPages]  = useState(2);
  const [tlds, setTlds]       = useState(DEFAULT_TLDS);
  const [dns, setDns]         = useState(true);

  // Quality filters
  const [minReviews, setMinReviews]     = useState(10);
  const [minRating, setMinRating]       = useState(0);
  const [requirePhone, setRequirePhone] = useState(true);
  const [excludeClosed, setExcClosed]   = useState(true);

  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [res, setRes]   = useState(null);
  const [social, setSocial] = useState(null); // { done, total, error }

  // Social lookup runs after the scan, in batches. Brave's free tier allows only
  // 1 query/second, so doing this inline would blow the function time limit.
  const enrichSocials = async leads => {
    const ids = leads.map(l => l.place_id);
    setSocial({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      try {
        const { results } = await api.socials(chunk);
        setRes(prev => prev && {
          ...prev,
          leads: prev.leads.map(l => {
            const hit = results.find(r => r.place_id === l.place_id);
            return hit ? { ...l, facebook_url: hit.facebook_url, instagram_url: hit.instagram_url } : l;
          }),
        });
        setSocial(s => ({ ...s, done: Math.min(i + chunk.length, ids.length) }));
      } catch (e) {
        setSocial(s => ({ ...s, error: e.message }));
        return;
      }
    }
    setSocial(s => s && { ...s, done: ids.length });
  };

  const run = async () => {
    setBusy(true); setErr(''); setRes(null); setSocial(null);
    try {
      const r = await api.scan({
        location: loc, query, radius, maxPages, tlds, dns,
        filters: { minReviews: Number(minReviews) || 0, minRating: Number(minRating) || 0, requirePhone, excludeClosed },
      });
      setRes(r);
      setBusy(false);
      if (r.leads.length) enrichSocials(r.leads);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const canRun = !busy && loc.trim();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: res || busy ? '320px 1fr' : '460px', gap: 16, justifyContent: res || busy ? 'stretch' : 'center', alignItems: 'start' }}>

      {/* ── Config ── */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New scan</div>

        <label style={label}>Target location</label>
        <LocationInput value={loc} onChange={setLoc} disabled={busy} />

        <div style={{ height: 12 }} />
        <label style={label}>Business type</label>
        <input style={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="salons, restaurants…" disabled={busy} />

        <div style={{ height: 12 }} />
        <label style={label}>Radius: {(radius / 1000).toFixed(1)} km</label>
        <input type="range" min={500} max={25000} step={500} value={radius} disabled={busy}
          onChange={e => setRadius(+e.target.value)} style={{ width: '100%', accentColor: C.black }} />

        <div style={{ height: 12 }} />
        <label style={label}>Pages (20 results each)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3].map(n => (
            <button key={n} onClick={() => !busy && setPages(n)}
              style={{ flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: maxPages === n ? C.black : C.bg,
                color:      maxPages === n ? '#fff'  : C.text,
                border: `1px solid ${maxPages === n ? C.black : C.border}` }}>
              {n}
            </button>
          ))}
        </div>

        {/* ── Quality filters ── */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Lead quality</div>

          <label style={label}>Minimum reviews</label>
          <input style={input} type="number" min={0} value={minReviews} disabled={busy}
            onChange={e => setMinReviews(e.target.value)} />
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Filters out dead / fake listings.</div>

          <div style={{ height: 12 }} />
          <label style={label}>Minimum rating</label>
          <select style={input} value={minRating} onChange={e => setMinRating(e.target.value)} disabled={busy}>
            <option value={0}>Any rating</option>
            <option value={3}>3.0+</option>
            <option value={3.5}>3.5+</option>
            <option value={4}>4.0+</option>
            <option value={4.5}>4.5+</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={requirePhone} onChange={e => setRequirePhone(e.target.checked)} disabled={busy} style={{ accentColor: C.black }} />
            Must have a phone number
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={excludeClosed} onChange={e => setExcClosed(e.target.checked)} disabled={busy} style={{ accentColor: C.black }} />
            Exclude closed businesses
          </label>
        </div>

        {/* ── Domain check ── */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Domain check</div>
            <div style={{ fontSize: 10, color: C.muted }}>{tlds.length} selected</div>
          </div>

          {Object.entries(TLD_GROUPS).map(([group, list]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{group}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {list.map(t => {
                  const on = tlds.includes(t);
                  return (
                    <button key={t} onClick={() => !busy && setTlds(p => on ? p.filter(x => x !== t) : [...p, t])}
                      style={{ padding: '3px 8px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: on ? 600 : 400,
                        background: on ? C.black : C.bg, color: on ? '#fff' : C.sub,
                        border: `1px solid ${on ? C.black : C.border}` }}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {tlds.length > 14 && (
            <div style={{ fontSize: 10, color: C.amber, marginTop: 2 }}>
              Many suffixes selected — scans will be slower and cost more DNS lookups.
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={dns} onChange={e => setDns(e.target.checked)} disabled={busy} style={{ accentColor: C.black }} />
            Run DNS domain lookup
          </label>
        </div>

        <div style={{ height: 16 }} />
        <button onClick={run} disabled={!canRun} style={{ ...btn(!canRun), width: '100%' }}>
          {busy ? 'Scanning…' : 'Run agent'}
        </button>
        {err && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{err}</div>}
      </div>

      {/* ── Results ── */}
      {(busy || res) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {busy && (
            <div style={{ ...card, color: C.sub, fontSize: 13 }}>
              Scanning Google Maps, filtering for quality, skipping leads your team already has, and checking domains… this takes a few seconds.
            </div>
          )}

          {res && (
            <>
              <div style={{ fontSize: 12, color: C.sub }}>Area resolved: <strong style={{ color: C.text }}>{res.area}</strong></div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
                {[
                  { l: 'Scanned',        v: res.stats.scanned },
                  { l: 'Has website',    v: res.stats.hasWebsite },
                  { l: 'Low quality',    v: res.stats.failedQuality },
                  { l: 'Already given',  v: res.stats.alreadyDelivered },
                  { l: 'To verify',      v: res.stats.toVerify },
                  { l: 'New leads',      v: res.stats.trueLeads, hi: true },
                ].map(({ l, v, hi }) => (
                  <div key={l} style={{ border: `1px solid ${hi ? C.black : C.border}`, borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{v}</div>
                    <div style={{ fontSize: 10, color: C.sub, marginTop: 3, fontWeight: 600 }}>{l}</div>
                  </div>
                ))}
              </div>

              {res.stats.alreadyDelivered > 0 && (
                <div style={{ fontSize: 12, color: C.sub, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px' }}>
                  Skipped <strong style={{ color: C.text }}>{res.stats.alreadyDelivered}</strong> business{res.stats.alreadyDelivered === 1 ? '' : 'es'} your team was already given.
                </div>
              )}

              {res.leads.length === 0 ? (
                <div style={{ ...card, color: C.sub, fontSize: 13 }}>
                  No new leads. Everything matching was either already delivered, filtered out by your quality rules, or already has a website. Try a new area, a different business type, or loosen the filters.
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{res.leads.length} new lead{res.leads.length === 1 ? '' : 's'} — saved to your team pipeline</span>
                    {social && (
                      <span style={{ fontWeight: 400, color: social.error ? C.red : C.sub }}>
                        {social.error ? `Social lookup: ${social.error}`
                          : social.done < social.total ? `Checking social pages… ${social.done}/${social.total}`
                          : 'Social lookup complete'}
                      </span>
                    )}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Business', 'Phone', 'Rating', 'Finding', 'Social', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {res.leads.map(l => (
                          <tr key={l.place_id}>
                            <td style={td}>
                              <div style={{ fontWeight: 600 }}>{l.name}</div>
                              <div style={{ fontSize: 11, color: C.sub }}>{l.address}</div>
                            </td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.phone || '—'}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.rating ? `${l.rating} (${l.reviews})` : '—'}</td>
                            <td style={td}>
                              {l.confidence === 'review'
                                ? <Badge bg="#fffbeb" fg={C.amber}>Verify: {l.found_domains.slice(0, 2).join(', ')}</Badge>
                                : <Badge bg="#ecfdf5" fg={C.green}>True lead</Badge>}
                            </td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}><SocialCell lead={l} /></td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <a href={l.maps_url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontSize: 12, marginRight: 8 }}>Maps</a>
                              <a href={l.g_search} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, fontSize: 12 }}>Google</a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
