import { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Dialog „Foto animieren": startet aus einem freigegebenen Referenzfoto eine
// animierte Variante (Higgsfield Seedance → kurzes Video mit nur Ambient-Bewegung)
// + deterministisches Text-Overlay (Layout-Vorlage A/B, CI-Regeln). Läuft im
// Hintergrund; das Video erscheint danach in der Galerie.

const FORMATS = [['story', '9:16'], ['quadrat', '1:1'], ['feed', '4:5']];
const VORLAGEN = [['A', 'Frage-Headline + Titel'], ['B', 'Textblock + Titel']];

export default function AnimierenModal({ photo, job, onClose, onStarted }) {
  const [format, setFormat] = useState('story');
  const [vorlage, setVorlage] = useState('A');
  const [spruch, setSpruch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true); setError('');
    try {
      await api('/creatives/animieren', {
        method: 'POST',
        body: { job_id: job.id, foto_id: photo.id, format, vorlage, spruch: spruch.trim() || undefined },
      });
      onStarted?.();
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
  }

  const pickStyle = (active) => ({
    padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
    border: active ? '2px solid #0078ff' : '1px solid #d5d3ce',
    background: active ? '#eaf3ff' : '#fff', fontWeight: active ? 700 : 500,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Foto animieren"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={start} disabled={busy}>
            {busy ? 'Starte…' : '🎬 Animieren'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16, maxWidth: 440 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src={photo.bild_url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: 12.5, color: '#5a5955' }}>
            Erzeugt einen kurzen Clip mit <strong>nur dezenter Bewegung</strong> (Himmel, Licht, Wasser, Laub) —
            Personen, Fahrzeuge, Logos und Schrift bleiben unverändert. Dauert 1–3 Min, kostet Higgsfield-Credits.
          </p>
        </div>

        <label>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 6 }}>Format</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {FORMATS.map(([k, lbl]) => (
              <button key={k} type="button" style={pickStyle(format === k)} onClick={() => setFormat(k)}>{lbl}</button>
            ))}
          </div>
          {format === 'feed' && <p style={{ fontSize: 11.5, color: '#8a8780', margin: '6px 0 0' }}>4:5 wird aus 3:4 generiert und minimal zugeschnitten (Modell kann 4:5 nicht direkt).</p>}
          {format === 'story' && <p style={{ fontSize: 11.5, color: '#8a8780', margin: '6px 0 0' }}>9:16 wird direkt im Hochformat generiert (das Modell erweitert oben/unten, kein Zuschnitt).</p>}
        </label>

        <label>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 6 }}>Overlay-Vorlage</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {VORLAGEN.map(([k, lbl]) => (
              <button key={k} type="button" style={pickStyle(vorlage === k)} onClick={() => setVorlage(k)}>{lbl}</button>
            ))}
          </div>
        </label>

        <label>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 6 }}>
            Headline (optional) <span style={{ textTransform: 'none', fontWeight: 400 }}>— blendet im Clip weich ein</span>
          </span>
          <textarea className="cell-input" rows={2} value={spruch} onChange={e => setSpruch(e.target.value)}
            placeholder={'z. B. "Kein Feierabend in Sicht?"'} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
        </label>

        {error && <p style={{ color: '#c1272d', fontSize: 13, margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
