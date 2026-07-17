// Design tokens: white surfaces, black controls, flat fills — no gradients anywhere.
export const C = {
  bg:     '#ffffff',
  panel:  '#fafafa',
  text:   '#0a0a0a',
  sub:    '#6b7280',
  muted:  '#9ca3af',
  border: '#e5e7eb',
  line:   '#f3f4f6',
  black:  '#000000',
  green:  '#15803d',
  red:    '#b91c1c',
  amber:  '#b45309',
  blue:   '#1d4ed8',
};

export const font = "'Inter','Segoe UI',system-ui,-apple-system,sans-serif";

export const STATUS_META = {
  new:            { label: 'New',            bg: '#f3f4f6', fg: '#374151' },
  contacted:      { label: 'Contacted',      bg: '#eff6ff', fg: C.blue },
  callback:       { label: 'Callback',       bg: '#fffbeb', fg: C.amber },
  interested:     { label: 'Interested',     bg: '#ecfdf5', fg: C.green },
  quoted:         { label: 'Quoted',         bg: '#eef2ff', fg: '#4338ca' },
  unqualified:    { label: 'Unqualified',    bg: '#f5f5f4', fg: '#78716c' },
  not_interested: { label: 'Not interested', bg: '#fef2f2', fg: C.red },
  won:            { label: 'Won',            bg: '#dcfce7', fg: '#14532d' },
  lost:           { label: 'Lost',           bg: '#f3f4f6', fg: '#6b7280' },
};
export const STATUSES = Object.keys(STATUS_META);

export const input = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
};

export const btn = (disabled = false) => ({
  padding: '9px 16px', border: 'none', borderRadius: 6,
  background: disabled ? '#d1d5db' : C.black,
  color: '#ffffff', fontWeight: 600, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
});

export const btnGhost = {
  padding: '8px 14px', borderRadius: 6, background: C.bg,
  border: `1px solid ${C.border}`, color: C.text,
  fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};

export const card = {
  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16,
};

export const label = {
  fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 5, display: 'block',
};

export const th = {
  padding: '9px 12px', textAlign: 'left', color: C.sub, fontSize: 10,
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6,
  borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: C.panel,
};

export const td = { padding: '10px 12px', borderBottom: `1px solid ${C.line}`, fontSize: 13 };

export function Badge({ children, bg = C.line, fg = C.text }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: bg, color: fg, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

const socialLink = {
  padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600,
  textDecoration: 'none', border: `1px solid ${C.border}`, color: C.text,
};

/** Phone number as a tap-to-call link — the main action on a phone. */
export function Phone({ number }) {
  if (!number) return <span style={{ color: C.muted }}>—</span>;
  return (
    <a href={`tel:${number.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}
      style={{ color: C.blue, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {number}
    </a>
  );
}

/**
 * A business with an active Facebook page but no website is the best lead there
 * is: already selling online, visibly missing a real site. That combination gets
 * a HOT badge — it's the pitch.
 */
export function SocialCell({ lead }) {
  const fb = lead.facebook_url, ig = lead.instagram_url;
  const hot = fb && lead.confidence === 'high';
  if (!fb && !ig) {
    return <span style={{ color: C.muted, fontSize: 11 }}>{lead.socials_checked_at ? 'none found' : '—'}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {hot && <Badge bg={C.black} fg="#fff">HOT</Badge>}
      {fb && <a href={fb} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={socialLink}>FB</a>}
      {ig && <a href={ig} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={socialLink}>IG</a>}
    </span>
  );
}
