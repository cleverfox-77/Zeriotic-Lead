import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { api } from './api.js';
import { C, input, btn, btnGhost, label, th, td, Badge, SocialCell, Phone, STATUS_META, STATUSES } from './ui.jsx';
import { useIsMobile } from './useIsMobile.js';

function NotePanel({ lead, onChanged, isMobile }) {
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>
        <select value={status} onChange={e => setStatus(e.target.value)}
          style={{ ...input, width: isMobile ? '100%' : 150 }}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={isMobile ? 3 : 2}
          placeholder="What happened? e.g. Called — owner asked to call back Sunday, wants a menu site."
          style={{ ...input, flex: 1, width: isMobile ? '100%' : undefined, resize: 'vertical', fontFamily: 'inherit' }} />
        <button onClick={save} disabled={busy} style={{ ...btn(busy), width: isMobile ? '100%' : undefined, padding: isMobile ? '12px 16px' : undefined }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
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

/** Mobile row: a tappable card. An 8-column table is unreadable on a phone. */
function LeadCard({ lead: l, open, onToggle, onChanged }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, background: open ? C.panel : C.bg }}>
      <div onClick={onToggle} style={{ padding: '12px 14px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>{l.name}</div>
          <Badge bg={STATUS_META[l.status]?.bg} fg={STATUS_META[l.status]?.fg}>{STATUS_META[l.status]?.label || l.status}</Badge>
        </div>

        <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{l.address}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <Phone number={l.phone} />
          {l.rating != null && <span style={{ fontSize: 12, color: C.sub }}>★ {l.rating} ({l.reviews})</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {l.confidence === 'review'
            ? <Badge bg="#fffbeb" fg={C.amber}>Verify</Badge>
            : <Badge bg="#ecfdf5" fg={C.green}>True lead</Badge>}
          <SocialCell lead={l} />
          <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
            {l.delivered_to}{l.note_count > 0 ? ` · ${l.note_count} note${l.note_count === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>
      {open && <NotePanel lead={l} onChanged={onChanged} isMobile />}
    </div>
  );
}

export default function LeadsView() {
  const [leads, setLeads]   = useState([]);
  const [busy, setBusy]     = useState(true);
  const [open, setOpen]     = useState(null);
  const [enrich, setEnrich] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [f, setF]           = useState({ status: '', owner: '', confidence: '', q: '', minReviews: '', minRating: '', social: '' });
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    setBusy(true);
    try { setLeads((await api.leads(f)).leads); } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }, [f]);

  useEffect(() => { load(); }, [load]);

  const owners = [...new Set(leads.map(l => l.delivered_to).filter(Boolean))];

  // Backfill social pages for leads scanned before social lookup existed.
  const unchecked = leads.filter(l => !l.socials_checked_at);
  const findSocials = async () => {
    const ids = unchecked.map(l => l.place_id);
    setEnrich({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += 10) {
        await api.socials(ids.slice(i, i + 10));
        setEnrich({ done: Math.min(i + 10, ids.length), total: ids.length });
      }
      await load();
      setEnrich(null);
    } catch (e) {
      setEnrich({ error: e.message });
    }
  };

  const exportXLSX = () => {
    const H = ['Name','Address','Phone','Type','Rating','Reviews','Status','Confidence','Hot (FB, no site)','Facebook','Instagram','Same-name domains','Owner','Delivered','Last note','Maps'];
    const rows = leads.map(l => [
      l.name, l.address, l.phone, l.type, l.rating ?? '', l.reviews,
      STATUS_META[l.status]?.label || l.status,
      l.confidence === 'high' ? 'TRUE LEAD' : 'VERIFY',
      l.facebook_url && l.confidence === 'high' ? 'HOT' : '',
      l.facebook_url || '', l.instagram_url || '',
      (l.found_domains || []).join(', ') || '—',
      l.delivered_to, new Date(l.delivered_at).toLocaleDateString(),
      l.last_note || '', l.maps_url,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Leads');
    XLSX.writeFile(wb, `leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const field = isMobile ? { flex: '1 1 45%', minWidth: 0 } : {};

  return (
    <div>
      {/* Search is always visible; the rest collapse on mobile to save a screenful. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={label}>Search</label>
          <input style={input} value={f.q} onChange={e => set('q', e.target.value)} placeholder="Name, address, phone" />
        </div>
        {isMobile && (
          <button onClick={() => setShowFilters(v => !v)} style={btnGhost}>
            {showFilters ? 'Hide' : 'Filters'}
          </button>
        )}
      </div>

      {(!isMobile || showFilters) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ ...field, width: isMobile ? undefined : 140 }}>
            <label style={label}>Status</label>
            <select style={input} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          <div style={{ ...field, width: isMobile ? undefined : 140 }}>
            <label style={label}>Owner</label>
            <select style={input} value={f.owner} onChange={e => set('owner', e.target.value)}>
              <option value="">Everyone</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div style={{ ...field, width: isMobile ? undefined : 130 }}>
            <label style={label}>Confidence</label>
            <select style={input} value={f.confidence} onChange={e => set('confidence', e.target.value)}>
              <option value="">All</option>
              <option value="high">True lead</option>
              <option value="review">Verify</option>
            </select>
          </div>
          <div style={{ ...field, width: isMobile ? undefined : 150 }}>
            <label style={label}>Social</label>
            <select style={input} value={f.social} onChange={e => set('social', e.target.value)}>
              <option value="">Any</option>
              <option value="hot">🔥 FB page, no site</option>
              <option value="has">Has FB or IG</option>
              <option value="none">No social found</option>
              <option value="unchecked">Not checked yet</option>
            </select>
          </div>
          <div style={{ ...field, width: isMobile ? undefined : 110 }}>
            <label style={label}>Min reviews</label>
            <input style={input} type="number" min={0} value={f.minReviews} onChange={e => set('minReviews', e.target.value)} />
          </div>
          <div style={{ ...field, width: isMobile ? undefined : 110 }}>
            <label style={label}>Min rating</label>
            <select style={input} value={f.minRating} onChange={e => set('minRating', e.target.value)}>
              <option value="">Any</option>
              <option value="3">3.0+</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={exportXLSX} disabled={!leads.length} style={{ ...btnGhost, flex: isMobile ? 1 : undefined }}>Export Excel</button>
        {unchecked.length > 0 && (
          <button onClick={findSocials} disabled={!!enrich} style={{ ...btnGhost, flex: isMobile ? 1 : undefined }}>
            {enrich ? (enrich.error ? 'Failed' : `Checking ${enrich.done}/${enrich.total}…`) : `Find socials (${unchecked.length})`}
          </button>
        )}
      </div>
      {enrich?.error && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{enrich.error}</div>}

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700 }}>
          {busy ? 'Loading…' : `${leads.length} lead${leads.length === 1 ? '' : 's'}`}
        </div>

        {isMobile ? (
          leads.map(l => (
            <LeadCard key={l.place_id} lead={l}
              open={open === l.place_id}
              onToggle={() => setOpen(open === l.place_id ? null : l.place_id)}
              onChanged={load} />
          ))
        ) : (
          <div className="scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Business', 'Phone', 'Rating', 'Status', 'Finding', 'Social', 'Owner', 'Activity'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {leads.map(l => {
                  const isOpen = open === l.place_id;
                  return [
                    <tr key={l.place_id} onClick={() => setOpen(isOpen ? null : l.place_id)} style={{ cursor: 'pointer', background: isOpen ? C.panel : C.bg }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div style={{ fontSize: 11, color: C.sub }}>{l.address}</div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><Phone number={l.phone} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.rating ? `${l.rating} (${l.reviews})` : '—'}</td>
                      <td style={td}><Badge bg={STATUS_META[l.status]?.bg} fg={STATUS_META[l.status]?.fg}>{STATUS_META[l.status]?.label || l.status}</Badge></td>
                      <td style={td}>
                        {l.confidence === 'review'
                          ? <Badge bg="#fffbeb" fg={C.amber}>Verify</Badge>
                          : <Badge bg="#ecfdf5" fg={C.green}>True lead</Badge>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><SocialCell lead={l} /></td>
                      <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{l.delivered_to}</td>
                      <td style={{ ...td, fontSize: 12, color: C.sub, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.note_count > 0 ? `${l.note_count} · ${l.last_note || ''}` : '—'}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={l.place_id + '-x'}>
                        <td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                          <NotePanel lead={l} onChanged={load} isMobile={false} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
