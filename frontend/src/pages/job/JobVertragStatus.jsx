import { useCallback, useEffect, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';

// „Vertrag & Status" — alle Projekt-/Vertragsdaten der Stelle an einem Ort.
// Schreibt direkt auf das verknüpfte talentone_projekte. „Projekt" taucht als
// Begriff hier nicht mehr auf — die Stelle ist die Einheit.

const STATUS = [
  'vorbereitung', 'kickoff_vereinbart', 'onboarding', 'golive_vereinbart',
  'warte_auf_go', 'go', 'live', 'feedbackschleife', 'pausiert', 'hold', 'abgeschlossen',
];
const STATUS_LABELS = {
  vorbereitung: 'Vorbereitung', kickoff_vereinbart: 'Kick-Off vereinbart', onboarding: 'Onboarding',
  golive_vereinbart: 'Go-Live vereinbart', warte_auf_go: 'Warte auf Go!', go: 'Go', live: 'Live',
  feedbackschleife: 'Feedbackschleife', pausiert: 'Pausiert', hold: 'Hold', abgeschlossen: 'Abgeschlossen',
};
const HINWEIS_TEXT = {
  kein_vertragsmodell: 'ℹ️ Kein Vertragsmodell gewählt.',
  kein_start_datum: 'ℹ️ Kein Start-Datum gesetzt — Laufzeit kann nicht gerechnet werden.',
  start_datum_fehlt: 'ℹ️ Kein Start-Datum — Laufzeit aus jüngster Laufphase geschätzt.',
  keine_meta_verbindung: '⚠️ Keine Meta-Verbindung.',
  meta_daten_fehlen: '⚠️ Meta-Daten fehlen noch.',
  ueberlaufzeit: '⏱ Läuft über die gebuchte Laufzeit hinaus (läuft weiter).',
  abo_mit_garantie: '⚠️ Abo mit Garantie ist ungewöhnlich — bitte prüfen (blockiert nicht).',
};

export default function JobVertragStatus() {
  const { job, projekt, geteiltMit, setProjekt, reload } = useJob();
  const [status, setStatus] = useState(null);     // GET /projekte/:id/laufzeit → .status (inkl. pausen)
  const [neuePause, setNeuePause] = useState({ von: '', grund: '', quelle: 'nw' });
  const [busy, setBusy] = useState(false);
  const [trennBusy, setTrennBusy] = useState(false);
  const pid = projekt?.id;

  const ladeStatus = useCallback(() => {
    if (!pid) return;
    api(`/projekte/${pid}/laufzeit`).then(r => setStatus(r.status || null)).catch(() => setStatus(null));
  }, [pid]);
  useEffect(() => { ladeStatus(); }, [ladeStatus, projekt?.vertragsmodell, projekt?.laufzeit_wert, projekt?.start_datum]);

  if (!projekt) return <div className="card empty">Diese Stelle hat noch kein Projekt — bitte Seite neu laden.</div>;

  async function patch(body) {
    try {
      const res = await api(`/projekte/${pid}`, { method: 'PATCH', body });
      if (res.projekt) setProjekt(res.projekt);
      await reload?.();
      ladeStatus();
    } catch (e) { alert(e.message); }
  }
  const field = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    patch({ [k]: v === '' ? null : v });
  };

  // Vertragsmodell inkl. Open End (abo + laufzeit_wert null)
  const einheit = projekt.laufzeit_einheit || (projekt.vertragsmodell === 'abo' ? 'monate' : 'tage');
  const modellSel = projekt.vertragsmodell === 'abo'
    ? (projekt.laufzeit_wert == null ? 'abo_open' : 'abo')
    : (projekt.vertragsmodell || '');
  const openEnd = modellSel === 'abo_open';
  function setModell(sel) {
    if (sel === 'abo_open') patch({ vertragsmodell: 'abo', laufzeit_wert: null, laufzeit_einheit: 'monate' });
    else if (sel === 'abo') patch({ vertragsmodell: 'abo', laufzeit_einheit: projekt.laufzeit_einheit || 'monate' });
    else patch({ vertragsmodell: sel || null });
  }

  const pausen = status?.pausen || [];
  const hinweise = status?.hinweise || [];

  async function addPause() {
    if (!neuePause.von) return;
    setBusy(true);
    try { await api(`/projekte/${pid}/pausen`, { method: 'POST', body: neuePause }); setNeuePause({ von: '', grund: '', quelle: 'nw' }); ladeStatus(); await reload?.(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function endePause(index) {
    setBusy(true);
    try { await api(`/projekte/${pid}/pausen/beenden`, { method: 'PATCH', body: { index } }); ladeStatus(); await reload?.(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function bestaetigePause(index) {
    setBusy(true);
    try { await api(`/projekte/${pid}/pausen/bestaetigen`, { method: 'PATCH', body: { index } }); ladeStatus(); await reload?.(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function vertragTrennen() {
    if (!confirm('Eigenen Vertrag für diese Stelle anlegen? Die anderen Stellen behalten den bisherigen Vertrag.')) return;
    setTrennBusy(true);
    try { await api(`/jobs/${job.id}/vertrag-trennen`, { method: 'POST' }); await reload?.(); ladeStatus(); }
    catch (e) { alert(e.message); } finally { setTrennBusy(false); }
  }

  const lbl = { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', letterSpacing: 0.04, marginBottom: 4 };

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
      {geteiltMit?.length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
          <span>📄 Dieser Vertrag gilt auch für: <strong>{geteiltMit.map(g => g.stelle).join(', ')}</strong></span>
          <button type="button" onClick={vertragTrennen} disabled={trennBusy}
            style={{ marginLeft: 'auto', background: '#fff', border: '1px solid #d97706', color: '#92400e', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {trennBusy ? 'Trenne…' : 'Vertrag trennen'}
          </button>
        </div>
      )}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Status</h3>
        <label><span style={lbl}>Feinstatus</span>
          <select className="cell-input" value={projekt.status || ''} onChange={field('status')}>
            {STATUS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <p className="pane-hint" style={{ marginTop: 6 }}>Wechsel nach/von „Pausiert" legt bzw. schließt automatisch eine Pause (wie im Kanban).</p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Vertrag</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label><span style={lbl}>Vertragsmodell</span>
            <select className="cell-input" value={modellSel} onChange={e => setModell(e.target.value)}>
              <option value="">—</option>
              <option value="kampagne">Kampagne (aktive Lauftage)</option>
              <option value="abo">Abo (feste Laufzeit)</option>
              <option value="abo_open">Abo · Open End (monatlich bis Kündigung)</option>
            </select>
          </label>
          <label><span style={lbl}>Laufzeit</span>
            <div style={{ display: 'flex', gap: 6, opacity: openEnd ? 0.45 : 1 }}>
              <input type="number" min="0" step="1" className="cell-input" style={{ flex: 1 }} disabled={openEnd}
                placeholder={openEnd ? 'monatlich' : ''}
                value={openEnd ? '' : (projekt.laufzeit_wert ?? '')}
                onChange={e => patch({ laufzeit_wert: e.target.value.trim() === '' ? null : (parseInt(e.target.value, 10) || 0) })} />
              <select className="cell-input" style={{ flex: 1 }} value={einheit} disabled={openEnd} onChange={field('laufzeit_einheit')}>
                <option value="tage">Tage</option>
                <option value="monate">Monate</option>
              </select>
            </div>
          </label>
          <label><span style={lbl}>Start-Datum</span>
            <input type="date" className="cell-input" value={projekt.start_datum || ''} onChange={field('start_datum')} />
          </label>
          <label><span style={lbl}>Werbebudget</span>
            <select className="cell-input" value={projekt.werbebudget_modus || 'position'} onChange={field('werbebudget_modus')}>
              <option value="position">Über TalentOne abgerechnet</option>
              <option value="empfehlung">Kunde zahlt direkt (Empfehlung)</option>
            </select>
          </label>
          {projekt.werbebudget_modus === 'empfehlung' && (
            <label><span style={lbl}>Tagesbudget-Empfehlung (€)</span>
              <input type="number" min="0" step="1" className="cell-input" value={projekt.tagesbudget_empfehlung ?? ''} onChange={field('tagesbudget_empfehlung')} />
            </label>
          )}
          <label><span style={lbl}>Monatsbudget (€)</span>
            <input type="number" min="0" step="1" className="cell-input" value={projekt.monatsbudget_euro ?? ''} onChange={field('monatsbudget_euro')} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!projekt.garantie} onChange={field('garantie')} /> 🛡️ Garantie
          </label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={!!projekt.zahlung_aufgeteilt} onChange={field('zahlung_aufgeteilt')} /> Zahlung aufgeteilt
          </label>
        </div>
        {projekt.garantie && (
          <label style={{ display: 'block', marginTop: 10 }}><span style={lbl}>Garantie-Details</span>
            <input className="cell-input" defaultValue={projekt.garantie_details || ''}
              placeholder="Was ist garantiert? z. B. Erfolgsgarantie 30 Tage …"
              onBlur={e => (e.target.value || '') !== (projekt.garantie_details || '') && patch({ garantie_details: e.target.value || null })} />
          </label>
        )}

        {status && projekt.vertragsmodell && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--gray-50)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <span><strong>Verbraucht:</strong> {status.verbraucht == null ? '—' : `${status.verbraucht} ${einheit === 'monate' ? 'Mon.' : 'akt. Tage'}`}</span>
              <span><strong>Soll:</strong> {status.soll == null ? 'offen (Open End)' : `${status.soll} ${einheit === 'monate' ? 'Mon.' : 'Tage'}`}</span>
              {status.soll != null && <span><strong>Rest:</strong> {status.rest == null ? '—' : `${status.rest} ${einheit === 'monate' ? 'Mon.' : 'Tage'}`}{status.ueberlaufzeit_tage ? ` (+${status.ueberlaufzeit_tage} über)` : ''}</span>}
              {status.open_end && status.online_tage != null && <span><strong>Online:</strong> {status.online_tage} Tage</span>}
              {status.ende_voraussichtlich && <span><strong>Vsl. Ende:</strong> {new Date(status.ende_voraussichtlich).toLocaleDateString('de-DE')}</span>}
              {status.pausen_tage > 0 && <span><strong>Pausen:</strong> {status.pausen_tage} Tage</span>}
            </div>
            {hinweise.map(h => (
              <div key={h} style={{ marginTop: 6, color: h === 'ueberlaufzeit' || h === 'abo_mit_garantie' ? '#b26b00' : (h.startsWith('keine') ? '#b91c1c' : 'var(--ink-3)') }}>{HINWEIS_TEXT[h] || h}</div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Pausen</h3>
        {pausen.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Keine Pausen erfasst.</div>}
        {pausen.map((p, i) => {
          const offen = !p.bis;
          const unbestaetigt = !p.bestaetigt_am;
          return (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <span>{new Date(p.von).toLocaleDateString('de-DE')} – {p.bis ? new Date(p.bis).toLocaleDateString('de-DE') : 'offen'}</span>
              {p.grund && <span style={{ color: 'var(--ink-3)' }}>· {p.grund}</span>}
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>({p.quelle === 'kunde' ? 'Kundenantrag' : 'N&W'})</span>
              {unbestaetigt && <span style={{ fontSize: 11, color: '#b26b00', fontWeight: 600 }}>⏳ unbestätigt</span>}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                {unbestaetigt && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => bestaetigePause(i)}>Bestätigen</button>}
                {offen && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => endePause(i)}>Pause beenden</button>}
              </span>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <label><span style={lbl}>Ab</span><input type="date" className="cell-input" value={neuePause.von} onChange={e => setNeuePause(s => ({ ...s, von: e.target.value }))} /></label>
          <label style={{ flex: 1, minWidth: 140 }}><span style={lbl}>Grund</span><input className="cell-input" value={neuePause.grund} onChange={e => setNeuePause(s => ({ ...s, grund: e.target.value }))} /></label>
          <button className="btn-primary btn-sm" disabled={busy || !neuePause.von} onClick={addPause}>+ Pause</button>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Termine</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label><span style={lbl}>Kick-Off</span><input type="date" className="cell-input" value={projekt.kickoff_termin || ''} onChange={field('kickoff_termin')} /></label>
          <label><span style={lbl}>Geplanter Livegang</span><input type="date" className="cell-input" value={projekt.geplanter_livegang || ''} onChange={field('geplanter_livegang')} /></label>
          <label><span style={lbl}>Live-Termin</span><input type="date" className="cell-input" value={projekt.live_termin || ''} onChange={field('live_termin')} /></label>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Verantwortung & Zahlung</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label><span style={lbl}>Verantwortlich</span><input className="cell-input" defaultValue={projekt.verantwortlich || ''} onBlur={e => (e.target.value || '') !== (projekt.verantwortlich || '') && patch({ verantwortlich: e.target.value || null })} /></label>
          <label><span style={lbl}>Closer</span><input className="cell-input" defaultValue={projekt.closer || ''} onBlur={e => (e.target.value || '') !== (projekt.closer || '') && patch({ closer: e.target.value || null })} /></label>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={!!projekt.re_bezahlt} onChange={field('re_bezahlt')} /> Rechnung 1 bezahlt</label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={!!projekt.re2_bezahlt} onChange={field('re2_bezahlt')} /> Rechnung 2 bezahlt</label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={!!projekt.ziel_erreicht} onChange={field('ziel_erreicht')} /> Ziel erreicht</label>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Interne Notizen</h3>
        <p className="pane-hint" style={{ marginTop: 0 }}>Nur intern — erscheint nie im Kundenportal.</p>
        <textarea className="cell-input" rows={4} defaultValue={projekt.notizen || ''}
          onBlur={e => (e.target.value || '') !== (projekt.notizen || '') && patch({ notizen: e.target.value || null })}
          style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      </section>
    </div>
  );
}
