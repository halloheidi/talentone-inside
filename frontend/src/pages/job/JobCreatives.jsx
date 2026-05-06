import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import Modal from '../../components/Modal.jsx';

export default function JobCreatives() {
  const { job } = useJob();
  const [vorschlaege, setVorschlaege] = useState([]);
  const [loadingVorschlaege, setLoadingVorschlaege] = useState(false);
  const [auswahl, setAuswahl] = useState('');         // ausgewählter Vorschlag
  const [eigenes, setEigenes] = useState('');         // freitext-Motiv
  const [varianten, setVarianten] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [creatives, setCreatives] = useState([]);
  const [loadingGalerie, setLoadingGalerie] = useState(true);
  const [reworkTarget, setReworkTarget] = useState(null); // creative-Objekt zum Überarbeiten
  const [reworkMotiv, setReworkMotiv] = useState('');
  const [reworkBusy, setReworkBusy] = useState(false);
  const requestedFor = useRef(null);

  const motiv = (eigenes.trim() || auswahl).trim();

  /* Galerie laden */
  function loadGalerie() {
    setLoadingGalerie(true);
    api(`/creatives?job_id=${job.id}`)
      .then(res => setCreatives(res.creatives || []))
      .catch(() => {})
      .finally(() => setLoadingGalerie(false));
  }
  useEffect(() => { loadGalerie(); /* eslint-disable-next-line */ }, [job.id]);

  /* Motiv-Vorschläge automatisch laden, sobald Job sich ändert */
  useEffect(() => {
    if (requestedFor.current === job.id) return;
    requestedFor.current = job.id;
    setVorschlaege([]);
    setAuswahl('');
    setLoadingVorschlaege(true);
    api('/creatives/motiv-vorschlaege', { method: 'POST', body: { job_id: job.id } })
      .then(res => setVorschlaege(res.motive || []))
      .catch(err => setGenerateError(`Vorschläge: ${err.message}`))
      .finally(() => setLoadingVorschlaege(false));
  }, [job.id]);

  async function reloadVorschlaege() {
    setLoadingVorschlaege(true);
    setGenerateError('');
    try {
      const res = await api('/creatives/motiv-vorschlaege', { method: 'POST', body: { job_id: job.id } });
      setVorschlaege(res.motive || []);
      setAuswahl('');
    } catch (err) {
      setGenerateError(`Vorschläge: ${err.message}`);
    } finally {
      setLoadingVorschlaege(false);
    }
  }

  async function onGenerate() {
    if (!motiv) {
      setGenerateError('Bitte ein Motiv wählen oder eigenes eintippen.');
      return;
    }
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await api('/creatives/generate', {
        method: 'POST',
        body: { job_id: job.id, motiv, varianten },
      });
      setCreatives(prev => [...(res.creatives || []), ...prev]);
      if (res.errors?.length) {
        setGenerateError(`Teilweise fehlgeschlagen: ${res.errors[0]}`);
      }
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function onDelete(id) {
    if (!confirm('Wirklich löschen?')) return;
    try {
      await api(`/creatives/${id}`, { method: 'DELETE' });
      setCreatives(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(`Löschen fehlgeschlagen: ${err.message}`);
    }
  }

  async function onReel(id) {
    try {
      await api(`/creatives/${id}/reel`, { method: 'POST' });
    } catch (err) {
      alert(err.message);
    }
  }

  function openRework(creative) {
    setReworkTarget(creative);
    setReworkMotiv(motiv || '');
  }

  async function submitRework() {
    if (!reworkMotiv.trim()) return;
    setReworkBusy(true);
    try {
      const res = await api(`/creatives/${reworkTarget.id}/regenerate`, {
        method: 'POST',
        body: { motiv: reworkMotiv.trim() },
      });
      setCreatives(prev => [res.creative, ...prev.filter(c => c.id !== reworkTarget.id)]);
      setReworkTarget(null);
      setReworkMotiv('');
    } catch (err) {
      alert(err.message);
    } finally {
      setReworkBusy(false);
    }
  }

  return (
    <div className="creatives-page">
      {/* ───────── Motiv-Sektion ───────── */}
      <section className="card-form motiv-section">
        <div className="motiv-head">
          <div>
            <div className="form-section-title" style={{ marginBottom: 4 }}>Motiv-Vorschläge</div>
            <div className="motiv-sub">
              Basierend auf <strong>{job.stelle || 'der Stelle'}</strong>{job.region ? ` (${job.region})` : ''}.
            </div>
          </div>
          <button className="btn-ghost" onClick={reloadVorschlaege} disabled={loadingVorschlaege}>
            {loadingVorschlaege ? 'Lade…' : 'Neu vorschlagen'}
          </button>
        </div>

        {loadingVorschlaege && vorschlaege.length === 0 && (
          <div className="motiv-skeleton">
            <div /><div /><div />
          </div>
        )}

        {vorschlaege.length > 0 && (
          <div className="motiv-grid">
            {vorschlaege.map((m, i) => (
              <button
                key={i}
                type="button"
                className={`motiv-card ${auswahl === m ? 'is-active' : ''}`}
                onClick={() => { setAuswahl(m); setEigenes(''); }}
              >
                <span className="motiv-num">Vorschlag {i + 1}</span>
                <span className="motiv-text">{m}</span>
              </button>
            ))}
          </div>
        )}

        <label className="field field-full" style={{ marginTop: 16 }}>
          <span>Eigenes Motiv (überschreibt Auswahl)</span>
          <textarea
            rows={2}
            placeholder="z.B. Servicetechniker installiert moderne Wärmepumpe in einer aufgeräumten Werkstatt, gedämpftes Morgenlicht…"
            value={eigenes}
            onChange={e => { setEigenes(e.target.value); if (e.target.value) setAuswahl(''); }}
          />
        </label>

        <div className="generate-row">
          <label className="field" style={{ flex: '0 0 140px' }}>
            <span>Varianten</span>
            <select value={varianten} onChange={e => setVarianten(Number(e.target.value))}>
              <option value={1}>1 (= 2 Bilder)</option>
              <option value={2}>2 (= 4 Bilder)</option>
              <option value={3}>3 (= 6 Bilder)</option>
            </select>
          </label>
          <div className="generate-actions">
            <div className="generate-hint">
              Erzeugt jeweils ein 1:1- und ein Story-Bild via gpt-image-2 — kann 30-60 Sekunden dauern.
            </div>
            <button className="btn-primary" onClick={onGenerate} disabled={generating || !motiv}>
              {generating ? 'Generiere…' : 'Creatives generieren'}
            </button>
          </div>
        </div>

        {generateError && <div className="alert alert-error" style={{ marginTop: 12 }}>{generateError}</div>}
      </section>

      {/* ───────── Galerie ───────── */}
      <section style={{ marginTop: 24 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Galerie</h2>
            <p className="section-sub">{creatives.length} Creative{creatives.length === 1 ? '' : 's'} für dieses Projekt.</p>
          </div>
        </div>

        {loadingGalerie && <div className="card empty">Lade Galerie…</div>}

        {!loadingGalerie && creatives.length === 0 && (
          <div className="card empty">
            <h2>Noch keine Creatives</h2>
            <p>Wähle oben ein Motiv und klick auf „Creatives generieren".</p>
          </div>
        )}

        {creatives.length > 0 && (
          <div className="creative-grid">
            {creatives.map(c => (
              <div key={c.id} className={`creative-card format-${c.format}`}>
                <div className="creative-thumb">
                  {c.bild_url
                    ? <img src={c.bild_url} alt="" loading="lazy" />
                    : <div className="creative-thumb-empty">kein Bild</div>}
                  <span className={`format-badge format-${c.format}`}>
                    {c.format === 'story' ? '9:16' : '1:1'}
                  </span>
                </div>
                <div className="creative-foot">
                  <span className="creative-date">{new Date(c.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <div className="creative-actions">
                    <button className="btn-ghost btn-sm" onClick={() => openRework(c)}>Überarbeiten</button>
                    {c.format === 'story' && (
                      <button className="btn-ghost btn-sm" onClick={() => onReel(c.id)}>Reel erstellen</button>
                    )}
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => onDelete(c.id)}>Löschen</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ───────── Rework-Modal ───────── */}
      <Modal
        open={!!reworkTarget}
        onClose={() => !reworkBusy && setReworkTarget(null)}
        title="Creative überarbeiten"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setReworkTarget(null)} disabled={reworkBusy}>Abbrechen</button>
            <button className="btn-primary" onClick={submitRework} disabled={reworkBusy || !reworkMotiv.trim()}>
              {reworkBusy ? 'Generiere…' : 'Neu generieren'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Format bleibt <strong>{reworkTarget?.format === 'story' ? '9:16 (Story)' : '1:1 (Feed)'}</strong>. Das alte Creative wird ersetzt.
        </p>
        <label className="field field-full">
          <span>Neues Motiv</span>
          <textarea rows={3} value={reworkMotiv} onChange={e => setReworkMotiv(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
