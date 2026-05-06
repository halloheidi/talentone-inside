import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY_JOB = { stelle: '', region: '', gehalt: '' };

const DEFAULT_ANFRAGE = `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.`;

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

  const [showAnfrage, setShowAnfrage] = useState(false);
  const [anfrageText, setAnfrageText] = useState(DEFAULT_ANFRAGE);
  const [anfrageBusy, setAnfrageBusy] = useState(false);
  const [anfrageMsg, setAnfrageMsg] = useState('');

  const [referenzbilder, setReferenzbilder] = useState([]);

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

  useEffect(() => {
    api(`/kunden/${kundeId}/referenzbilder`)
      .then(res => setReferenzbilder(res.referenzbilder || []))
      .catch(() => {});
  }, [kundeId]);

  async function sendAnfrage() {
    setAnfrageBusy(true);
    setAnfrageMsg('');
    try {
      await api(`/kunden/${kundeId}/anfrage`, { method: 'POST', body: { customText: anfrageText } });
      setAnfrageMsg(`Mail an ${kunde.email} verschickt.`);
      setTimeout(() => { setShowAnfrage(false); setAnfrageMsg(''); }, 1500);
    } catch (err) {
      setAnfrageMsg(err.message);
    } finally {
      setAnfrageBusy(false);
    }
  }

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
          <div className="kunde-head-actions">
            <button
              className="btn-ghost btn-sm"
              onClick={() => setShowAnfrage(true)}
              title={kunde.email ? '' : 'Kunden-E-Mail fehlt'}
              disabled={!kunde.email}
            >
              Fotos & Logo beim Kunden anfragen
            </button>
          </div>
        </div>
      </div>

      {referenzbilder.length > 0 && (
        <div className="ref-strip">
          <div className="ref-strip-title">
            Verfügbar: {referenzbilder.length} Datei{referenzbilder.length === 1 ? '' : 'en'} ({referenzbilder.filter(r => r.uploaded_via === 'kunde').length} vom Kunden)
          </div>
          <div className="ref-strip-grid">
            {referenzbilder.slice(0, 8).map(r => (
              <a key={r.id} href={r.bild_url} target="_blank" rel="noreferrer" className="ref-strip-thumb" title={r.typ}>
                <img src={r.bild_url} alt="" />
                {r.typ === 'logo' && <span className="ref-strip-badge">Logo</span>}
              </a>
            ))}
          </div>
        </div>
      )}

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
        open={showAnfrage}
        onClose={() => !anfrageBusy && setShowAnfrage(false)}
        title="Fotos & Logo anfragen"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowAnfrage(false)} disabled={anfrageBusy}>Abbrechen</button>
            <button className="btn-primary" onClick={sendAnfrage} disabled={anfrageBusy || !kunde?.email}>
              {anfrageBusy ? 'Sende…' : `Mail an ${kunde?.email || '—'} senden`}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Wir verschicken eine Mail an <strong>{kunde?.email || '(keine Mail hinterlegt)'}</strong> mit einem persönlichen Upload-Link.
          Der Kunde kann dort Logo und Fotos ohne Login hochladen — die Dateien tauchen automatisch hier oben auf.
        </p>
        <label className="field field-full">
          <span>Persönlicher Text (editierbar)</span>
          <textarea rows={6} value={anfrageText} onChange={e => setAnfrageText(e.target.value)} />
        </label>
        {anfrageMsg && <div className="form-msg" style={{ marginTop: 8 }}>{anfrageMsg}</div>}
      </Modal>

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
