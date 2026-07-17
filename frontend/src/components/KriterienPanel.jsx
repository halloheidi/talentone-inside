// Panel "Worauf achten wir?" für den internen Job-Bereich.
//
// - Warn-Banner, wenn Vorqualifizierung aktiv ist, aber keine Kriterien definiert
//   sind ("⚠️ Keine Prüf-Kriterien definiert — was ist dem Kunden wichtig?")
// - Editor (Kriterium referenziert ein Vorqual-Feld)
// - KI-Vorschlag aus Briefing/KO-Kriterien/Stellendaten
// - "Kunden fragen" — Mail mit Portal-Link

import { useState } from 'react';
import { api } from '../lib/api.js';
import KriterienEditor from './KriterienEditor.jsx';

export default function KriterienPanel({ job, onJobUpdated }) {
  const [offen, setOffen] = useState(false);
  const [entwurf, setEntwurf] = useState(null); // null = nicht im Edit-Modus
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const kriterien = Array.isArray(job?.wichtige_kriterien) ? job.wichtige_kriterien : [];
  const felder = Array.isArray(job?.vorqualifizierung_felder) ? job.vorqualifizierung_felder : [];
  const fehlt = !!job?.vorqualifizierung && kriterien.length === 0;

  function startEdit() { setEntwurf(kriterien.map(k => ({ ...k }))); setOffen(true); setErr(''); setMsg(''); }

  async function speichern() {
    setBusy(true); setErr('');
    try {
      const res = await api(`/jobs/${job.id}`, { method: 'PATCH', body: { wichtige_kriterien: entwurf } });
      onJobUpdated?.(res.job);
      setEntwurf(null);
      setMsg('Kriterien gespeichert.');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function kiVorschlag() {
    setBusy(true); setErr('');
    try {
      const res = await api(`/jobs/${job.id}/kriterien-vorschlag`, { method: 'POST' });
      setEntwurf(res.kriterien || []);
      setOffen(true);
      if (res.neue_felder?.length) {
        setMsg(`Vorschlag übernommen — neue Felder beim Speichern: ${res.neue_felder.join(', ')}`);
      } else {
        setMsg('Vorschlag übernommen — bitte prüfen und speichern.');
      }
    } catch (e) { setErr(`KI-Vorschlag: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function kundenFragen() {
    if (!confirm('Mail an den Kunden schicken: „Worauf sollen wir bei der Vorqualifizierung achten?" (mit Link ins Portal)')) return;
    setBusy(true); setErr('');
    try {
      await api(`/jobs/${job.id}/kriterien-anfrage`, { method: 'POST', body: {} });
      setMsg('Mail an den Kunden verschickt.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {fehlt && !offen && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px',
        }}>
          <span style={{ fontSize: 13, color: '#78350f', flex: 1, minWidth: 240 }}>
            ⚠️ <strong>Keine Prüf-Kriterien definiert</strong> — was ist dem Kunden wichtig?
            Die Telefonisten wissen sonst nicht, worauf sie achten sollen.
          </span>
          <button type="button" className="btn-primary btn-sm" onClick={startEdit}>Jetzt festlegen</button>
          <button type="button" className="btn-ghost btn-sm" onClick={kiVorschlag} disabled={busy}>
            {busy ? '…' : '✨ KI-Vorschlag'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={kundenFragen} disabled={busy}>Kunden fragen</button>
        </div>
      )}

      {!fehlt && !offen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>⭐ Worauf wir achten:</span>
          {kriterien.length === 0
            ? <span style={{ color: 'var(--ink-4)' }}>—</span>
            : kriterien.map((k, i) => (
                <span key={i} style={{
                  background: k.pflicht ? '#fee2e2' : '#f1f1ee', color: k.pflicht ? '#7f1d1d' : '#5a5955',
                  borderRadius: 100, padding: '2px 9px', fontSize: 12,
                }} title={k.anforderung || ''}>
                  {k.pflicht ? '❗ ' : ''}{k.kriterium}{k.anforderung ? ` — ${k.anforderung}` : ''}
                </span>
              ))}
          <button type="button" className="btn-ghost btn-sm" onClick={startEdit}>Bearbeiten</button>
        </div>
      )}

      {offen && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: '#fcfcfb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>⭐ Worauf achten wir? — {job?.stelle}</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-ghost btn-sm" onClick={kiVorschlag} disabled={busy}>✨ KI-Vorschlag</button>
              <button type="button" className="btn-ghost btn-sm" onClick={kundenFragen} disabled={busy}>Kunden fragen</button>
            </div>
          </div>

          <KriterienEditor
            kriterien={entwurf ?? kriterien}
            felder={felder}
            onChange={setEntwurf}
            disabled={busy}
          />

          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}
          {msg && <div className="form-msg" style={{ marginTop: 10 }}>{msg}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn-primary btn-sm" onClick={speichern} disabled={busy || entwurf == null}>
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setEntwurf(null); setOffen(false); }} disabled={busy}>
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
