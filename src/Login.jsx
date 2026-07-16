import { useState } from 'react';
import { api, setSession } from './api.js';
import { C, font, input, btn, label } from './ui.jsx';

export default function Login({ onDone }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { token, name: clean } = await api.login(name, password);
      setSession(token, clean);
      onDone(clean);
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} style={{ width: 340, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Lead Agent</h1>
        <p style={{ margin: '4px 0 20px', fontSize: 12, color: C.sub }}>Sign in with your team password.</p>

        <label style={label}>Your name</label>
        <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rahim" autoFocus />

        <div style={{ height: 12 }} />
        <label style={label}>Team password</label>
        <input style={input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

        {err && <div style={{ marginTop: 12, fontSize: 12, color: C.red }}>{err}</div>}

        <div style={{ height: 18 }} />
        <button type="submit" disabled={busy || !name.trim() || !password} style={{ ...btn(busy || !name.trim() || !password), width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
