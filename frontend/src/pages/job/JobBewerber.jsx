import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { BewerberListe } from '../../components/BewerberListe.jsx';
import KriterienKachel from '../../components/KriterienKachel.jsx';

// Fängt Renderfehler der Bewerberliste ab, damit nie eine stille leere/read-only
// Seite stehen bleibt — der Grund wird gezeigt, „Erneut laden" lädt neu.
class ListeErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[JobBewerber] Renderfehler:', error, info?.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="alert alert-error" style={{ margin: 0 }}>
          <strong>Die Bewerberliste konnte nicht angezeigt werden.</strong>
          <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</div>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => window.location.reload()}>↻ Erneut laden</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// B4: Interne Bewerberliste der Stelle = geteilte BewerberListe (modus='intern').
// Ersetzt die alte interne Bewerberansicht. Oben die Kriterien-Kachel (wie im Portal).
export default function JobBewerber() {
  const { job, kunde } = useJob();
  const { me, user } = useAuth();
  const [data, setData] = useState(null);          // { bewerbungen, notizen, feedback, werte, kommentare, funnels }
  const [struktur, setStruktur] = useState({ ko: [], muss: [], wunsch: [], hinweis_freitext: '' });
  const [spalten, setSpalten] = useState([]);
  const [kritLog, setKritLog] = useState(null);    // { kunde_am }
  const [akteBewId, setAkteBewId] = useState(null);
  const [ladeFehler, setLadeFehler] = useState(null);
  const jobId = job.id;
  const autorName = `N&W · ${me?.name || me?.email || user?.email || 'Mitarbeiter'}`;

  const load = useCallback(async () => {
    setLadeFehler(null);
    try {
      const [d, k, sp] = await Promise.all([
        api(`/bewerbungen/job/${jobId}`),
        api(`/jobs/${jobId}/kriterien`).catch(() => ({})),
        api(`/bewerbungen/job/${jobId}/spalten`).catch(() => ({ spalten: [] })),
      ]);
      setData(d);
      if (k.kriterien) setStruktur(k.kriterien);
      if (k.log) setKritLog(k.log);
      setSpalten(sp.spalten || []);
    } catch (e) {
      // Nie still hängen bleiben: Grund zeigen + „Erneut laden" anbieten.
      setLadeFehler(e?.body?.error || e?.message || 'Unbekannter Fehler beim Laden der Bewerber.');
    }
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  // Bewerbungen in die von BewerberListe erwartete Form bringen.
  const bewerbungen = useMemo(() => {
    if (!data) return [];
    const { bewerbungen: bs = [], notizen = {}, feedback = {}, werte = {}, kommentare = {}, gesellenwerk = {} } = data;
    return bs.map(b => ({
      ...b,
      notiz: notizen[b.id] || null,
      feedback: feedback[b.id] ? { status: feedback[b.id].status || null, vorstellungsgespraech_am: feedback[b.id].vorstellungsgespraech_am || null, vorqual_werte_kunde: feedback[b.id].vorqual_werte_kunde || {} } : null,
      kommentare: kommentare[b.id] || [],
      vorqualifizierung_werte: notizen[b.id]?.vorqualifizierung_werte || {},
      spalten_werte: werte[b.id] || {},
      gesellenwerk: gesellenwerk[b.id] || null,
    }));
  }, [data]);

  const jobForListe = useMemo(() => ({
    ...job,
    kriterien_struktur: struktur,
    vorqualifizierung_felder: Array.isArray(job.vorqualifizierung_felder) ? job.vorqualifizierung_felder : [],
    bewerber_spalten: spalten,
  }), [job, struktur, spalten]);

  const koIds = (struktur.ko || []).map(k => k.id);

  // Intern-Handler
  const onPatch = useCallback(async (bewId, patch) => {
    await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: patch });
    // KO-Kriterium auf ✗ → Ampel rot + Vorschlag Kundenfeedback „ungeeignet" (bestätigen).
    if (patch.kriterien_check && koIds.some(id => patch.kriterien_check[id] === false)) {
      if (window.confirm('KO-Kriterium nicht erfüllt. Ampel auf Rot setzen und Feedback „Ungeeignet" vorschlagen?')) {
        await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: { ampel: 'rot' } });
        await api(`/bewerbungen/${bewId}/feedback`, { method: 'PATCH', body: { status: 'ungeeignet' } });
      }
    }
  }, [koIds]);
  const onKommentar = useCallback((bewId, text) => api(`/bewerbungen/${bewId}/kommentar`, { method: 'POST', body: { text, autor: autorName } }), [autorName]);
  // Gesellenwerk-Vormerkung (nur intern): Grund/Notiz + Telefon-Einwilligung.
  const onGesellenwerk = useCallback((bewId, body) => api(`/bewerbungen/${bewId}/gesellenwerk`, { method: 'POST', body }), []);
  const onGesellenwerkOptin = useCallback((bewId) => api(`/bewerbungen/${bewId}/gesellenwerk/optin-mail`, { method: 'POST' }), []);
  const onSpalte = useCallback((bewId, spalteId, wert) => api(`/bewerbungen/${bewId}/spalten/${spalteId}`, { method: 'PUT', body: { wert } }), []);
  // Intern geschriebene Vorqual-Werte (nicht die Kundenwerte): in notiz.vorqualifizierung_werte mergen.
  const onVorqual = useCallback(async (bewId, feld, wert) => {
    const b = bewerbungen.find(x => x.id === bewId);
    const werte = { ...(b?.notiz?.vorqualifizierung_werte || {}) };
    if (wert === '' || wert == null) delete werte[feld]; else werte[feld] = wert;
    await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: { vorqualifizierung_werte: werte } });
  }, [bewerbungen]);

  async function saveKriterien(wert) {
    await api(`/jobs/${jobId}/kriterien`, { method: 'PUT', body: { kriterien: wert } });
    await load();
  }

  if (ladeFehler) return (
    <div className="alert alert-error" style={{ margin: 0 }}>
      <strong>Bewerber konnten nicht geladen werden.</strong>
      <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{ladeFehler}</div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn-ghost btn-sm" onClick={load}>↻ Erneut laden</button>
      </div>
    </div>
  );
  if (!data) return <div className="card empty">Lade Bewerber…</div>;

  const kundeKurz = kritLog?.kunde_am ? new Date(kritLog.kunde_am) : null;
  const kundeHint = kundeKurz && (Date.now() - kundeKurz.getTime() < 7 * 86400000)
    ? `Zuletzt vom Kunden geändert am ${kundeKurz.toLocaleDateString('de-DE')}` : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <KriterienKachel value={struktur} onSave={saveKriterien} accent="#1b3f80"
        titel="Kriterien dieser Stelle" hinweis={kundeHint || 'KO/Muss/Wunsch — wir prüfen sie bei jedem Bewerber.'} />
      <ListeErrorBoundary>
        <BewerberListe
          job={jobForListe} bewerbungen={bewerbungen} kunde={kunde} primary="#1b3f80" modus="intern"
          akteBewId={akteBewId} onAkte={setAkteBewId}
          onPatch={onPatch} onKommentar={onKommentar} onSpalte={onSpalte} onVorqual={onVorqual}
          onGesellenwerk={onGesellenwerk} onGesellenwerkOptin={onGesellenwerkOptin} gwMailReady={!!data.gw_mail_ready}
          onReload={load}
        />
      </ListeErrorBoundary>
    </div>
  );
}
