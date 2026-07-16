import { useState, useEffect } from 'react';
import { api } from './api.js';
import { C, input, btn, btnGhost, label, card, Badge } from './ui.jsx';

const Dot = ({ ok, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? C.green : C.red, flexShrink: 0 }} />
    <span>{children}</span>
    <span style={{ marginLeft: 'auto', fontSize: 11, color: ok ? C.green : C.red, fontWeight: 600 }}>
      {ok ? 'OK' : 'NOT SET'}
    </span>
  </div>
);

export default function HealthView() {
  const [h, setH]     = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('Daraz');
  const [city, setCity] = useState('Dhaka');
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.health().then(setH).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const runTest = async () => {
    setBusy(true); setTest(null);
    try {
      const d = await api.health({ test: name, city });
      setTest(d.test);
      setH(d);
    } catch (e) { setTest({ error: e.message }); }
    finally { setBusy(false); }
  };

  if (err) return <div style={{ color: C.red, fontSize: 13 }}>{err}</div>;
  if (!h)  return <div style={{ color: C.sub, fontSize: 13 }}>Checking…</div>;

  const s = h.search;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

      {/* What the server can see */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Server configuration</div>
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>
          What this deployment actually resolved from its environment variables. Secret values are never shown.
        </div>
        <Dot ok={h.database}>Database (Neon)</Dot>
        <Dot ok={h.google_maps}>Google Maps key (scanning)</Dot>
        <Dot ok={s.google_configured}>Google Custom Search (social lookup)</Dot>
        <Dot ok={s.brave_configured}>Brave Search (optional)</Dot>
        <Dot ok={h.email.smtp}>SMTP (email reports)</Dot>
        <Dot ok={h.email.manager}>Manager email address</Dot>
        <Dot ok={h.email.cron}>Cron secret (weekly report)</Dot>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
          Anything red means the variable is missing or misnamed in Vercel. Redeploy after changing env vars.
        </div>
      </div>

      {/* Search quota */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Search quota this month</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.sub }}>Active provider:</span>
          <Badge bg={s.active_provider === 'none' ? '#fef2f2' : C.black} fg={s.active_provider === 'none' ? C.red : '#fff'}>
            {s.active_provider}
          </Badge>
        </div>
        <div style={{ fontSize: 13, padding: '6px 0' }}>
          Brave used: <strong>{s.brave_used_this_month}</strong> / {s.brave_limit}
          {s.brave_configured && <span style={{ color: C.sub }}> · {s.brave_remaining} left before switching to Google</span>}
        </div>
        <div style={{ fontSize: 13, padding: '6px 0' }}>
          Google Custom Search used: <strong>{s.google_used_this_month}</strong>
          <span style={{ color: C.sub }}> · 100/day free, then $5 per 1,000</span>
        </div>
        <button onClick={load} style={{ ...btnGhost, marginTop: 10 }}>Refresh</button>
      </div>

      {/* Live test */}
      <div style={{ ...card, gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Test social lookup</div>
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>
          Runs one real search (costs one query) and shows exactly what came back. If a business you
          know has a Facebook page returns nothing, your search engine is misconfigured — not the lead.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ width: 220 }}>
            <label style={label}>Business name</label>
            <input style={input} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div style={{ width: 160 }}>
            <label style={label}>City</label>
            <input style={input} value={city} onChange={e => setCity(e.target.value)} />
          </div>
          <button onClick={runTest} disabled={busy || !name.trim()} style={btn(busy || !name.trim())}>
            {busy ? 'Searching…' : 'Run test'}
          </button>
        </div>

        {test && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            {test.error ? (
              <div style={{ color: C.red, fontSize: 13 }}>{test.error}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  Provider: <strong>{test.provider}</strong> · {test.raw_result_count} raw result{test.raw_result_count === 1 ? '' : 's'}
                </div>

                {test.raw_result_count === 0 ? (
                  <div style={{ background: '#fef2f2', border: `1px solid ${C.red}33`, borderRadius: 6, padding: 10, fontSize: 12, color: C.red }}>
                    Zero results. Your Google engine has no sites to search — open
                    programmablesearchengine.google.com, and under “Sites to search” add
                    <strong> facebook.com</strong> and <strong> instagram.com</strong>.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      Extracted → Facebook: {test.extracted.facebook_url
                        ? <a href={test.extracted.facebook_url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{test.extracted.facebook_url}</a>
                        : <span style={{ color: C.muted }}>none</span>}
                      {'  ·  '}Instagram: {test.extracted.instagram_url
                        ? <a href={test.extracted.instagram_url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>{test.extracted.instagram_url}</a>
                        : <span style={{ color: C.muted }}>none</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>Raw URLs returned:</div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, color: C.sub }}>
                      {test.raw_urls.map(u => <li key={u} style={{ wordBreak: 'break-all' }}>{u}</li>)}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
