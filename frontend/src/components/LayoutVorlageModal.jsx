import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Konfigurations- + Vorschau-Dialog für die deterministischen Layout-Vorlagen.
// Flow: beim Öffnen einmal Vorschau rendern (liefert die Default-Slots zurück) →
// Slots editierbar → "Vorschau aktualisieren" → "Übernehmen" rendert 1:1 + 9:16
// und legt die Creatives an. Der Freisteller lässt sich an-/abschalten (Fallback
// = abgedunkeltes Vollbild, identisches Text-Layout).
export default function LayoutVorlageModal({ open, job, vorlage, fotoId, spruch, onClose, onCreated }) {
  const [slots, setSlots] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [freistellerOn, setFreistellerOn] = useState(true);
  const [freistellerOk, setFreistellerOk] = useState(false);
  const [freistellerReason, setFreistellerReason] = useState(null);
  const [warnungen, setWarnungen] = useState([]);
  const [loading, setLoading] = useState(false);   // Vorschau rendert
  const [saving, setSaving] = useState(false);      // Übernehmen läuft
  const [error, setError] = useState('');
  const initRef = useRef(false);

  const isB = vorlage === 'B';

  useEffect(() => {
    if (!open) { initRef.current = false; return; }
    if (initRef.current) return;
    initRef.current = true;
    setSlots(null); setPreviewUrl(null); setWarnungen([]); setError('');
    setFreistellerOn(true);
    // Erste Vorschau: nur spruch übergeben, Server liefert Default-Slots zurück.
    runPreview({ spruch }, true);
    // eslint-disable-next-line
  }, [open]);

  async function runPreview(slotOverride, useFreistellerDefault) {
    setLoading(true); setError('');
    try {
      const body = {
        job_id: job.id, vorlage, foto_id: fotoId,
        slots: slotOverride || slots || { spruch },
        freisteller: (useFreistellerDefault ? true : freistellerOn),
      };
      const res = await api('/creatives/layout-preview', { method: 'POST', body });
      setPreviewUrl(res.preview_url);
      setSlots(res.slots || {});
      setFreistellerOk(!!res.freisteller_ok);
      setFreistellerReason(res.freisteller_reason || null);
      setWarnungen(Array.isArray(res.lektorat_warnungen) ? res.lektorat_warnungen : []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    setSaving(true); setError('');
    try {
      const res = await api('/creatives/layout-render', {
        method: 'POST',
        body: { job_id: job.id, vorlage, foto_id: fotoId, slots: slots || {}, freisteller: freistellerOn },
      });
      if (onCreated) onCreated(res.creatives || []);
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  function setSlot(key, val) { setSlots(s => ({ ...(s || {}), [key]: val })); }

  if (!open) return null;

  const vorlageName = isB ? 'Person links + Textblock rechts' : 'Frage + Glow-Headline + Team';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Layout-Vorlage ${vorlage} — ${vorlageName}`}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-ghost" onClick={() => runPreview()} disabled={loading || saving}>
            {loading ? 'Rendere…' : '↻ Vorschau aktualisieren'}
          </button>
          <button type="button" className="btn-primary" onClick={commit} disabled={saving || loading || !previewUrl}>
            {saving ? 'Rendere 1:1 + 9:16…' : 'Übernehmen (1:1 + 9:16)'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* Vorschau (1:1) */}
        <div style={{ flex: '0 0 300px' }}>
          <div style={{ width: 300, aspectRatio: '1/1', background: '#111', borderRadius: 10, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {previewUrl
              ? <img src={previewUrl} alt="Vorschau" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ color: '#888', fontSize: 13 }}>{loading ? 'Rendere Vorschau…' : 'Keine Vorschau'}</span>}
            {loading && previewUrl && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>Aktualisiere…</div>
            )}
          </div>
          <p style={{ fontSize: 11, color: '#8a8a8a', marginTop: 8 }}>
            Vorschau in 1:1. Beim Übernehmen wird zusätzlich die 9:16-Story gerendert (Elemente in der Safe-Zone).
          </p>
        </div>

        {/* Slots + Optionen */}
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          {/* Freisteller */}
          <div style={{ marginBottom: 14, padding: '10px 12px', background: '#f6f6f4', borderRadius: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={freistellerOn} onChange={e => setFreistellerOn(e.target.checked)} />
              Personen-Freisteller verwenden
            </label>
            <div style={{ fontSize: 12, color: freistellerOk ? '#15803d' : '#9a5a00', marginTop: 4, marginLeft: 26 }}>
              {!freistellerOn
                ? 'Aus — Foto als abgedunkelter Vollhintergrund (Text-Layout identisch).'
                : freistellerOk
                ? '✓ Freisteller aktiv (Hintergrund entfernt).'
                : `⚠ Freisteller nicht verfügbar${freistellerReason ? ` (${freistellerReason})` : ''} — es wird automatisch das abgedunkelte Vollbild verwendet.`}
            </div>
          </div>

          {/* Slot-Editoren */}
          {slots && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {isB ? (
                <label className="field field-full">
                  <span>Textblock (rechts, Versalien) — <code>*Wort*</code> hebt ein Wort in Markenfarbe hervor</span>
                  <textarea rows={3} value={slots.textblock || ''} onChange={e => setSlot('textblock', e.target.value)}
                    placeholder={'z.B.\nWIR SUCHEN\n*DICH*'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                </label>
              ) : (
                <label className="field field-full">
                  <span>Hook-Frage (Balken oben) — je Zeile ein Balken</span>
                  <textarea rows={2} value={slots.hook || ''} onChange={e => setSlot('hook', e.target.value)}
                    placeholder={'z.B.\nZu wenig Wertschätzung im Job?'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                </label>
              )}

              <label className="field field-full">
                <span>Stellentitel (riesig, Glow)</span>
                <input type="text" value={slots.stelle || ''} onChange={e => setSlot('stelle', e.target.value)} />
              </label>

              <label className="field field-full">
                <span>Pill-Badge</span>
                <input type="text" value={slots.pill || ''} onChange={e => setSlot('pill', e.target.value)} />
              </label>
            </div>
          )}

          {/* Lektorat-Warnungen (nur Hinweis, keine Auto-Korrektur) */}
          {warnungen.length > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>📝 Lektorat-Hinweise (Wortlaut wird nicht automatisch geändert):</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#78350f' }}>
                {warnungen.map((w, i) => (
                  <li key={i}><strong>{w.slot}:</strong> {w.hinweis}{w.vorschlag ? ` → „${w.vorschlag}"` : ''}</li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </div>
    </Modal>
  );
}
