import { useState, useEffect } from 'react';
import { api } from './api.js';
import { C, th, td, card, btn, Badge, STATUS_META } from './ui.jsx';
import { useIsMobile } from './useIsMobile.js';

export default function ReportView() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [mail, setMail] = useState({ busy: false, msg: '', ok: false });
  const isMobile = useIsMobile();

  useEffect(() => { api.report().then(setD).catch(e => setErr(e.message)); }, []);

  const emailIt = async () => {
    setMail({ busy: true, msg: '', ok: false });
    try {
      const { sentTo } = await api.emailReport();
      setMail({ busy: false, msg: `Report emailed to ${sentTo}`, ok: true });
    } catch (e) {
      setMail({ busy: false, msg: e.message, ok: false });
    }
  };

  if (err) return <div style={{ color: C.red, fontSize: 13 }}>{err}</div>;
  if (!d)  return <div style={{ color: C.sub, fontSize: 13 }}>Loading report…</div>;

  const maxDay = Math.max(1, ...d.daily.map(x => x.count));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Email to manager */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', gap: 10, flexDirection: isMobile ? 'column' : 'row' }}>
        <button onClick={emailIt} disabled={mail.busy} style={{ ...btn(mail.busy), padding: isMobile ? '12px 16px' : undefined }}>
          {mail.busy ? 'Sending…' : 'Email report to manager'}
        </button>
        <span style={{ fontSize: 12, color: C.muted }}>A weekly copy also sends automatically every Monday.</span>
        {mail.msg && (
          <span style={{ fontSize: 12, color: mail.ok ? C.green : C.red, marginLeft: isMobile ? 0 : 'auto' }}>{mail.msg}</span>
        )}
      </div>

      {/* Headline numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3,1fr)' : 'repeat(6,1fr)', gap: isMobile ? 6 : 10 }}>
        {[
          { l: 'Total leads',   v: d.totals.total_leads },
          { l: 'New this week', v: d.totals.new_this_week },
          { l: 'True leads',    v: d.totals.true_leads },
          { l: 'Worked',        v: `${d.totals.worked_pct}%` },
          { l: 'Won',           v: d.totals.won },
          { l: 'Conversion',    v: `${d.totals.conversion}%` },
        ].map(({ l, v }) => (
          <div key={l} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: isMobile ? '12px 4px' : '14px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700 }}>{v}</div>
            <div style={{ fontSize: 10, color: C.sub, marginTop: 4, fontWeight: 600 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* Pipeline */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pipeline</div>
          {d.byStatus.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No leads yet.</div> : d.byStatus.map(s => {
            const total = d.totals.total_leads || 1;
            const pct = Math.round((s.count / total) * 100);
            return (
              <div key={s.status} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <Badge bg={STATUS_META[s.status]?.bg} fg={STATUS_META[s.status]?.fg}>{STATUS_META[s.status]?.label || s.status}</Badge>
                  <span style={{ color: C.sub }}>{s.count} · {pct}%</span>
                </div>
                <div style={{ height: 6, background: C.line, borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: C.black, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Leads delivered per day */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Leads delivered (14 days)</div>
          {d.daily.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>No activity yet.</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
              {d.daily.map(x => (
                <div key={x.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div title={`${x.day}: ${x.count}`} style={{ width: '100%', height: `${(x.count / maxDay) * 96}px`, background: C.black, borderRadius: 2 }} />
                  <div style={{ fontSize: 8, color: C.muted }}>{x.day.slice(8)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-employee */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700 }}>By employee</div>
        <div className="scroll-x">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 620 : 'auto' }}>
          <thead><tr>{['Employee', 'Leads', 'Untouched', 'Contacted', 'Interested', 'Unqualified', 'Won', 'Lost', 'Win rate'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {d.byEmployee.map(e => (
              <tr key={e.employee}>
                <td style={{ ...td, fontWeight: 600 }}>{e.employee || '—'}</td>
                <td style={td}>{e.total}</td>
                <td style={{ ...td, color: e.untouched > 0 ? C.amber : C.sub }}>{e.untouched}</td>
                <td style={td}>{e.contacted}</td>
                <td style={td}>{e.interested}</td>
                <td style={{ ...td, color: C.sub }}>{e.unqualified}</td>
                <td style={{ ...td, fontWeight: 600 }}>{e.won}</td>
                <td style={td}>{e.lost}</td>
                <td style={td}>{e.total ? `${((e.won / e.total) * 100).toFixed(0)}%` : '0%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Activity */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700 }}>Recent activity</div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {d.activity.length === 0 ? <div style={{ padding: 14, fontSize: 12, color: C.muted }}>Nothing logged yet.</div> : d.activity.map(a => (
            <div key={a.id} style={{ padding: '9px 14px', borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{a.author}</span>
              <span style={{ color: C.sub }}> on </span>
              <span style={{ fontWeight: 600 }}>{a.name}</span>
              {a.status && <span style={{ marginLeft: 8 }}><Badge bg={STATUS_META[a.status]?.bg} fg={STATUS_META[a.status]?.fg}>{STATUS_META[a.status]?.label}</Badge></span>}
              <span style={{ color: C.muted, marginLeft: 8 }}>{new Date(a.created_at).toLocaleString()}</span>
              {a.note && <div style={{ color: C.text, marginTop: 3 }}>{a.note}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
