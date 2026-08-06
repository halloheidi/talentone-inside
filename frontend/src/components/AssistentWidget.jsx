import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Floating KI-Assistent (Phase 1). Button unten rechts, öffnet ein Chat-Panel.
// Konversation bleibt pro Browser-Session (sessionStorage) erhalten. Schreibende
// Aktionen liefert der Server als „pending" zurück und müssen hier per Klick
// bestätigt werden, bevor sie ausgeführt werden.

const STORAGE_KEY = 'to_assistent_messages_v1';

function loadMessages() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Text-Blöcke eines Turns zusammenführen.
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b?.type === 'text').map(b => b.text).join('\n').trim();
  return '';
}
function toolUsesOf(content) {
  return Array.isArray(content) ? content.filter(b => b?.type === 'tool_use') : [];
}
const TOOL_LABEL = {
  projekt_anlegen: 'Projekt anlegen',
  stale_projekte_abfragen: 'Stale-Projekte abfragen',
  email_vorlage_bearbeiten: 'E-Mail-Vorlage',
};

export default function AssistentWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);   // { id, name, summary, input }
  const [error, setError] = useState('');
  const approvalsRef = useRef({});                 // wächst über Bestätigungs-Runden
  const scrollRef = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending, busy, open]);

  async function callChat(nextMessages, approvals) {
    setBusy(true); setError('');
    try {
      const res = await api('/assistent/chat', { method: 'POST', body: { messages: nextMessages, approvals } });
      setMessages(res.messages || nextMessages);
      if (res.status === 'pending') setPending(res.pending);
      else setPending(null);
    } catch (err) {
      setError(err.body?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    approvalsRef.current = {};
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    await callChat(next, {});
  }

  async function confirmPending() {
    if (!pending) return;
    approvalsRef.current = { ...approvalsRef.current, [pending.id]: 'approved' };
    setPending(null);
    await callChat(messages, approvalsRef.current);
  }
  async function declinePending() {
    if (!pending) return;
    approvalsRef.current = { ...approvalsRef.current, [pending.id]: 'declined' };
    setPending(null);
    await callChat(messages, approvalsRef.current);
  }

  function resetChat() {
    setMessages([]); setPending(null); setError(''); approvalsRef.current = {};
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // Sichtbare Turns: user-Text + assistant-Text/Tool-Chips. tool_result-Turns intern.
  const visible = messages.filter(m => {
    if (m.role === 'user') return typeof m.content === 'string';   // tool_result-Turns raus
    return true;
  });

  return (
    <>
      {/* Floating-Button */}
      <button onClick={() => setOpen(o => !o)} title="TalentOne-Assistent"
        style={{
          position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: '50%',
          background: '#0a0a0a', color: '#d4ff00', border: 'none', cursor: 'pointer', zIndex: 1200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)', fontSize: 24, lineHeight: 1,
        }}>
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div style={panel}>
          {/* Kopf */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', borderBottom: '1px solid #ececea' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>TalentOne-Assistent <span style={{ fontSize: 10, fontWeight: 700, color: '#0a0a0a', background: '#d4ff00', padding: '1px 6px', borderRadius: 100, verticalAlign: 'middle' }}>Beta</span></div>
              <div style={{ fontSize: 11, color: '#9a9994' }}>Intern · Projekte, Stale-Check, Vorlagen</div>
            </div>
            <button onClick={resetChat} title="Neues Gespräch" style={iconBtn}>↺</button>
          </div>

          {/* Verlauf */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#f7f6f4' }}>
            {visible.length === 0 && (
              <div style={{ fontSize: 13, color: '#5a5955', lineHeight: 1.6 }}>
                Hallo! Ich kann Projekte anlegen, dir Projekte ohne Fortschritt anzeigen und E-Mail-Vorlagen lesen/ändern.
                <br /><br />Beispiele:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>„Welche Projekte hängen seit 10 Tagen?"</li>
                  <li>„Leg ein Projekt Elektroniker für Firma Muster an."</li>
                  <li>„Zeig mir den Betreff der Vorlage kampagne_live."</li>
                </ul>
              </div>
            )}
            {visible.map((m, i) => {
              const txt = textOf(m.content);
              const tools = m.role === 'assistant' ? toolUsesOf(m.content) : [];
              return (
                <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {txt && (
                    <div style={{
                      maxWidth: '85%', padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                      background: m.role === 'user' ? '#0a0a0a' : '#fff', color: m.role === 'user' ? '#fff' : '#1a1a1a',
                      border: m.role === 'user' ? 'none' : '1px solid #ececea',
                    }}>{txt}</div>
                  )}
                  {tools.map(t => (
                    <div key={t.id} style={{ fontSize: 11, color: '#5a5955', background: '#eef', border: '1px solid #dde', borderRadius: 8, padding: '3px 8px', marginTop: 4 }}>
                      🔧 {TOOL_LABEL[t.name] || t.name}
                    </div>
                  ))}
                </div>
              );
            })}

            {busy && <div style={{ fontSize: 12, color: '#9a9994' }}>Assistent denkt nach…</div>}
            {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}

            {/* Bestätigung schreibender Aktion */}
            {pending && (
              <div style={{ background: '#fffbe6', border: '1px solid #f0d98a', borderRadius: 12, padding: 12, marginTop: 6 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#5a4b00', whiteSpace: 'pre-wrap', marginBottom: 10 }}>{pending.summary}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" onClick={confirmPending} disabled={busy}>Ausführen</button>
                  <button className="btn-ghost btn-sm" onClick={declinePending} disabled={busy}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>

          {/* Eingabe */}
          <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #ececea', background: '#fff' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={pending ? 'Bitte oben bestätigen oder abbrechen…' : 'Nachricht… (Enter zum Senden)'}
              rows={1}
              disabled={busy || !!pending}
              style={{ flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 13.5, padding: '9px 11px', borderRadius: 10, border: '1px solid #d8d7d2', maxHeight: 120 }}
            />
            <button className="btn-primary" onClick={send} disabled={busy || !!pending || !input.trim()}>➤</button>
          </div>
        </div>
      )}
    </>
  );
}

const panel = {
  position: 'fixed', bottom: 92, right: 24, width: 'min(400px, calc(100vw - 32px))', height: 'min(600px, calc(100vh - 130px))',
  background: '#fff', borderRadius: 16, zIndex: 1200, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 20px 56px rgba(0,0,0,0.28)', border: '1px solid #e2e1dc',
};
const iconBtn = { background: '#f0efed', border: '1px solid #e2e1dc', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15 };
