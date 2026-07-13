import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import CloseLeadWarnung from './CloseLeadWarnung.jsx';

// Zwischenschritt vor dem Versenden der Entwürfe:
// - Thumbnails der ausgewählten Creatives
// - 2 Pflicht-Checkboxen (Logo + Rechtschreibung/Stellenbezeichnung)
// - Close-Lead-Warnung mit Inline-Nachtragen falls fehlend
// - "Jetzt senden" ist erst aktiv wenn beide Boxen gesetzt sind
export default function EntwurfPreflightModal({ open, onClose, kunde, creatives, jobStelle, onConfirm, onKundeUpdated, isRunde = false }) {
  const [logoOk, setLogoOk] = useState(false);
  const [textOk, setTextOk] = useState(false);

  useEffect(() => {
    if (open) { setLogoOk(false); setTextOk(false); }
  }, [open]);

  const canSend = logoOk && textOk;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isRunde ? 'Überarbeitete Entwürfe senden — letzter Check' : 'Entwürfe senden — letzter Check'}
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

      {/* Close-Lead-Warnung */}
      <CloseLeadWarnung kunde={kunde} onSaved={onKundeUpdated} />

      {/* Thumbnails */}
      {creatives?.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 8, marginBottom: 16, maxHeight: 300, overflowY: 'auto',
          padding: 6, background: '#fafaf8', borderRadius: 8,
        }}>
          {creatives.map(c => (
            <div key={c.id} style={{ position: 'relative', aspectRatio: c.format === 'story' ? '9 / 16' : '1 / 1', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
              {c.typ === 'video'
                ? <video src={c.bild_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={c.bild_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              <span style={{
                position: 'absolute', top: 4, right: 4,
                background: 'rgba(0,0,0,0.65)', color: '#fff',
                fontSize: 10, padding: '2px 6px', borderRadius: 100,
              }}>{c.format === 'story' ? '9:16' : '1:1'}{c.typ === 'video' ? ' · Reel' : ''}</span>
            </div>
          ))}
        </div>
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
