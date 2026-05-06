import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { uploadFile } from '../../lib/files.js';
import Modal from '../../components/Modal.jsx';

export default function JobCreatives() {
  const { job, kunde, reload: reloadJob } = useJob();

  // Motive
  const [vorschlaege, setVorschlaege] = useState([]);
  const [loadingVorschlaege, setLoadingVorschlaege] = useState(false);
  const [auswahl, setAuswahl] = useState('');
  const [eigenes, setEigenes] = useState('');

  // Logo + Referenzbilder
  const [referenzbilder, setReferenzbilder] = useState([]);
  const [referenzId, setReferenzId] = useState(null);  // ausgewähltes Referenzbild
  const [logoUploading, setLogoUploading] = useState(false);
  const [refUploading, setRefUploading] = useState(false);
  const logoInputRef = useRef(null);
  const refInputRef = useRef(null);

  // Generation
  const [varianten, setVarianten] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [creatives, setCreatives] = useState([]);
  const [loadingGalerie, setLoadingGalerie] = useState(true);
  const [expected, setExpected] = useState(0);
  const pollRef = useRef(null);

  // Rework
  const [reworkTarget, setReworkTarget] = useState(null);
  const [reworkMotiv, setReworkMotiv] = useState('');
  const [reworkBusy, setReworkBusy] = useState(false);

  const requestedFor = useRef(null);
  const motiv = (eigenes.trim() || auswahl).trim();

  /* ───── Galerie ───── */
  function loadGalerie() {
    setLoadingGalerie(true);
    api(`/creatives?job_id=${job.id}`)
      .then(res => setCreatives(res.creatives || []))
      .catch(() => {})
      .finally(() => setLoadingGalerie(false));
  }
  useEffect(() => { loadGalerie(); /* eslint-disable-next-line */ }, [job.id]);

  /* ───── Referenzbilder ───── */
  function loadReferenzbilder() {
    if (!kunde?.id) return;
    api(`/kunden/${kunde.id}/referenzbilder`)
      .then(res => setReferenzbilder((res.referenzbilder || []).filter(r => r.typ === 'foto')))
      .catch(() => {});
  }
  useEffect(() => { loadReferenzbilder(); /* eslint-disable-next-line */ }, [kunde?.id]);

  /* ───── Motiv-Vorschläge ───── */
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

  /* ───── Logo-Upload ───── */
  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoUploading(true);
    try {
      await uploadFile(file, body => api(`/kunden/${kunde.id}/logo`, { method: 'POST', body }));
      await reloadJob();
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoUploading(false);
    }
  }

  /* ───── Referenzbild-Upload ───── */
  async function onRefChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRefUploading(true);
    try {
      const res = await uploadFile(file, body => api(`/kunden/${kunde.id}/referenzbilder`, { method: 'POST', body }));
      setReferenzbilder(prev => [res.referenzbild, ...prev]);
      setReferenzId(res.referenzbild.id);
    } catch (err) {
      alert(`Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setRefUploading(false);
    }
  }

  async function deleteReferenz(id) {
    if (!confirm('Referenzbild löschen?')) return;
    try {
      await api(`/kunden/referenzbilder/${id}`, { method: 'DELETE' });
      setReferenzbilder(prev => prev.filter(r => r.id !== id));
      if (referenzId === id) setReferenzId(null);
    } catch (err) {
      alert(err.message);
    }
  }

  /* ───── Polling ───── */
  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  function startPolling(baselineCount, expectedNew) {
    stopPolling();
    const startedAt = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api(`/creatives?job_id=${job.id}`);
        const list = res.creatives || [];
        setCreatives(list);
        if (list.length - baselineCount >= expectedNew) {
          stopPolling(); setGenerating(false); setExpected(0); return;
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
          stopPolling(); setGenerating(false); setExpected(0);
          setGenerateError('Generierung dauert ungewöhnlich lang. Bitte später nochmal prüfen.');
        }
      } catch (err) { console.warn('[poll]', err.message); }
    }, 4000);
  }
  useEffect(() => () => stopPolling(), []);

  /* ───── Generate ───── */
  async function onGenerate() {
    if (!motiv) { setGenerateError('Bitte ein Motiv wählen oder eigenes eintippen.'); return; }
    setGenerating(true);
    setGenerateError('');
    const baseline = creatives.length;
    try {
      const res = await api('/creatives/generate', {
        method: 'POST',
        body: { job_id: job.id, motiv, varianten, referenzbild_id: referenzId || undefined },
      });
      const exp = res.expected || varianten * 2;
      setExpected(exp);
      startPolling(baseline, exp);
    } catch (err) {
      setGenerateError(err.message);
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

  function openRework(creative) { setReworkTarget(creative); setReworkMotiv(motiv || ''); }
  async function submitRework() {
    if (!reworkMotiv.trim()) return;
    setReworkBusy(true);
    try {
      const res = await api(`/creatives/${reworkTarget.id}/regenerate`, {
        method: 'POST',
        body: { motiv: reworkMotiv.trim(), referenzbild_id: referenzId || undefined },
      });
      setCreatives(prev => [res.creative, ...prev.filter(c => c.id !== reworkTarget.id)]);
      setReworkTarget(null);
      setReworkMotiv('');
    } catch (err) { alert(err.message); }
    finally { setReworkBusy(false); }
  }

  return (
    <div className="creatives-page">
      {/* ───────── Logo-Status ───────── */}
      <div className={`logo-banner ${kunde?.logo_url ? 'has-logo' : 'no-logo'}`}>
        <div className="logo-banner-preview">
          {kunde?.logo_url
            ? <img src={kunde.logo_url} alt="Logo" />
            : <span>?</span>}
        </div>
        <div className="logo-banner-text">
          {kunde?.logo_url ? (
            <>
              <strong>Logo ist hinterlegt.</strong>
              <span>Wird beim Generieren oben rechts ins Creative eingebaut.</span>
            </>
          ) : (
            <>
              <strong>Noch kein Logo hinterlegt.</strong>
              <span>Logo verbessert die Marken-Wiedererkennung im Creative deutlich.</span>
            </>
          )}
        </div>
        <div className="logo-banner-actions">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            style={{ display: 'none' }}
            onChange={onLogoChange}
          />
          <button className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
            {logoUploading ? 'Lade hoch…' : (kunde?.logo_url ? 'Logo ersetzen' : 'Logo hochladen')}
          </button>
        </div>
      </div>

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
          <div className="motiv-skeleton"><div /><div /><div /></div>
        )}

        {vorschlaege.length > 0 && (
          <div className="motiv-grid">
            {vorschlaege.map((m, i) => (
              <button
                key={i} type="button"
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

        {/* Referenzbild-Sektion */}
        <div className="form-section" style={{ marginTop: 18 }}>
          <div className="form-section-title">Stil-Referenzbild (optional)</div>
          <p className="pane-hint" style={{ margin: '0 0 10px' }}>
            Echtes Foto vom Arbeitsplatz / Team — dient als Stil-Vorlage. Lichtstimmung und Atmosphäre werden ins Creative übernommen.
          </p>
          <div className="ref-grid">
            <button
              type="button"
              className={`ref-card ref-card-none ${referenzId === null ? 'is-active' : ''}`}
              onClick={() => setReferenzId(null)}
            >
              <span>Ohne Referenz</span>
            </button>
            {referenzbilder.map(r => (
              <button
                key={r.id}
                type="button"
                className={`ref-card ${referenzId === r.id ? 'is-active' : ''}`}
                onClick={() => setReferenzId(r.id)}
                title={r.label || ''}
              >
                <img src={r.bild_url} alt="" />
                {r.uploaded_via === 'kunde' && <span className="ref-badge">Kunde</span>}
                <button
                  type="button"
                  className="ref-del"
                  title="Referenzbild löschen"
                  onClick={e => { e.stopPropagation(); deleteReferenz(r.id); }}
                >×</button>
              </button>
            ))}
            <label className="ref-card ref-card-upload">
              <input
                ref={refInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={onRefChange}
              />
              <span>{refUploading ? 'Lade…' : '+ Hochladen'}</span>
            </label>
          </div>
        </div>

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
              Läuft im Hintergrund — Bilder erscheinen automatisch in der Galerie. Pro Bild ~30-90 Sekunden.
            </div>
            <button className="btn-primary" onClick={onGenerate} disabled={generating || !motiv}>
              {generating ? `Generiere ${expected} Bilder…` : 'Creatives generieren'}
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
                      <button className="btn-ghost btn-sm" onClick={() => alert('Reel-Feature folgt.')}>Reel</button>
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
