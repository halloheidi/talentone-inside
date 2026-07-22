// Gezielte Änderung an EINEM bestehenden Creative — kleiner Eingriff, Motiv
// bleibt. Zwei-Schritt: Wunsch eingeben -> Vorschau erzeugen (OpenAI-Edit auf
// dem Basisbild bzw. deterministisches Overlay-Rerender) -> Vorher/Nachher ->
// Übernehmen (neue Version neben dem Original) oder Neu versuchen.
//
// Das Vorher/Nachher ist bewusst verpflichtend: gpt-image-2-Edits mit Text sind
// gut, aber nicht immer pixelperfekt. Overlay-Creatives sind deterministisch.

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Feuert-und-vergisst: verworfene Vorschau-Dateien im Storage loeschen.
function discard(preview) {
  if (!preview) return;
  const urls = [preview.bild_url, preview.bild_ohne_logo_url].filter(Boolean);
  if (urls.length) api('/creatives/edit-discard', { method: 'POST', body: { urls } }).catch(() => {});
}

export default function CreativeEditModal({ open, creative, onClose, onApplied, initialWunsch = '' }) {
  const [wunsch, setWunsch] = useState('');
  const [logoAufKleidung, setLogoAufKleidung] = useState(false);
  const [logoModus, setLogoModus] = useState('voll'); // 'voll' = komplett inkl. Schriftzug | 'icon'
  const [preview, setPreview] = useState(null);   // { bild_url, bild_ohne_logo_url, typ }
  const [deterministisch, setDeterministisch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const appliedRef = useRef(false);

  useEffect(() => {
    if (open) { setWunsch(initialWunsch || ''); setLogoAufKleidung(false); setLogoModus('voll'); setPreview(null); setErr(''); appliedRef.current = false; }
  }, [open, creative?.id, initialWunsch]);

  async function vorschau() {
    if (!wunsch.trim()) return;
    discard(preview);              // alte Vorschau verwerfen (kein Storage-Muell bei "Neu versuchen")
    setBusy(true); setErr(''); setPreview(null);
    try {
      const res = await api(`/creatives/${creative.id}/edit-preview`, {
        method: 'POST', body: { wunsch: wunsch.trim(), logo_auf_kleidung: logoAufKleidung, logo_kleidung_modus: logoModus },
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
      appliedRef.current = true;   // uebernommene Vorschau NICHT verwerfen
      onApplied?.(res.creative, creative);
      onClose?.();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setSaving(false); }
  }

  // Schliessen ohne Uebernehmen -> nicht genutzte Vorschau aufraeumen.
  function handleClose() {
    if (!appliedRef.current) discard(preview);
    onClose?.();
  }

  if (!creative) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="✏️ Gezielt ändern"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={handleClose} disabled={busy || saving}>Abbrechen</button>
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

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={logoAufKleidung} onChange={e => setLogoAufKleidung(e.target.checked)} disabled={busy || saving} style={{ marginTop: 2 }} />
        <span>
          🏷️ <strong>Logo auf Kleidung platzieren</strong>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
            Das echte Firmenlogo wird der KI mitgegeben und aufs Shirt/die Arbeitskleidung eingearbeitet — kleine
            Details können leicht abweichen. Das exakte Eck-Logo oben im Creative bleibt davon unberührt.
          </span>
        </span>
      </label>

      {logoAufKleidung && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0 0 26px', fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="logoModusEdit" checked={logoModus === 'voll'} onChange={() => setLogoModus('voll')} disabled={busy || saving} />
            Komplettes Logo mit Schriftzug
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="logoModusEdit" checked={logoModus === 'icon'} onChange={() => setLogoModus('icon')} disabled={busy || saving} />
            Nur Bildzeichen/Icon (dezent)
          </label>
          <span style={{ color: 'var(--ink-4)' }}>
            Bei sehr kleiner Platzierung kann feiner Schriftzug unleserlich werden — dann das Logo größer platzieren
            lassen (z.&nbsp;B. Brust statt Mini-Stick).
          </span>
        </div>
      )}

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
