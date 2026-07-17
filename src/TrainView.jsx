import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';
import { C, card, input, btn, btnGhost, label, Badge } from './ui.jsx';
import { useIsMobile } from './useIsMobile.js';

const READ_ALOUD = `Assalamu alaikum, ami Zeriotic theke bolchi. Apnar business er jonno ekta professional website thakle,
customer ra Google e search kore apnake khuje pabe — apnar kaj, price, contact shob ek jaygay dekhte parbe.
Facebook page thaka khub bhalo, kintu website apnar nijer property — eta kono algorithm er upor depend kore na.
Amra choto business der jonno affordable package niye kaj kori. Apni chaile ami details WhatsApp e pathiye dite pari.
Thank you, bhalo thakben!`;

/** Records ~60–120s of the employee reading the sample, then clones the voice. */
function VoiceTrainer() {
  const [d, setD] = useState(null);
  const [rec, setRec] = useState(null);     // { recorder, t0 }
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);     // { ok, text }
  const chunks = useRef([]);
  const timer = useRef(null);

  const load = () => api.voiceGet().then(setD).catch(e => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);

  const start = async () => {
    setMsg(null); setBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        setBlob(new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.start();
      setRec({ recorder });
      setElapsed(0);
      timer.current = setInterval(() => setElapsed(s => {
        if (s + 1 >= 120) { recorder.stop(); clearInterval(timer.current); setRec(null); }
        return s + 1;
      }), 1000);
    } catch {
      setMsg({ ok: false, text: 'Microphone access denied — allow the mic in your browser and try again.' });
    }
  };

  const stop = () => { rec?.recorder.stop(); clearInterval(timer.current); setRec(null); };

  const upload = async () => {
    setBusy(true); setMsg(null);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      await api.voiceUpload(dataUrl, blob.type);
      setBlob(null);
      setMsg({ ok: true, text: 'Voice trained! The AI now calls with your cloned voice.' });
      load();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm('Delete your voice clone? The AI falls back to the stock voice.')) return;
    await api.voiceDelete().catch(() => {});
    setMsg(null); load();
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Your voice</div>
      <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>
        Record yourself reading the passage below for at least 60 seconds. The AI clones your voice and uses it on
        every call you start. Record somewhere quiet, on a decent mic, at your natural calling pace.
      </div>

      {d && !d.elevenlabs && (
        <div style={{ background: '#fef2f2', border: `1px solid ${C.red}33`, borderRadius: 6, padding: 10, fontSize: 12, color: C.red, marginBottom: 10 }}>
          Voice training needs ELEVENLABS_API_KEY set in Vercel (Starter plan, $5/mo, includes voice cloning).
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Badge bg={d?.profile ? '#ecfdf5' : C.line} fg={d?.profile ? C.green : C.sub}>
          {d?.profile ? 'Voice trained ✓' : 'Not trained — stock voice in use'}
        </Badge>
        {d?.profile && <span style={{ fontSize: 11, color: C.muted }}>trained {new Date(d.profile.created_at).toLocaleDateString()}</span>}
        {d?.profile && <button onClick={remove} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11, marginLeft: 'auto' }}>Delete</button>}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, fontSize: 12, lineHeight: 1.7, marginBottom: 12, whiteSpace: 'pre-line' }}>
        {READ_ALOUD}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!rec && !blob && (
          <button onClick={start} disabled={!d?.elevenlabs} style={btn(!d?.elevenlabs)}>● Start recording</button>
        )}
        {rec && (
          <>
            <button onClick={stop} style={{ ...btn(false), background: C.red }}>■ Stop ({elapsed}s)</button>
            <span style={{ fontSize: 12, color: elapsed < 60 ? C.amber : C.green }}>
              {elapsed < 60 ? `Keep going — ${60 - elapsed}s more for a good clone` : 'Long enough — stop when you finish the passage'}
            </span>
          </>
        )}
        {blob && !rec && (
          <>
            <audio controls src={URL.createObjectURL(blob)} style={{ height: 36 }} />
            <button onClick={upload} disabled={busy} style={btn(busy)}>{busy ? 'Training…' : d?.profile ? 'Replace my voice' : 'Train my voice'}</button>
            <button onClick={() => setBlob(null)} style={btnGhost}>Discard</button>
          </>
        )}
      </div>

      {msg && <div style={{ marginTop: 10, fontSize: 12, color: msg.ok ? C.green : C.red }}>{msg.text}</div>}
    </div>
  );
}

