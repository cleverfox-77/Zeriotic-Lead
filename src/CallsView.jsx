import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';
import { C, card, btnGhost, Badge, STATUS_META } from './ui.jsx';
import { useIsMobile } from './useIsMobile.js';

const CALL_STATUS = {
  queued:        { label: 'Queued',      bg: '#f3f4f6', fg: '#374151' },
  ringing:       { label: 'Ringing…',    bg: '#fffbeb', fg: C.amber },
  'in-progress': { label: 'On the call', bg: '#eff6ff', fg: C.blue },
  ended:         { label: 'Ended',       bg: '#f3f4f6', fg: '#374151' },
  failed:        { label: 'Failed',      bg: '#fef2f2', fg: C.red },
};
const OUTCOME = {
  interested:     { label: 'Interested',     bg: '#ecfdf5', fg: C.green },
  callback:       { label: 'Callback',       bg: '#fffbeb', fg: C.amber },
  not_interested: { label: 'Not interested', bg: '#fef2f2', fg: C.red },
  unqualified:    { label: 'Unqualified',    bg: '#f5f5f4', fg: '#78716c' },
  no_answer:      { label: 'No answer',      bg: '#f3f4f6', fg: C.sub },
  do_not_call:    { label: 'Do not call',    bg: '#fef2f2', fg: C.red },
  other:          { label: 'Other',          bg: '#f3f4f6', fg: C.sub },
};
const ACTIVE = ['queued', 'ringing', 'in-progress'];

function dur(s) {
  if (!s) return '—';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function CallCard({ c }) {
  const [open, setOpen] = useState(false);
  const st = CALL_STATUS[c.status] || CALL_STATUS.queued;
  const oc = c.outcome ? (OUTCOME[c.outcome] || OUTCOME.other) : null;

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div onClick={() => setOpen(v => !v)} style={{ padding: '12px 14px', cursor: 'pointer', background: open ? C.panel : C.bg }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>
            {c.lead_name}
            {c.is_test && <span style={{ marginLeft: 8 }}><Badge bg="#eef2ff" fg="#4338ca">TEST</Badge></span>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {oc && <Badge bg={oc.bg} fg={oc.fg}>{oc.label}</Badge>}
            <Badge bg={st.bg} fg={st.fg}>{st.label}</Badge>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12, color: C.sub, flexWrap: 'wrap' }}>
          <span>{new Date(c.created_at).toLocaleString()}</span>
          <span>by {c.started_by}</span>
          {c.duration_seconds != null && <span>{dur(c.duration_seconds)}</span>}
          {+c.cost_usd > 0 && <span>${(+c.cost_usd).toFixed(2)}</span>}
          {c.interest_level != null && <span>interest {c.interest_level}/10</span>}
          {c.whatsapp_sent && <Badge bg="#ecfdf5" fg={C.green}>Portfolio sent ✓</Badge>}
          {c.callback_at && <Badge bg="#fffbeb" fg={C.amber}>Callback: {c.callback_at}</Badge>}
        </div>

        {c.summary && <div style={{ marginTop: 8, fontSize: 12, color: C.text }}>{c.summary}</div>}
        {c.status === 'failed' && c.ended_reason && (
          <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>{c.ended_reason}</div>
        )}
      </div>

      {open && (
        <div style={{ padding: '12px 14px', background: C.panel, borderTop: `1px solid ${C.line}` }}>
          {c.recording_url && (
            <div style={{ marginBottom: 10 }}>
              <audio controls src={c.recording_url} style={{ width: '100%', maxWidth: 480 }} />
            </div>
          )}
          {c.transcript ? (
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 12, color: C.text, fontFamily: 'inherit', maxHeight: 360, overflowY: 'auto' }}>
              {c.transcript}
            </pre>
          ) : (
            <div style={{ fontSize: 12, color: C.muted }}>
              {ACTIVE.includes(c.status) ? 'Call in progress — the transcript arrives when it ends.' : 'No transcript for this call.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CallsView() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try { setD(await api.calls()); setErr(''); }
    catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live view while a call is running: poll until it ends.
  const anyActive = d?.calls?.some(c => ACTIVE.includes(c.status));
  useEffect(() => {
    if (!anyActive) return;
    timer.current = setInterval(load, 6000);
    return () => clearInterval(timer.current);
  }, [anyActive, load]);

  if (err) return <div style={{ color: C.red, fontSize: 13 }}>{err}</div>;
  if (!d)  return <div style={{ color: C.sub, fontSize: 13 }}>Loading calls…</div>;

  const u = d.usage || {};
  const pct = u.budget ? Math.min(100, Math.round(((u.spent + u.reserved) / u.budget) * 100)) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: isMobile ? 8 : 12 }}>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>Monthly call budget</span>
            <span style={{ color: C.sub }}>${(u.spent ?? 0).toFixed(2)} of ${u.budget ?? 0}{u.reserved > 0 ? ` (+$${u.reserved.toFixed(2)} reserved)` : ''}</span>
          </div>
          <div style={{ height: 8, background: C.line, borderRadius: 4 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct > 85 ? C.red : C.black, borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Hard cap — calling refuses politely when it's reached. Raise AI_CALL_MONTHLY_BUDGET in Vercel to spend more.
          </div>
        </div>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{u.today ?? 0}<span style={{ fontSize: 13, color: C.sub }}> / {u.daily_max ?? 0}</span></div>
          <div style={{ fontSize: 10, color: C.sub, marginTop: 4, fontWeight: 600 }}>CALLS TODAY</div>
        </div>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{u.in_flight ?? 0}</div>
          <div style={{ fontSize: 10, color: C.sub, marginTop: 4, fontWeight: 600 }}>IN PROGRESS</div>
        </div>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Call history</span>
          <button onClick={load} style={{ ...btnGhost, padding: '5px 10px', fontSize: 12 }}>Refresh</button>
        </div>
        {d.calls.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: C.muted }}>
            No AI calls yet. Open a lead in the Pipeline and press <strong>AI Call</strong> — or run a test call to your own
            number from the Setup tab first. Train your voice and pitch in the <strong>Train AI</strong> tab.
          </div>
        ) : d.calls.map(c => <CallCard key={c.id} c={c} />)}
      </div>
    </div>
  );
}
