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
        <Dot ok={s.tavily_configured}>Tavily (social lookup — free tier)</Dot>
        <Dot ok={s.serper_configured}>Serper (social lookup — paid overflow)</Dot>
        <Dot ok={h.email.smtp}>SMTP (email reports)</Dot>
        <Dot ok={h.email.manager}>Manager email address</Dot>

        {h.security && (
          <>
            <Dot ok={h.security.session_secret.ok}>Session secret strength</Dot>
            {!h.security.session_secret.ok && (
              <div style={{ fontSize: 11, color: C.red, margin: '-2px 0 6px 16px' }}>
                {h.security.session_secret.why}. Run <code style={{ background: C.line, padding: '1px 4px', borderRadius: 3 }}>
                node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code> and paste the
                <em> output</em> into Vercel, then redeploy.
              </div>
            )}
            <Dot ok={h.security.cron_secret.ok}>Cron secret strength</Dot>
            {!h.security.cron_secret.ok && (
              <div style={{ fontSize: 11, color: C.red, margin: '-2px 0 6px 16px' }}>{h.security.cron_secret.why}.</div>
            )}
          </>
        )}
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
          Tavily used: <strong>{s.tavily_used_this_month}</strong> / {s.tavily_limit}
          {s.tavily_configured && <span style={{ color: C.sub }}> · {s.tavily_remaining} free left this month, then Serper takes over</span>}
        </div>
        <div style={{ fontSize: 13, padding: '6px 0' }}>
          Serper used: <strong>{s.serper_used_this_month}</strong>
          <span style={{ color: C.sub }}> · 2,500 free credits, then ~$1 per 1,000</span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          Tavily's free quota resets every month, so it is spent first. Roughly 60 searches per 60-lead scan.
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
              <div>
                <div style={{ color: C.red, fontSize: 13 }}>{test.error}</div>
                {test.error_details?.reason && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.sub }}>
                    HTTP {test.error_details.http_status} · reason: <code style={{ background: C.line, padding: '1px 4px', borderRadius: 3 }}>{test.error_details.reason}</code>
                    {test.error_details.domain ? ` · domain: ${test.error_details.domain}` : ''}
                  </div>
                )}
                {test.fix && (
                  <div style={{ marginTop: 8, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 12 }}>
                    <strong>How to fix: </strong>{test.fix}
                  </div>
                )}
                {test.error_details?.raw_message && (
                  <details style={{ marginTop: 8, fontSize: 11, color: C.sub }}>
                    <summary style={{ cursor: 'pointer' }}>Raw error from Google (names the project number)</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '6px 0 0', fontSize: 11 }}>
                      {test.error_details.raw_message}
                    </pre>
                  </details>
                )}
              </div>
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
