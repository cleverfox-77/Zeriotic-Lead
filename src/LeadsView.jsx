import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { api } from './api.js';
import { C, input, btn, btnGhost, label, th, td, Badge, STATUS_META, STATUSES } from './ui.jsx';

function NotePanel({ lead, onChanged }) {
  const [notes, setNotes] = useState([]);
  const [text, setText]   = useState('');
  const [status, setStatus] = useState(lead.status);
  const [busy, setBusy]   = useState(false);

  useEffect(() => { api.notes(lead.place_id).then(d => setNotes(d.notes)).catch(() => {}); }, [lead.place_id]);

  const save = async () => {
    if (!text.trim() && status === lead.status) return;
    setBusy(true);
    try {
      await api.addNote(lead.place_id, text, status !== lead.status ? status : undefined);
      setText('');
      setNotes(await api.notes(lead.place_id).then(d => d.notes));
      onChanged();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '12px 14px', background: C.panel }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...input, width: 150 }}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          placeholder="What happened? e.g. Called — owner asked to call back Sunday, wants a menu site."
          style={{ ...input, flex: 1, resize: 'vertical', fontFamily: 'inherit' }} />
        <button onClick={save} disabled={busy} style={btn(busy)}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      <div style={{ marginTop: 12 }}>
        {notes.length === 0
          ? <div style={{ fontSize: 12, color: C.muted }}>No activity yet.</div>
          : notes.map(n => (
              <div key={n.id} style={{ borderTop: `1px solid ${C.border}`, padding: '7px 0', fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{n.author}</span>
                <span style={{ color: C.muted, marginLeft: 8 }}>{new Date(n.created_at).toLocaleString()}</span>
                {n.status && <span style={{ marginLeft: 8 }}><Badge bg={STATUS_META[n.status]?.bg} fg={STATUS_META[n.status]?.fg}>{STATUS_META[n.status]?.label}</Badge></span>}
                {n.note && <div style={{ color: C.text, marginTop: 3 }}>{n.note}</div>}
              </div>
            ))}
      </div>
    </div>
  );
}

export default function LeadsView() {
  const [leads, setLeads]   = useState([]);
  const [busy, setBusy]     = useState(true);
  const [open, setOpen]     = useState(null);
  const [f, setF]           = useState({ status: '', owner: '', confidence: '', q: '', minReviews: '', minRating: '' });

  const load = useCallback(async () => {
    setBusy(true);
    try { setLeads((await api.leads(f)).leads); } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }, [f]);

  useEffect(() => { load(); }, [load]);

  const owners = [...new Set(leads.map(l => l.delivered_to).filter(Boolean))];

  const exportXLSX = () => {
    const H = ['Name','Address','Phone','Type','Rating','Reviews','Status','Confidence','Same-name domains','Owner','Delivered','Last note','Maps'];
    const rows = leads.map(l => [
      l.name, l.address, l.phone, l.type, l.rating ?? '', l.reviews,
      STATUS_META[l.status]?.label || l.status,
      l.confidence === 'high' ? 'TRUE LEAD' : 'VERIFY',
      (l.found_domains || []).join(', ') || '—',
      l.delivered_to, new Date(l.delivered_at).toLocaleDateString(),
      l.last_note || '', l.maps_url,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Leads');
    XLSX.writeFile(wb, `leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ width: 200 }}>
          <label style={label}>Search</label>
          <input style={input} value={f.q} onChange={e => set('q', e.target.value)} placeholder="Name, address, phone" />
        </div>
        <div style={{ width: 140 }}>
          <label style={label}>Status</label>
          <select style={input} value={f.status} onChange={e => set('status', e.target.value)}>
            <option value="">All</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
        <div style={{ width: 140 }}>
          <label style={label}>Owner</label>
          <select style={input} value={f.owner} onChange={e => set('owner', e.target.value)}>
            <option value="">Everyone</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ width: 130 }}>
          <label style={label}>Confidence</label>
          <select style={input} value={f.confidence} onChange={e => set('confidence', e.target.value)}>
            <option value="">All</option>
            <option value="high">True lead</option>
            <option value="review">Verify</option>
          </select>
        </div>
        <div style={{ width: 110 }}>
          <label style={label}>Min reviews</label>
          <input style={input} type="number" min={0} value={f.minReviews} onChange={e => set('minReviews', e.target.value)} />
        </div>
        <div style={{ width: 110 }}>
          <label style={label}>Min rating</label>
          <select style={input} value={f.minRating} onChange={e => set('minRating', e.target.value)}>
            <option value="">Any</option>
            <option value="3">3.0+</option>
            <option value="4">4.0+</option>
            <option value="4.5">4.5+</option>
          </select>
        </div>
        <button onClick={exportXLSX} disabled={!leads.length} style={btnGhost}>Export Excel</button>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700 }}>
          {busy ? 'Loading…' : `${leads.length} lead${leads.length === 1 ? '' : 's'}`}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Business', 'Phone', 'Rating', 'Status', 'Finding', 'Owner', 'Activity'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {leads.map(l => {
                const isOpen = open === l.place_id;
                return [
                  <tr key={l.place_id} onClick={() => setOpen(isOpen ? null : l.place_id)} style={{ cursor: 'pointer', background: isOpen ? C.panel : C.bg }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: C.sub }}>{l.address}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.phone || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.rating ? `${l.rating} (${l.reviews})` : '—'}</td>
                    <td style={td}><Badge bg={STATUS_META[l.status]?.bg} fg={STATUS_META[l.status]?.fg}>{STATUS_META[l.status]?.label || l.status}</Badge></td>
                    <td style={td}>
                      {l.confidence === 'review'
                        ? <Badge bg="#fffbeb" fg={C.amber}>Verify</Badge>
                        : <Badge bg="#ecfdf5" fg={C.green}>True lead</Badge>}
                    </td>
                    <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{l.delivered_to}</td>
                    <td style={{ ...td, fontSize: 12, color: C.sub, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.note_count > 0 ? `${l.note_count} · ${l.last_note || ''}` : '—'}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={l.place_id + '-x'}>
                      <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                        <NotePanel lead={l} onChanged={load} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