function PersonaEditor() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ script: '', style_notes: '', qa_pairs: [] });
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState(null);   // { draft, rationale }
  const [saved, setSaved] = useState('');
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try {
      const data = await api.personas();
      setD(data);
      const active = data.personas.find(p => p.status === 'active');
      const qa = active?.qa_pairs
        ? (typeof active.qa_pairs === 'string' ? JSON.parse(active.qa_pairs) : active.qa_pairs)
        : [];
      setF({
        script: active?.script || data.defaults.script,
        style_notes: active?.style_notes || data.defaults.style_notes,
        qa_pairs: Array.isArray(qa) ? qa : [],
      });
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy('save'); setSaved('');
    try {
      await api.savePersona(f);
      setSaved('Saved — the next call uses this pitch.');
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const improve = async () => {
    setBusy('improve'); setErr(''); setDraft(null);
    try { setDraft(await api.improvePersona()); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const act = async (id, action) => {
    await api.personaAction(id, action).catch(e => setErr(e.message));
    setDraft(null);
    load();
  };

  const setQa = (i, k, v) => setF(p => {
    const qa = [...p.qa_pairs]; qa[i] = { ...qa[i], [k]: v }; return { ...p, qa_pairs: qa };
  });

  if (err && !d) return <div style={{ color: C.red, fontSize: 13 }}>{err}</div>;
  if (!d) return <div style={{ color: C.sub, fontSize: 13 }}>Loading…</div>;

  const versions = d.personas.filter(p => p.status !== 'draft');

  return (
    <>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Your pitch</div>
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 12 }}>
          This is what the AI says on your calls — write it the way you would pitch. Saving creates a new version;
          old versions stay below so you can roll back.
        </div>

        <label style={label}>Pitch script</label>
        <textarea rows={9} value={f.script} onChange={e => setF(p => ({ ...p, script: e.target.value }))}
          style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} />

        <div style={{ height: 12 }} />
        <label style={label}>Talking style (how you sound, not what you say)</label>
        <textarea rows={3} value={f.style_notes} onChange={e => setF(p => ({ ...p, style_notes: e.target.value }))}
          style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} />

        <div style={{ height: 12 }} />
        <label style={label}>Objection handling — your trained answers</label>
        {f.qa_pairs.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexDirection: isMobile ? 'column' : 'row' }}>
            <input style={{ ...input, flex: 1 }} placeholder='They say… e.g. "Facebook e customer pai, website lagbe na"'
              value={p.q || ''} onChange={e => setQa(i, 'q', e.target.value)} />
            <input style={{ ...input, flex: 2 }} placeholder="You answer…"
              value={p.a || ''} onChange={e => setQa(i, 'a', e.target.value)} />
            <button onClick={() => setF(x => ({ ...x, qa_pairs: x.qa_pairs.filter((_, j) => j !== i) }))}
              style={{ ...btnGhost, padding: '6px 10px' }}>✕</button>
          </div>
        ))}
        <button onClick={() => setF(p => ({ ...p, qa_pairs: [...p.qa_pairs, { q: '', a: '' }] }))}
          style={{ ...btnGhost, fontSize: 12 }}>+ Add objection</button>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={save} disabled={busy === 'save'} style={btn(busy === 'save')}>
            {busy === 'save' ? 'Saving…' : 'Save as new version'}
          </button>
          <button onClick={improve} disabled={busy === 'improve' || !d.anthropic}
            title={d.anthropic ? '' : 'Set ANTHROPIC_API_KEY in Vercel to enable'}
            style={{ ...btnGhost, opacity: d.anthropic ? 1 : 0.5 }}>
            {busy === 'improve' ? 'Analyzing your calls…' : '✨ Improve from my calls'}
          </button>
          {saved && <span style={{ fontSize: 12, color: C.green }}>{saved}</span>}
        </div>
        {err && <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>{err}</div>}
      </div>

      {draft && (
        <div style={{ ...card, border: `2px solid ${C.black}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            Proposed improvement <Badge bg="#eef2ff" fg="#4338ca">draft — not live</Badge>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>
            Based on {draft.calls_analyzed} recent calls. Nothing changes until you activate it.
          </div>
          {draft.rationale && (
            <div style={{ background: C.panel, borderRadius: 6, padding: 10, fontSize: 12, whiteSpace: 'pre-line', marginBottom: 10 }}>
              {draft.rationale}
            </div>
          )}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'inherit', background: C.panel, borderRadius: 6, padding: 10, maxHeight: 260, overflowY: 'auto' }}>
            {draft.draft.script}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => act(draft.draft.id, 'activate')} style={btn(false)}>Activate this version</button>
            <button onClick={() => act(draft.draft.id, 'discard')} style={btnGhost}>Discard</button>
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700 }}>Versions</div>
          {versions.map(p => (
            <div key={p.id} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>v{p.version}</span>
              <Badge bg={p.status === 'active' ? '#ecfdf5' : C.line} fg={p.status === 'active' ? C.green : C.sub}>
                {p.status === 'active' ? 'Live' : 'Archived'}
              </Badge>
              {p.source === 'ai_improved' && <Badge bg="#eef2ff" fg="#4338ca">AI-improved</Badge>}
              <span style={{ color: C.muted }}>{p.owner} · {new Date(p.created_at).toLocaleDateString()}</span>
              <span style={{ color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {p.script.slice(0, 80)}…
              </span>
              {p.status !== 'active' && (
                <button onClick={() => act(p.id, 'activate')} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11, flexShrink: 0 }}>
                  Activate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function TrainView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <VoiceTrainer />
      <PersonaEditor />
    </div>
  );
}
