// Manueller AVV-Versand: eine eigene Mail mit prominentem Button zur Public-AVV-
// Seite. Geteilt von KundeDetail und KundenListe ("eine Quelle, vier Türen").
// Empfänger vorbefüllt/editierbar, Kurztext optional (leer = Standardtext),
// Anrede nach anrede_form (AnredeAbfrage, falls noch offen).

import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import AnredeAbfrage from './AnredeAbfrage.jsx';
import { anredeOffen } from '../lib/anrede.js';
import { api } from '../lib/api.js';

export default function AvvAnfrageModal({ open, kunde: kundeProp, onClose, onSent }) {
  const [kunde, setKunde] = useState(kundeProp || null);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (open) {
      setKunde(kundeProp || null);
      setTo(kundeProp?.email || '');
      setText('');
      setMsg('');
      setErr(false);
    }
  }, [open, kundeProp?.id]);

  if (!kunde) return null;

  async function send() {
    if (!to.trim()) { setErr(true); setMsg('Empfänger-E-Mail fehlt.'); return; }
    setBusy(true); setMsg(''); setErr(false);
    try {
      await api(`/kunden/${kunde.id}/avv-anfrage`, { method: 'POST', body: { to: to.trim(), text: text.trim() || undefined } });
      setMsg(`AVV-Anfrage an ${to.trim()} verschickt.`);
      onSent?.();
      setTimeout(() => { onClose?.(); }, 1400);
    } catch (e) {
      setErr(true); setMsg(e.body?.error || e.message || 'Versand fehlgeschlagen.');
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose?.()}
      title="📄 AVV zur Unterschrift senden"
      footer={
        <>
          <button className="btn-ghost" onClick={() => onClose?.()} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={send} disabled={busy || !to.trim() || anredeOffen(kunde)}>
            {busy ? 'Sende…' : 'AVV-Anfrage senden'}
          </button>
        </>
      }
    >
      <p className="pane-hint">
        Wir schicken <strong>{kunde.firmenname}</strong> eine Mail mit einem persönlichen Button
        „AVV ansehen &amp; akzeptieren" — dort kann der Kunde den Vertrag als PDF ansehen und mit
        einem Klick (Name + Bestätigung) akzeptieren. Anschließend läuft alles wie gehabt (Badge,
        Checkliste, Bestätigungs-Mail).
      </p>
      <label className="field field-full">
        <span>Empfänger</span>
        <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="kunde@firma.de" disabled={busy} />
      </label>
      <AnredeAbfrage kunde={kunde} onSaved={k => setKunde(k)} />
      <label className="field field-full">
        <span>Persönlicher Text (optional — leer = Standardtext)</span>
        <textarea rows={5} value={text} onChange={e => setText(e.target.value)} disabled={busy}
          placeholder="Leer lassen für den Standard-AVV-Text (folgt automatisch der Anrede)." />
      </label>
      {msg && (
        <div className={`form-msg${err ? ' alert alert-error' : ''}`} style={{ marginTop: 8, ...(err ? { color: '#b00020', fontWeight: 600 } : {}) }}>
          {err ? '⚠️ ' : ''}{msg}
        </div>
      )}
    </Modal>
  );
}
