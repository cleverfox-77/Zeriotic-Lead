import { useState } from 'react';
import { getName, clearSession } from './api.js';
import { C, font, btnGhost } from './ui.jsx';
import { useIsMobile } from './useIsMobile.js';
import Login from './Login.jsx';
import ScanView from './ScanView.jsx';
import LeadsView from './LeadsView.jsx';
import ReportView from './ReportView.jsx';
import HealthView from './HealthView.jsx';

const TABS = [
  { id: 'scan',   label: 'Find leads' },
  { id: 'leads',  label: 'Pipeline' },
  { id: 'report', label: 'Reports' },
  { id: 'health', label: 'Setup' },
];

export default function App() {
  const [name, setName] = useState(getName());
  const [tab, setTab]   = useState('scan');
  const isMobile        = useIsMobile();

  if (!name) return <Login onDone={setName} />;

  const nav = (
    <nav style={{
      display: 'flex', gap: 4,
      ...(isMobile
        ? { marginTop: 12, overflowX: 'auto', paddingBottom: 2 } // scrolls if it can't fit
        : { marginLeft: 20 }),
    }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)}
          style={{ padding: isMobile ? '9px 16px' : '7px 14px', borderRadius: 6, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
            background: tab === t.id ? C.black : 'transparent',
            color:      tab === t.id ? '#fff'  : C.sub,
            border: `1px solid ${tab === t.id ? C.black : 'transparent'}` }}>
          {t.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: font, fontSize: 13 }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: isMobile ? '12px 12px 32px' : '18px 16px' }}>

        <header style={{ paddingBottom: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 15 : 16, fontWeight: 700 }}>
                Business Website Lead Agent
              </h1>
              {!isMobile && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>
                  Finds businesses with no website — never the same one twice.
                </p>
              )}
            </div>

            {!isMobile && nav}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: C.sub }}>
                {isMobile ? '' : 'Signed in as '}<strong style={{ color: C.text }}>{name}</strong>
              </span>
              <button onClick={() => { clearSession(); setName(null); }}
                style={{ ...btnGhost, padding: isMobile ? '6px 10px' : '8px 14px' }}>
                {isMobile ? 'Out' : 'Sign out'}
              </button>
            </div>
          </div>

          {isMobile && nav}
        </header>

        {tab === 'scan'   && <ScanView />}
        {tab === 'leads'  && <LeadsView />}
        {tab === 'report' && <ReportView />}
        {tab === 'health' && <HealthView />}
      </div>
    </div>
  );
}
