import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const JobContext = createContext(null);
export function useJob() { return useContext(JobContext); }

const TABS = [
  { to: 'stelle', label: 'Stelle' },
  { to: 'creatives', label: 'Creatives' },
  { to: 'adcopies', label: 'Ad Copies' },
  { to: 'funnel', label: 'Funnel' },
  { to: 'export', label: 'Export' },
];

export default function JobView() {
  const { kundeId, jobId } = useParams();
  const [job, setJob] = useState(null);
  const [kunde, setKunde] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Tracking von Hintergrund-Tasks (übersteht Tab-Wechsel innerhalb des Jobs)
  const [pendingCreatives, setPendingCreatives] = useState(0);    // # erwartete neue Bilder
  const [pendingReels, setPendingReels] = useState([]);            // [parent_creative_id, …]
  const creativesBaselineRef = useRef(null);                       // # Creatives als wir den Job geladen haben

  // Lädt sowohl Job als auch Kunden neu — z.B. nach Logo-Upload, damit kunde.logo_url aktuell ist.
  function reload() {
    return Promise.all([
      api(`/jobs/${jobId}`).then(r => setJob(r.job)),
      api(`/kunden/${kundeId}`).then(r => setKunde(r.kunde)),
    ]);
  }

  // Werden vom JobCreatives aufgerufen wenn ein Background-Task startet.
  const startCreatives = useCallback(async (n) => {
    if (!n || n < 1) return;
    // Baseline: aktuelle Galerie-Größe (für sauberes Decrement)
    if (creativesBaselineRef.current === null) {
      try {
        const res = await api(`/creatives?job_id=${jobId}`);
        creativesBaselineRef.current = (res.creatives || []).length;
      } catch { creativesBaselineRef.current = 0; }
    }
    setPendingCreatives(p => p + n);
  }, [jobId]);

  const startReel = useCallback((parentCreativeId) => {
    if (!parentCreativeId) return;
    setPendingReels(prev => prev.includes(parentCreativeId) ? prev : [...prev, parentCreativeId]);
  }, []);

  // Polling — läuft NUR wenn etwas pending ist. Pollt /creatives, decrement entsprechend.
  useEffect(() => {
    if (pendingCreatives === 0 && pendingReels.length === 0) return;
    const startedAt = Date.now();
    const TIMEOUT_MS = 6 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const res = await api(`/creatives?job_id=${jobId}`);
        const list = res.creatives || [];

        // Bilder
        if (pendingCreatives > 0 && creativesBaselineRef.current !== null) {
          const delta = list.length - creativesBaselineRef.current;
          if (delta > 0) {
            setPendingCreatives(prev => Math.max(0, prev - delta));
            creativesBaselineRef.current = list.length;
          }
        }

        // Reels
        if (pendingReels.length > 0) {
          const fertige = list.filter(c => c.typ === 'video' && pendingReels.includes(c.parent_id));
          if (fertige.length > 0) {
            const fertigIds = new Set(fertige.map(c => c.parent_id));
            setPendingReels(prev => prev.filter(id => !fertigIds.has(id)));
          }
        }

        // Sicherheits-Timeout
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setPendingCreatives(0);
          setPendingReels([]);
        }
      } catch (err) { console.warn('[jobview-poll]', err.message); }
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingCreatives, pendingReels, jobId]);

  // Beim Job-Wechsel: state resetten
  useEffect(() => {
    setPendingCreatives(0);
    setPendingReels([]);
    creativesBaselineRef.current = null;
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([api(`/jobs/${jobId}`), api(`/kunden/${kundeId}`)])
      .then(([j, k]) => { setJob(j.job); setKunde(k.kunde); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [jobId, kundeId]);

  if (loading) return <div className="card empty">Lade…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!job) return <div className="card empty"><h2>Projekt nicht gefunden</h2></div>;

  const hasPending = pendingCreatives > 0 || pendingReels.length > 0;

  return (
    <JobContext.Provider value={{ job, kunde, reload, startCreatives, startReel, pendingCreatives, pendingReels }}>
      <div className="breadcrumb">
        <Link to="/kunden">Kunden</Link>
        <span aria-hidden>›</span>
        <Link to={`/kunden/${kundeId}`}>{kunde?.firmenname || 'Kunde'}</Link>
        <span aria-hidden>›</span>
        <span>{job.stelle || 'Projekt'}</span>
      </div>

      <div className="page-head">
        <div>
          <h1 className="page-title">{job.stelle || 'Unbenanntes Projekt'}</h1>
          <p className="page-sub">
            {[job.region, job.gehalt].filter(Boolean).join(' · ') || 'Noch keine Details hinterlegt.'}
          </p>
        </div>
      </div>

      {hasPending && (
        <div className="bg-task-banner">
          <span className="bg-task-spinner" aria-hidden />
          <span className="bg-task-msgs">
            {pendingCreatives > 0 && (
              <span>⏳ {pendingCreatives} Creative{pendingCreatives === 1 ? '' : 's'} wird/werden generiert…</span>
            )}
            {pendingReels.length > 0 && (
              <span>🎬 {pendingReels.length} Reel{pendingReels.length === 1 ? '' : 's'} wird erstellt…</span>
            )}
          </span>
          <span className="bg-task-hint">Du kannst weiter arbeiten — fertige Ergebnisse erscheinen automatisch im Creatives-Tab.</span>
        </div>
      )}

      <div className="tabs">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>

      <div className="tab-content">
        <Outlet />
      </div>
    </JobContext.Provider>
  );
}
