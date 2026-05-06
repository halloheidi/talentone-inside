import { createContext, useContext, useEffect, useState } from 'react';
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

  function reload() {
    return api(`/jobs/${jobId}`).then(r => setJob(r.job));
  }

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

  return (
    <JobContext.Provider value={{ job, kunde, reload }}>
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
