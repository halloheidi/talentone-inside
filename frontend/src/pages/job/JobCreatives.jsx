import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64, downloadFromUrl } from '../../lib/files.js';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import Lightbox from '../../components/Lightbox.jsx';

export default function JobCreatives() {
  const { job, kunde, reload: reloadJob } = useJob();

  // Modus
  const [mode, setMode] = useState('ki'); // 'ki' | 'foto'

  // Motive (Modus KI)
  const [vorschlaege, setVorschlaege] = useState([]);
  const [loadingVorschlaege, setLoadingVorschlaege] = useState(false);
  const [auswahl, setAuswahl] = useState('');
  const [eigenes, setEigenes] = useState('');

  // Personen-Referenzen (gemeinsame Liste für beide Modi)
  const [personen, setPersonen] = useState([]);
  const [personId, setPersonId] = useState(null);     // ausgewählte Person (Modus KI)
  const [fotoId, setFotoId] = useState(null);         // ausgewähltes Hintergrund-Foto (Modus Foto)

  // Upload
  const [logoUploading, setLogoUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);   // Datei + Beschreibungs-Modal
  const [pendingDesc, setPendingDesc] = useState('');
  const [pendingBusy, setPendingBusy] = useState(false);
  const logoInputRef = useRef(null);
  const personInputRef = useRef(null);

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

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState(null);

  // Reel-Generierung pro Parent-Creative-ID (zeigt Loading-State)
  const [reelBusy, setReelBusy] = useState(() => new Set());
  const reelPollRefs = useRef(new Map()); // parentId → intervalId

  function buildFilename(c) {
    const stelle = (job.stelle || 'creative').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const ts = new Date(c.created_at).toISOString().slice(0, 10);
    const ext = c.typ === 'video' ? 'mp4' : 'png';
    return `${stelle}-${c.format}-${ts}-${c.id.slice(0, 6)}.${ext}`;
  }

  async function onReel(creative) {
    if (reelBusy.has(creative.id)) return;
    const cost = '~1 USD pro Reel';
    if (!confirm(`Reel-Generierung dauert 1-3 Minuten und kostet ${cost}. Fortfahren?`)) return;
    try {
      await api(`/creatives/${creative.id}/reel`, { method: 'POST' });
      setReelBusy(prev => { const n = new Set(prev); n.add(creative.id); return n; });
      startReelPolling(creative.id);
    } catch (err) {
      alert(`Reel-Start fehlgeschlagen: ${err.message}`);
    }
  }

  function startReelPolling(parentId) {
    if (reelPollRefs.current.has(parentId)) return;
    const startedAt = Date.now();
    const TIMEOUT_MS = 6 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const res = await api(`/creatives?job_id=${job.id}`);
        const list = res.creatives || [];
        const reel = list.find(c => c.parent_id === parentId && c.typ === 'video');
        if (reel) {
          clearInterval(interval);
          reelPollRefs.current.delete(parentId);
          setCreatives(list);
          setReelBusy(prev => { const n = new Set(prev); n.delete(parentId); return n; });
          return;
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
          clearInterval(interval);
          reelPollRefs.current.delete(parentId);
          setReelBusy(prev => { const n = new Set(prev); n.delete(parentId); return n; });
          alert('Reel-Generierung dauert ungewöhnlich lang. Bitte später in der Galerie nachschauen oder Logs prüfen.');
        }
      } catch (err) { console.warn('[reel-poll]', err.message); }
    }, 6000);
    reelPollRefs.current.set(parentId, interval);
  }
  useEffect(() => () => {
    reelPollRefs.current.forEach(id => clearInterval(id));
    reelPollRefs.current.clear();
  }, []);

  async function downloadCreative(c, e) {
    e?.stopPropagation();
    try {
      await downloadFromUrl(c.bild_url, buildFilename(c));
    } catch (err) {
      alert(err.message);
    }
  }

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

  /* ───── Personen / Referenzbilder ───── */
  function loadPersonen() {
    if (!kunde?.id) return;
    api(`/kunden/${kunde.id}/referenzbilder`)
      .then(res => setPersonen((res.referenzbilder || []).filter(r => r.typ === 'foto')))
      .catch(() => {});
  }
  useEffect(() => { loadPersonen(); /* eslint-disable-next-line */ }, [kunde?.id]);

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
      const fileData = await fileToBase64(file);
      await api(`/kunden/${kunde.id}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      await reloadJob();
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoUploading(false);
    }
  }

  /* ───── Personen-Foto-Upload (mit Beschreibung) ───── */
  function onPersonChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingFile(file);
    setPendingDesc('');
  }

  async function submitPersonUpload() {
    if (!pendingFile) return;
    setPendingBusy(true);
    try {
      const fileData = await fileToBase64(pendingFile);
      const res = await api(`/kunden/${kunde.id}/referenzbilder`, {
        method: 'POST',
        body: {
          fileData, fileName: pendingFile.name,
          contentType: pendingFile.type || 'image/jpeg',
          beschreibung: pendingDesc.trim() || null,
        },
      });
      setPersonen(prev => [res.referenzbild, ...prev]);
      const id = res.referenzbild.id;
      if (mode === 'ki') setPersonId(id); else setFotoId(id);
      setPendingFile(null);
      setPendingDesc('');
    } catch (err) {
      alert(`Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setPendingBusy(false);
    }
  }

  async function deletePerson(id) {
    if (!confirm('Foto löschen?')) return;
    try {
      await api(`/kunden/referenzbilder/${id}`, { method: 'DELETE' });
      setPersonen(prev => prev.filter(r => r.id !== id));
      if (personId === id) setPersonId(null);
      if (fotoId === id) setFotoId(null);
    } catch (err) { alert(err.message); }
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
    setGenerateError('');
    if (mode === 'ki' && !motiv) {
      setGenerateError('Bitte ein Motiv wählen oder eigenes eintippen.');
      return;
    }
    if (mode === 'foto' && !fotoId) {
      setGenerateError('Bitte ein Foto auswählen oder neu hochladen.');
      return;
    }
    setGenerating(true);
    const baseline = creatives.length;
    try {
      const body = mode === 'ki'
        ? { job_id: job.id, mode, motiv, varianten, personenfoto_id: personId || undefined }
        : { job_id: job.id, mode, varianten, foto_id: fotoId };
      const res = await api('/creatives/generate', { method: 'POST', body });
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
    } catch (err) { alert(`Löschen fehlgeschlagen: ${err.message}`); }
  }

  function openRework(creative) { setReworkTarget(creative); setReworkMotiv(motiv || ''); }
  async function submitRework() {
    if (!reworkMotiv.trim()) return;
    setReworkBusy(true);
    try {
      const res = await api(`/creatives/${reworkTarget.id}/regenerate`, {
        method: 'POST',
        body: { mode: 'ki', motiv: reworkMotiv.trim(), personenfoto_id: personId || undefined },
      });
      setCreatives(prev => [res.creative, ...prev.filter(c => c.id !== reworkTarget.id)]);
      setReworkTarget(null);
      setReworkMotiv('');
    } catch (err) { alert(err.message); }
    finally { setReworkBusy(false); }
  }

  const aktiveAuswahlId = mode === 'ki' ? personId : fotoId;

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

      {/* ───────── Modus-Toggle ───────── */}
      <div className="mode-cards">
        <button
          type="button"
          className={`mode-card ${mode === 'ki' ? 'is-active' : ''}`}
          onClick={() => setMode('ki')}
        >
          <div className="mode-card-title">KI-Bild generieren</div>
          <div className="mode-card-desc">
            Komplett neue Szene mit gpt-image-2. Optional Personenfoto als Vorlage — die Person erscheint dann in der KI-Szene.
          </div>
        </button>
        <button
          type="button"
          className={`mode-card ${mode === 'foto' ? 'is-active' : ''}`}
          onClick={() => setMode('foto')}
        >
          <div className="mode-card-title">Eigenes Foto verwenden</div>
          <div className="mode-card-desc">
            Echtes Foto bleibt unverändert als Hintergrund. Logo, Spruch und Benefits werden professionell als Overlay hinzugefügt.
          </div>
        </button>
      </div>

      {/* ───────── Motiv-Sektion (nur Modus KI) ───────── */}
      {mode === 'ki' && (
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
        </section>
      )}

      {/* ───────── Personen-Sektion ───────── */}
      <section className="card-form" style={{ marginTop: mode === 'ki' ? 18 : 0 }}>
        <div className="form-section-title" style={{ marginBottom: 4 }}>
          {mode === 'ki' ? 'Personen-Referenz (optional)' : 'Hintergrund-Foto auswählen'}
        </div>
        <p className="pane-hint" style={{ margin: '0 0 12px' }}>
          {mode === 'ki'
            ? 'Foto eines echten Mitarbeiters / der Geschäftsführung. Die KI baut diese Person in die generierte Szene ein.'
            : 'Foto auswählen, das als unveränderter Hintergrund verwendet wird.'}
        </p>

        <div className="ref-grid">
          {mode === 'ki' && (
            <button
              type="button"
              className={`ref-card ref-card-none ${personId === null ? 'is-active' : ''}`}
              onClick={() => setPersonId(null)}
            >
              <span>Ohne Person<br/><small>(KI generiert)</small></span>
            </button>
          )}
          {personen.map(r => {
            const selected = aktiveAuswahlId === r.id;
            return (
              <button
                key={r.id}
                type="button"
                className={`ref-card has-img ${selected ? 'is-active' : ''}`}
                onClick={() => mode === 'ki' ? setPersonId(r.id) : setFotoId(r.id)}
                title={r.beschreibung || 'Person'}
              >
                <img src={r.bild_url} alt="" />
                {r.uploaded_via === 'kunde' && <span className="ref-badge">Kunde</span>}
                <button
                  type="button"
                  className="ref-del"
                  title="Löschen"
                  onClick={e => { e.stopPropagation(); deletePerson(r.id); }}
                >×</button>
                <div className="ref-caption">
                  {r.beschreibung || <em style={{ color: 'var(--ink-4)' }}>ohne Beschreibung</em>}
                </div>
              </button>
            );
          })}
          <label className="ref-card ref-card-upload">
            <input
              ref={personInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={onPersonChange}
            />
            <span>+ Person hochladen</span>
          </label>
        </div>
      </section>

      {/* ───────── Generate-Bar ───────── */}
      <section className="card-form" style={{ marginTop: 18 }}>
        <div className="generate-row" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
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
            <button
              className="btn-primary"
              onClick={onGenerate}
              disabled={generating || (mode === 'ki' ? !motiv : !fotoId)}
            >
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
            <p>Wähle oben einen Modus und klick auf „Creatives generieren".</p>
          </div>
        )}
        {creatives.length > 0 && (
          <div className="creative-grid">
            {creatives.map((c, i) => (
              <div key={c.id} className={`creative-card format-${c.format}`}>
                <button
                  type="button"
                  className="creative-thumb"
                  onClick={() => c.bild_url && setLightboxIndex(i)}
                  title="Klicken für Vollansicht"
                  aria-label="Vollansicht öffnen"
                >
                  {!c.bild_url ? (
                    <div className="creative-thumb-empty">kein Bild</div>
                  ) : c.typ === 'video' ? (
                    <>
                      <video src={c.bild_url} preload="metadata" muted playsInline />
                      <span className="creative-play-icon" aria-hidden>▶</span>
                    </>
                  ) : (
                    <img src={c.bild_url} alt="" loading="lazy" />
                  )}
                  <span className={`format-badge format-${c.format}`}>
                    {c.typ === 'video' ? 'REEL' : (c.format === 'story' ? '9:16' : '1:1')}
                  </span>
                  {c.bild_url && (
                    <button
                      type="button"
                      className="thumb-download"
                      title="Herunterladen"
                      aria-label="Datei herunterladen"
                      onClick={(e) => downloadCreative(c, e)}
                    >
                      <Icon name="download" size={16} />
                    </button>
                  )}
                </button>
                <div className="creative-foot">
                  <span className="creative-date">{new Date(c.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <div className="creative-actions">
                    {c.typ !== 'video' && (
                      <button className="btn-ghost btn-sm" onClick={() => openRework(c)}>Überarbeiten</button>
                    )}
                    {c.format === 'story' && c.typ !== 'video' && (
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => onReel(c)}
                        disabled={reelBusy.has(c.id)}
                      >
                        {reelBusy.has(c.id) ? 'Reel läuft…' : 'Reel'}
                      </button>
                    )}
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => onDelete(c.id)}>Löschen</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {lightboxIndex !== null && (
          <Lightbox
            items={creatives}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
            filenameFor={buildFilename}
          />
        )}
      </section>

      {/* ───── Personen-Upload Modal: Beschreibung erfassen ───── */}
      <Modal
        open={!!pendingFile}
        onClose={() => !pendingBusy && setPendingFile(null)}
        title="Wer ist auf dem Foto?"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPendingFile(null)} disabled={pendingBusy}>Abbrechen</button>
            <button className="btn-primary" onClick={submitPersonUpload} disabled={pendingBusy}>
              {pendingBusy ? 'Lade hoch…' : 'Hochladen'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Eine kurze Beschreibung hilft der KI später beim Einsetzen der Person in die Szene.
        </p>
        <label className="field field-full">
          <span>Beschreibung (optional)</span>
          <input
            type="text"
            placeholder="z.B. Max Müller, Geschäftsführer"
            value={pendingDesc}
            onChange={e => setPendingDesc(e.target.value)}
          />
        </label>
        {pendingFile && (
          <div className="form-msg" style={{ marginTop: 6 }}>
            Datei: <strong>{pendingFile.name}</strong> · {(pendingFile.size / 1024).toFixed(0)} KB
          </div>
        )}
      </Modal>

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
          Format bleibt <strong>{reworkTarget?.format === 'story' ? '9:16 (Story)' : '1:1 (Feed)'}</strong>. Modus „KI-Bild" — das alte Creative wird ersetzt.
        </p>
        <label className="field field-full">
          <span>Neues Motiv</span>
          <textarea rows={3} value={reworkMotiv} onChange={e => setReworkMotiv(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
