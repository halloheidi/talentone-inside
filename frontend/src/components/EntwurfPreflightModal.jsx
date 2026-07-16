import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import Lightbox from './Lightbox.jsx';
import CloseLeadWarnung from './CloseLeadWarnung.jsx';
import AnredeAbfrage from './AnredeAbfrage.jsx';
import { anredeOffen } from '../lib/anrede.js';

// Zwischenschritt vor dem Versenden der Entwürfe:
// - Thumbnails der ausgewählten Creatives
// - 2 Pflicht-Checkboxen (Logo + Rechtschreibung/Stellenbezeichnung)
// - Close-Lead-Warnung mit Inline-Nachtragen falls fehlend
// - "Jetzt senden" ist erst aktiv wenn beide Boxen gesetzt sind
export default function EntwurfPreflightModal({ open, onClose, kunde, creatives, jobStelle, onConfirm, onKundeUpdated, isRunde = false, istResend = false }) {
  const [logoOk, setLogoOk] = useState(false);
  const [textOk, setTextOk] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    if (open) { setLogoOk(false); setTextOk(false); setLightboxIndex(null); }
  }, [open]);

  // Anrede ist Pflicht vor jedem kundengerichteten Versand.
  const canSend = logoOk && textOk && !anredeOffen(kunde);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={istResend
        ? '↩️ Erneut senden (gleiche Runde) — letzter Check'
        : (isRunde ? '📤 Überarbeitete Entwürfe senden — letzter Check' : 'Entwürfe senden — letzter Check')}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={!canSend}>
            Jetzt senden
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14, color: '#5a5955' }}>
        Bitte prüfe die {creatives?.length || 0} ausgewählten Creative(s) und bestätige die beiden Punkte.
      </p>

      {/* Anrede (Pflicht, solange nicht festgelegt) + Close-Lead-Warnung */}
      <AnredeAbfrage kunde={kunde} onSaved={onKundeUpdated} />
      <CloseLeadWarnung kunde={kunde} onSaved={onKundeUpdated} />

      {/* Thumbnails — Klick öffnet Groß-Ansicht mit Pfeilen zum Blättern */}
      {creatives?.length > 0 && (
        <>
          <p style={{ fontSize: 11, color: '#5a5955', margin: '0 0 6px' }}>
            💡 Klick auf ein Bild öffnet die Groß-Ansicht — mit ←/→ blätterst du durch alle Creatives.
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8, marginBottom: 16, maxHeight: 300, overflowY: 'auto',
            padding: 6, background: '#fafaf8', borderRadius: 8,
          }}>
            {creatives.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setLightboxIndex(i)}
                title="Klicken für Groß-Ansicht"
                style={{
                  position: 'relative', aspectRatio: c.format === 'story' ? '9 / 16' : '1 / 1',
                  background: '#000', borderRadius: 6, overflow: 'hidden',
                  border: 'none', padding: 0, cursor: 'zoom-in',
                }}
              >
                {c.typ === 'video'
                  ? <video src={c.bild_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                  : <img src={c.bild_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  fontSize: 10, padding: '2px 6px', borderRadius: 100,
                  pointerEvents: 'none',
                }}>{c.format === 'story' ? '9:16' : '1:1'}{c.typ === 'video' ? ' · Reel' : ''}</span>
                <span style={{
                  position: 'absolute', bottom: 4, right: 4,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  fontSize: 10, padding: '2px 6px', borderRadius: 100,
                  pointerEvents: 'none',
                }}>🔍</span>
              </button>
            ))}
          </div>
        </>
      )}

      {lightboxIndex !== null && creatives?.length > 0 && (
        <Lightbox
          items={creatives}
          index={Math.max(0, Math.min(lightboxIndex, creatives.length - 1))}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          filenameFor={c => `creative-${c.format}-${c.id.slice(0, 8)}.${c.typ === 'video' ? 'mp4' : 'png'}`}
        />
      )}

      {jobStelle && (
        <div style={{ fontSize: 13, color: '#5a5955', marginBottom: 12 }}>
          Stellenbezeichnung im Job: <strong style={{ color: '#0a0a0a' }}>{jobStelle}</strong>
        </div>
      )}

      {/* Pflicht-Checkboxen */}
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', background: logoOk ? '#dcfce7' : '#f4f3f0', borderRadius: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={logoOk} onChange={e => setLogoOk(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 14 }}>
            <strong>✓ Ich habe geprüft: Das Logo wird auf allen Creatives korrekt angezeigt</strong>
            <div style={{ fontSize: 12, color: '#5a5955', marginTop: 2 }}>
              Kein doppeltes Logo, keine falsche Positionierung, kein weißer Kasten — falls nötig „Logo anpassen" verwenden.
            </div>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', background: textOk ? '#dcfce7' : '#f4f3f0', borderRadius: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={textOk} onChange={e => setTextOk(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 14 }}>
            <strong>✓ Rechtschreibung & Stellenbezeichnung geprüft</strong>
            <div style={{ fontSize: 12, color: '#5a5955', marginTop: 2 }}>
              Alle Creatives + Ad Copies auf Tippfehler geprüft, Stellenbezeichnung korrekt geschrieben.
            </div>
          </span>
        </label>
      </div>

      {!canSend && (
        <p style={{ fontSize: 12, color: '#9a5a00', marginTop: 12, marginBottom: 0 }}>
          Beide Punkte müssen bestätigt werden, bevor der Versand freigegeben wird.
        </p>
      )}
    </Modal>
  );
}
