import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY_JOB = { stelle: '', region: '', gehalt: '' };

export default function KundeDetail() {
  const { kundeId } = useParams();
  const nav = useNavigate();
  const [kunde, setKunde] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_JOB);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api(`/kunden/${kundeId}`), api(`/jobs?kunde_id=${kundeId}`)])
      .then(([k, j]) => {
        setKunde(k.kunde);
        setJobs(j.jobs || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [kundeId]);

  async function onCreate(e) {
    e?.preventDefault();
    if (!form.stelle.trim()) return;
    setCreating(true);
    try {
      const res = await api('/jobs', { method: 'POST', body: { kunde_id: kundeId, ...form } });
      setShowCreate(false);
      setForm(EMPTY_JOB);
      nav(`/kunden/${kundeId}/jobs/${res.job.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="card empty">Lade…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!kunde) return <div className="card empty"><h2>Kunde nicht gefunden</h2></div>;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/kunden">Kunden</Link>
        <span aria-hidden>›</span>
        <span>{kunde.firmenname}</span>
      </div>

      <div className="kunde-head">
        <div className="kunde-head-logo">
          {kunde.logo_url
            ? <img src={kunde.logo_url} alt="" />
            : <span>{(kunde.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="kunde-head-body">
          <h1 className="page-title">{kunde.firmenname || '—'}</h1>
          <div className="kunde-head-meta">
            {kunde.branche && <span><strong>Branche:</strong> {kunde.branche}</span>}
            {kunde.ansprechpartner && <span><strong>Ansprechpartner:</strong> {kunde.ansprechpartner}</span>}
            {kunde.email && <span><strong>E-Mail:</strong> <a href={`mailto:${kunde.email}`}>{kunde.email}</a></span>}
            {kunde.telefon && <span><strong>Telefon:</strong> {kunde.telefon}</span>}
          </div>
          {kunde.notizen && <p className="kunde-head-notes">{kunde.notizen}</p>}
        </div>
      </div>

      <div className="section-head">
        <div>
          <h2 className="section-title">Projekte</h2>
          <p className="section-sub">Stellen / Kampagnen für diesen Kunden.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" /> Neues Projekt
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="card empty">
          <h2>Noch keine Projekte</h2>
          <p>Lege das erste Projekt für {kunde.firmenname} an.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {jobs.map(j => (
            <Link key={j.id} to={`/kunden/${kundeId}/jobs/${j.id}`} className="job-card">
              <div className="job-card-name">{j.stelle || 'Unbenanntes Projekt'}</div>
              <div className="job-card-meta">
                {j.region && <span>{j.region}</span>}
                {j.gehalt && <span>{j.gehalt}</span>}
              </div>
              <div className="job-card-foot">
                Angelegt {new Date(j.created_at).toLocaleDateString('de-DE')}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => !creating && setShowCreate(false)}
        title="Neues Projekt"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>
              Abbrechen
            </button>
            <button className="btn-primary" onClick={onCreate} disabled={creating || !form.stelle.trim()}>
              {creating ? 'Speichere…' : 'Anlegen'}
            </button>
          </>
        }
      >
        <form onSubmit={onCreate} className="form-grid">
          <label className="field field-full">
            <span>Stellenbezeichnung *</span>
            <input
              value={form.stelle}
              onChange={e => setForm({ ...form, stelle: e.target.value })}
              required
              placeholder="z.B. Servicetechniker:in im Außendienst"
            />
          </label>
          <label className="field">
            <span>Region</span>
            <input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} />
          </label>
          <label className="field">
            <span>Gehalt</span>
            <input value={form.gehalt} onChange={e => setForm({ ...form, gehalt: e.target.value })} />
          </label>
        </form>
      </Modal>
    </div>
  );
}
