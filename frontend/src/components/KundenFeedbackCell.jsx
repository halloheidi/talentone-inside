import { useState } from 'react';
import { api } from '../lib/api.js';

// Kunden-Feedback aus dem Portal (talentone_bewerber_kundenfeedback), in der
// internen Bewerberliste. Badge (farbcodiert) + VG-Termin + Notiz-Popover +
// „vom Kunden geändert am" + Hire-Verzahnung („Als Einstellung erfassen").

export const KUNDEN_STATUS = {
  neu:                   { label: 'Offen',           cls: 'kf-neu' },
  interessant:           { label: 'Interessant',     cls: 'kf-interessant' },
  vorstellungsgespraech: { label: 'Gespräch geplant', cls: 'kf-gespraech' },
  eingestellt:           { label: 'Eingestellt',     cls: 'kf-eingestellt' },
  ungeeignet:            { label: 'Ungeeignet',      cls: 'kf-ungeeignet' },
  absage:                { label: 'Absage',          cls: 'kf-absage' },
  abgesagt:              { label: 'Absage',          cls: 'kf-absage' },
};
export function kundenStatusLabel(s) { return KUNDEN_STATUS[s]?.label || s || ''; }
// Reihenfolge für Filter-Dropdowns.
export const KUNDEN_STATUS_FILTER = ['eingestellt', 'vorstellungsgespraech', 'interessant', 'neu', 'ungeeignet', 'absage'];

function fmt(d, withTime) {
  if (!d) return '';
  const x = new Date(d);
  return withTime ? x.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : x.toLocaleDateString('de-DE');
}

export default function KundenFeedbackCell({ fb, bewerbungId, showVorqual = false, onHired }) {
  const [showNote, setShowNote] = useState(false);
  const [hireMsg, setHireMsg] = useState('');
  const [hireBusy, setHireBusy] = useState(false);

  const st = fb?.status;
  const cfg = st ? KUNDEN_STATUS[st] : null;
  const vorqual = fb?.vorqual_werte_kunde && typeof fb.vorqual_werte_kunde === 'object' && Object.keys(fb.vorqual_werte_kunde).length
    ? fb.vorqual_werte_kunde : null;

  async function erfassen(e) {
    e.stopPropagation();
    setHireBusy(true); setHireMsg('');
    try {
      const r = await api(`/bewerbungen/${bewerbungId}/als-einstellung`, { method: 'POST' });
      setHireMsg(r.bereits_erfasst ? '✓ bereits erfasst' : `✓ in ${r.phase === 'phase2' ? 'Phase 2' : 'Phase 1'} erfasst`);
      if (onHired) onHired(r);
    } catch (err) { setHireMsg('✗ ' + (err.body?.error || err.message)); }
    finally { setHireBusy(false); }
  }

  const leer = !st && !fb?.notizen && !fb?.vorstellungsgespraech_am && !(showVorqual && vorqual);
  if (leer) return <span className="muted">—</span>;

  return (
    <div className="kundenfeedback-cell">
      {cfg && <span className={`kundenfeedback-badge ${cfg.cls}`}>{cfg.label}</span>}
      {fb?.vorstellungsgespraech_am && <span className="kundenfeedback-meta">📅 {fmt(fb.vorstellungsgespraech_am, true)}</span>}
      {fb?.notizen && (
        <div style={{ position: 'relative' }}>
          <button type="button" className="kf-note-btn" title={fb.notizen} onClick={e => { e.stopPropagation(); setShowNote(v => !v); }}>📝 Notiz</button>
          {showNote && <div className="kf-note-pop" onClick={e => e.stopPropagation()}>{fb.notizen}</div>}
        </div>
      )}
      {showVorqual && vorqual && (
        <div className="kf-vorqual" title="Vom Kunden gepflegte Vorqual-Werte">
          {Object.entries(vorqual).map(([k, v]) => <div key={k}><span className="kf-vq-k">{k}:</span> {String(v)}</div>)}
        </div>
      )}
      {fb?.updated_at && st && <span className="kundenfeedback-meta">geändert {fmt(fb.updated_at)}</span>}
      {st === 'eingestellt' && (
        <button type="button" className="btn-primary btn-sm kf-hire" disabled={hireBusy} onClick={erfassen}
          title="Einstellung in die Projekt-Phase schreiben (Garantie-relevant)">
          {hireBusy ? '…' : '✓ Als Einstellung erfassen'}
        </button>
      )}
      {hireMsg && <span className="kundenfeedback-meta">{hireMsg}</span>}
    </div>
  );
}
