// Gezielte Änderung an EINEM bestehenden Creative — kleiner Eingriff, Motiv
// bleibt. Zwei-Schritt: Wunsch eingeben -> Vorschau erzeugen (OpenAI-Edit auf
// dem Basisbild bzw. deterministisches Overlay-Rerender) -> Vorher/Nachher ->
// Übernehmen (neue Version neben dem Original) oder Neu versuchen.
//
// Das Vorher/Nachher ist bewusst verpflichtend: gpt-image-2-Edits mit Text sind
// gut, aber nicht immer pixelperfekt. Overlay-Creatives sind deterministisch.

import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

export default function CreativeEditModal({ open, creative, onClose, onApplied, initialWunsch = '' }) {
  const [wunsch, setWunsch] = useState('');
  const [preview, setPreview] = useState(null);   // { bild_url, bild_ohne_logo_url, typ }
  const [deterministisch, setDeterministisch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setWunsch(initialWunsch || ''); setPreview(null); setErr(''); }
  }, [open, creative?.id, initialWunsch]);

  async function vorschau() {
    if (!wunsch.trim()) return;
    setBusy(true); setErr(''); setPreview(null);
    try {
      const res = await api(`/creatives/${creative.id}/edit-preview`, {
        method: 'POST', body: { wunsch: wunsch.trim() },
      });
      setPreview(res.preview);
      setDeterministisch(!!res.deterministisch);
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setBusy(false); }
  }

  async function uebernehmen() {
    if (!preview?.bild_url) return;
    setSaving(true); setErr('');
    try {
      const res = await api(`/creatives/${creative.id}/edit-apply`, {
        method: 'POST',
        body: { wunsch: wunsch.trim(), bild_url: preview.bild_url, bild_ohne_logo_url: preview.bild_ohne_logo_url },
      });
      onApplied?.(res.creative);
      onClose?.();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setSaving(false); }
  }

  if (!creative) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="✏️ Gezielt ändern"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose} disabled={busy || saving}>Abbrechen</button>
          {!preview && (
            <button className="btn-primary" onClick={vorschau} disabled={busy || !wunsch.trim()}>
              {busy ? 'Erzeuge Vorschau…' : 'Vorschau erzeugen'}
            </button>
          )}
          {preview && (
            <>
              <button className="btn-ghost" onClick={vorschau} disabled={busy || saving}>
                {busy ? 'Neuer Versuch…' : '🔄 Neu versuchen'}
              </button>
              <button className="btn-primary" onClick={uebernehmen} disabled={busy || saving}>
                {saving ? 'Übernehme…' : '✓ Übernehmen'}
              </button>
            </>
          )}
        </div>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 0 }}>
        Das bestehende Creative bleibt erhalten — es wird <strong>nur der Wunsch</strong> geändert,
        Motiv und Komposition bleiben. Das Ergebnis kommt als neue Version neben das Original.
      </p>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Was soll geändert werden?</label>
      <textarea
        rows={3}
        value={wunsch}
        onChange={e => setWunsch(e.target.value)}
        placeholder={'z. B. Hook-Text ändern zu: „Echte Zukunft statt leerer Versprechen"\noder: Benefit „Firmenwagen" durch „4-Tage-Woche" ersetzen'}
        disabled={busy || saving}
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, resize: 'vertical' }}
      />

      {busy && !preview && (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
          Die KI bearbeitet das Bild — das dauert typischerweise <strong>1–3 Minuten</strong>. Bitte das Fenster offen lassen.
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}

      {preview && (
        <>
          {deterministisch
            ? <div style={{ fontSize: 12, color: '#166534', margin: '12px 0 6px' }}>✓ Overlay — Text exakt geändert (deterministisch).</div>
            : <div style={{ fontSize: 12, color: '#78350f', margin: '12px 0 6px' }}>
                ⚠️ KI-Edit: bitte vergleichen — gelegentlich ändert sich das Schriftbild leicht mit. Sonst „Neu versuchen".
              </div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>Vorher</div>
              <img src={creative.bild_url} alt="Vorher" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#0a0a0a', marginBottom: 4 }}>Nachher ✨</div>
              <img src={preview.bild_url} alt="Nachher" style={{ width: '100%', borderRadius: 8, border: '2px solid #16a34a', display: 'block' }} />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
