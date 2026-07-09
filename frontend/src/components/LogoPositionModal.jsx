import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Modal zum Neu-Positionieren des Logo-Overlays auf einem Creative.
// Zeigt bild_ohne_logo_url als Base + Logo-Overlay (Preview via CSS).
// Beim Speichern: PATCH /creatives/:id/logo-position, das Backend rendert
// per Sharp neu und liefert das aktualisierte Creative zurück.
export default function LogoPositionModal({ open, creative, logoUrl, onClose, onSaved }) {
  const [pos, setPos] = useState({ x: 0.87, y: 0.10, width_pct: 0.20 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const logoDimsRef = useRef({ w: 1, h: 1 });

  useEffect(() => {
    if (!open) return;
    setError('');
    const p = creative?.logo_position || {};
    const wp = Number.isFinite(p.width_pct) ? p.width_pct : 0.20;
    setPos({
      x: Number.isFinite(p.x) ? p.x : 1 - wp / 2 - 0.03,
      y: Number.isFinite(p.y) ? p.y : 0.10,
      width_pct: wp,
    });
  }, [open, creative]);

  function startDrag(e) {
    if (!stageRef.current) return;
    e.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    const move = (ev) => {
      const point = ev.touches?.[0] || ev;
      const relX = (point.clientX - rect.left) / rect.width;
      const relY = (point.clientY - rect.top) / rect.height;
      setPos(prev => ({
        ...prev,
        x: clamp(relX, 0, 1),
        y: clamp(relY, 0, 1),
      }));
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', stop);
  }

  async function save() {
    setError(''); setSaving(true);
    try {
      const res = await api(`/creatives/${creative.id}/logo-position`, {
        method: 'PATCH',
        body: { x: pos.x, y: pos.y, width_pct: pos.width_pct },
      });
      if (onSaved) onSaved(res.creative);
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open || !creative) return null;

  const baseUrl = creative.bild_ohne_logo_url;
  const canEdit = !!baseUrl && !!logoUrl;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Logo positionieren"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !canEdit}>
            {saving ? 'Rendere neu…' : 'Anwenden'}
          </button>
        </>
      }
    >
      {!canEdit ? (
        <p style={{ color: '#9a5a00' }}>
          Für dieses Creative kann die Logo-Position nicht nachjustiert werden — es fehlt entweder das Roh-Bild
          (nur bei Creatives verfügbar, die mit der neuen Overlay-Pipeline generiert wurden) oder es ist kein
          Kunden-Logo hinterlegt. Bitte das Creative neu generieren.
        </p>
      ) : (
        <>
          <div
            ref={stageRef}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 480,
              margin: '0 auto',
              aspectRatio: creative.format === 'story' ? '2 / 3' : '1 / 1',
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            <img
              src={baseUrl}
              alt=""
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
            />
            <div
              ref={dragRef}
              onMouseDown={startDrag}
              onTouchStart={startDrag}
              style={{
                position: 'absolute',
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                width: `${pos.width_pct * 100}%`,
                transform: 'translate(-50%, -50%)',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6%',
                background: 'rgba(255,255,255,0.75)',
                borderRadius: '14%',
                boxShadow: '0 0 0 2px rgba(0,120,255,0.8)',
              }}
              onLoad={(e) => {
                const img = e.target.querySelector('img');
                if (img) logoDimsRef.current = { w: img.naturalWidth, h: img.naturalHeight };
              }}
            >
              <img
                src={logoUrl}
                alt="Logo"
                draggable={false}
                style={{ width: '100%', height: 'auto', pointerEvents: 'none', display: 'block' }}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <span style={{ minWidth: 90 }}>Logo-Größe</span>
              <input
                type="range"
                min="0.08"
                max="0.40"
                step="0.01"
                value={pos.width_pct}
                onChange={e => setPos(p => ({ ...p, width_pct: Number(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: 40, textAlign: 'right', color: '#5a5955', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(pos.width_pct * 100)}%
              </span>
            </label>
            <p style={{ fontSize: 12, color: '#5a5955', marginTop: 10 }}>
              Ziehe das Logo im Bild, um es zu verschieben. Die tatsächliche Darstellung erhält
              beim Speichern automatisch einen dezenten halbtransparenten Hintergrund für die Lesbarkeit.
            </p>
            {error && <p style={{ color: '#c1272d', fontSize: 13, marginTop: 8 }}>{error}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
