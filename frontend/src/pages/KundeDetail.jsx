import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fileToBase64 } from '../lib/files.js';
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

  // Farben (lokaler Edit-State, mit Speichern-Button)
  const [farben, setFarben] = useState({ primaer: '', sekundaer: '', akzent: '' });
  const [farbenDirty, setFarbenDirty] = useState(false);
  const [farbenBusy, setFarbenBusy] = useState(false);
  const [farbenMsg, setFarbenMsg] = useState('');

  // Logo-Upload
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);

  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoUploading(true);
    try {
      const fileData = await fileToBase64(file);
      const res = await api(`/kunden/${kundeId}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      setKunde(res.kunde);
      if (res.kunde.farben) {
        setFarben({
          primaer:   res.kunde.farben.primaer   || '',
          sekundaer: res.kunde.farben.sekundaer || '',
          akzent:    res.kunde.farben.akzent    || '',
        });
        setFarbenDirty(false);
      }
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoUploading(false);
    }
  }

  function load() {
    setLoading(true);
    Promise.all([api(`/kunden/${kundeId}`), api(`/jobs?kunde_id=${kundeId}`)])
      .then(([k, j]) => {
        setKunde(k.kunde);
        setJobs(j.jobs || []);
        setFarben({
          primaer:   k.kunde?.farben?.primaer   || '',
          sekundaer: k.kunde?.farben?.sekundaer || '',
          akzent:    k.kunde?.farben?.akzent    || '',
        });
        setFarbenDirty(false);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  // Farben separat polling — bei Quick-Create aus URL kommen die Farben asynchron rein.
  useEffect(() => {
    if (!kunde) return;
    if (kunde.farben?.primaer) return;
    const start = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - start > 60_000) { clearInterval(t); return; }
      try {
        const k = await api(`/kunden/${kundeId}`);
        if (k.kunde?.farben?.primaer) {
          clearInterval(t);
          setKunde(k.kunde);
          setFarben({
            primaer:   k.kunde.farben.primaer   || '',
            sekundaer: k.kunde.farben.sekundaer || '',
            akzent:    k.kunde.farben.akzent    || '',
          });
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunde?.id]);

  function updateFarbe(key, value) {
    setFarben(prev => ({ ...prev, [key]: value }));
    setFarbenDirty(true);
  }

  async function saveFarben() {
    setFarbenBusy(true);
    setFarbenMsg('');
    try {
      const payload = {
        primaer:   farben.primaer.trim()   || null,
        sekundaer: farben.sekundaer.trim() || null,
        akzent:    farben.akzent.trim()    || null,
      };
      const allEmpty = !payload.primaer && !payload.sekundaer && !payload.akzent;
      const res = await api(`/kunden/${kundeId}`, {
        method: 'PATCH',
        body: { farben: allEmpty ? null : payload },
      });
      setKunde(res.kunde);
      setFarbenDirty(false);
      setFarbenMsg('Gespeichert.');
      setTimeout(() => setFarbenMsg(''), 2000);
    } catch (err) {
      setFarbenMsg(err.message);
    } finally {
      setFarbenBusy(false);
    }
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
        <button
          type="button"
          className={`kunde-head-logo ${kunde.logo_url ? 'has-image' : ''} is-clickable`}
          onClick={() => !logoUploading && logoInputRef.current?.click()}
          title={kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen'}
          aria-label={kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen'}
        >
          {kunde.logo_url
            ? <img src={kunde.logo_url} alt="" />
            : <span>{(kunde.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
          <span className="kunde-head-logo-edit">{logoUploading ? '…' : 'Ändern'}</span>
        </button>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: 'none' }}
          onChange={onLogoChange}
        />
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
              onClick={() => !logoUploading && logoInputRef.current?.click()}
              disabled={logoUploading}
            >
              {logoUploading
                ? 'Lade Logo hoch…'
                : (kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen')}
            </button>
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

      <div className="farben-card">
        <div className="farben-head">
          <div>
            <div className="form-section-title" style={{ marginBottom: 4 }}>Markenfarben</div>
            <div className="motiv-sub">Werden im Creative-Prompt für Text, Tags und Akzente verwendet.</div>
          </div>
          {farbenDirty && (
            <button className="btn-primary btn-sm" onClick={saveFarben} disabled={farbenBusy}>
              {farbenBusy ? 'Speichere…' : 'Speichern'}
            </button>
          )}
          {farbenMsg && <span className="form-msg">{farbenMsg}</span>}
        </div>
        <div className="farben-grid">
          {[
            { key: 'primaer',   label: 'Primär' },
            { key: 'sekundaer', label: 'Sekundär' },
            { key: 'akzent',    label: 'Akzent' },
          ].map(({ key, label }) => (
            <div className="farbe-pick" key={key}>
              <span className="farbe-label">{label}</span>
              <div className="farbe-row">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(farben[key]) ? farben[key] : '#cccccc'}
                  onChange={e => updateFarbe(key, e.target.value)}
                  aria-label={`${label} Farbe`}
                />
                <input
                  type="text"
                  className="farbe-hex"
                  placeholder="#rrggbb"
                  value={farben[key]}
                  onChange={e => updateFarbe(key, e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
        {!kunde.farben?.primaer && (
          <div className="farben-hint">
            Noch keine Farben hinterlegt — werden beim Hochladen eines Logos oder beim Anlegen via URL automatisch ermittelt.
          </div>
        )}
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
