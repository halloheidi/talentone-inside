import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64, downloadFromUrl } from '../../lib/files.js';
import Modal from '../../components/Modal.jsx';
import Icon from '../../components/Icon.jsx';
import Lightbox from '../../components/Lightbox.jsx';
import MultiPhotoUpload from '../../components/MultiPhotoUpload.jsx';
import UploadCreativesModal from '../../components/UploadCreativesModal.jsx';
import LogoPositionModal from '../../components/LogoPositionModal.jsx';

export default function JobCreatives() {
  const { job, kunde, reload: reloadJob, startCreatives, startReel } = useJob();
  // Ein-Mal-Default: wenn Kunde KI-Bilder ablehnt, direkt in Overlay-Modus starten.
  useEffect(() => {
    if (kunde?.keine_ki_bilder && mode === 'ki') setMode('overlay');
    // eslint-disable-next-line
  }, [kunde?.id]);

  // Modus — bei Kunden ohne KI-Freigabe automatisch 'overlay' als Default
  const [mode, setMode] = useState('ki'); // 'ki' | 'foto' | 'overlay'

  // Motive (Modus KI)
  const [vorschlaege, setVorschlaege] = useState([]);
  const [loadingVorschlaege, setLoadingVorschlaege] = useState(false);
  const [auswahl, setAuswahl] = useState('');
  const [eigenes, setEigenes] = useState('');

  // Spruch / Headline (beide Modi)
  const [spruchVorschlaege, setSpruchVorschlaege] = useState([]);
  const [loadingSprueche, setLoadingSprueche] = useState(false);
  const [spruch, setSpruch] = useState('');
  const [verbessertVarianten, setVerbessertVarianten] = useState([]);
  const [verbessernBusy, setVerbessernBusy] = useState(false);
  const [kontextHinweis, setKontextHinweis] = useState('');
  const [spruechAusBild, setSpruechAusBild] = useState(false); // letzter Vorschlag basierte auf Vision

  // Personen-Referenzen (gemeinsame Liste für beide Modi)
  const [personen, setPersonen] = useState([]);
  const [personId, setPersonId] = useState(null);     // ausgewählte Person (Modus KI)
  const [fotoId, setFotoId] = useState(null);         // ausgewähltes Hintergrund-Foto (Modus Foto)

  // Upload
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);
  const [showCreativeUpload, setShowCreativeUpload] = useState(false);

  // Stilvorlagen
  const [stilvorlagen, setStilvorlagen] = useState([]);
  const [stilvorlageId, setStilvorlageId] = useState(null);
  const [stilLightboxIndex, setStilLightboxIndex] = useState(null);

  // Generation
  const [varianten, setVarianten] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [creatives, setCreatives] = useState([]);
  const [logoPosTarget, setLogoPosTarget] = useState(null);
  const [loadingGalerie, setLoadingGalerie] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expected, setExpected] = useState(0);
  const pollRef = useRef(null);

  // Rework
  const [reworkTarget, setReworkTarget] = useState(null);
  const [reworkMotiv, setReworkMotiv] = useState('');
  const [reworkBusy, setReworkBusy] = useState(false);
  const reworkAbortRef = useRef(null);

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
      // Persistenter Banner
      startReel?.(creative.id);
    } catch (err) {
      alert(`Reel-Start fehlgeschlagen: ${err.message}`);
    }
  }

  function startReelPolling(parentId) {
    if (reelPollRefs.current.has(parentId)) return;
    const startedAt = Date.now();
    // Reels brauchen 2-8 Min. Kein harter Timeout — Polling läuft mit Backoff
    // weiter bis Reel da ist oder User die Seite verlässt.
    let timer = null;
    async function tick() {
      try {
        const res = await api(`/creatives?job_id=${job.id}`);
        const list = res.creatives || [];
        const reel = list.find(c => c.parent_id === parentId && c.typ === 'video');
        if (reel) {
          if (timer) clearTimeout(timer);
          reelPollRefs.current.delete(parentId);
          setCreatives(list);
          setReelBusy(prev => { const n = new Set(prev); n.delete(parentId); return n; });
          return;
        }
      } catch (err) { console.warn('[reel-poll]', err.message); }
      const elapsedMin = (Date.now() - startedAt) / 60_000;
      const delay = elapsedMin > 15 ? 30_000
                  : elapsedMin > 6  ? 15_000
                  : 6_000;
      timer = setTimeout(tick, delay);
      reelPollRefs.current.set(parentId, timer);
    }
    timer = setTimeout(tick, 6_000);
    reelPollRefs.current.set(parentId, timer);
  }
  useEffect(() => () => {
    reelPollRefs.current.forEach(timer => clearTimeout(timer));
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
    const archivedParam = showArchived ? '&archived=true' : '';
    api(`/creatives?job_id=${job.id}${archivedParam}`)
      .then(res => setCreatives(res.creatives || []))
      .catch(() => {})
      .finally(() => setLoadingGalerie(false));
  }
  useEffect(() => { loadGalerie(); /* eslint-disable-next-line */ }, [job.id, showArchived]);

  // Stilvorlagen einmalig laden
  useEffect(() => {
    api('/stilvorlagen')
      .then(res => {
        const list = res.stilvorlagen || [];
        setStilvorlagen(list);
        if (list.length && !stilvorlageId) setStilvorlageId(list[0].id);
      })
      .catch(() => setStilvorlagen([]));
    // eslint-disable-next-line
  }, []);

  /* ───── Kunden-Kommentare aus Review laden ───── */
  const [reviewKommentare, setReviewKommentare] = useState({}); // { 'creative_<id>': text, ... }
  const [reviewStatus, setReviewStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api(`/jobs/${job.id}/export/review`)
      .then(res => {
        if (cancelled) return;
        const k = res.review?.kommentare;
        setReviewKommentare(k && typeof k === 'object' ? k : {});
        setReviewStatus(res.review?.status || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.id]);

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

  /* ───── Spruch-Vorschläge (beide Modi, mit optionalem Vision-Input) ───── */
  // Aktuell gewähltes Bild für Vision-Analyse (foto-Modus: Hintergrund, ki-Modus: Person)
  const aktivesBildId = mode === 'foto' ? fotoId : personId;
  const aktivesBildUrl = aktivesBildId
    ? (personen.find(p => p.id === aktivesBildId)?.bild_url || null)
    : null;

  useEffect(() => {
    // Beim ersten Mount für diesen Job Text-basierte Sprüche vorladen (ohne Bild)
    let cancelled = false;
    setSpruchVorschlaege([]);
    setSpruechAusBild(false);
    setLoadingSprueche(true);
    api('/creatives/spruch-vorschlaege', { method: 'POST', body: { job_id: job.id } })
      .then(res => { if (!cancelled) setSpruchVorschlaege(res.sprueche || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSprueche(false); });
    return () => { cancelled = true; };
  }, [job.id]);

  async function reloadSpruchVorschlaege(useVision = false) {
    setLoadingSprueche(true);
    setVerbessertVarianten([]);
    try {
      const body = { job_id: job.id, motiv: motiv || undefined };
      if (useVision && aktivesBildUrl) {
        body.bild_url = aktivesBildUrl;
        body.kontext_hinweis = kontextHinweis.trim() || undefined;
      }
      const res = await api('/creatives/spruch-vorschlaege', { method: 'POST', body });
      setSpruchVorschlaege(res.sprueche || []);
      setSpruechAusBild(!!res.used_vision);
    } catch (err) {
      alert(`Spruch-Vorschläge: ${err.message}`);
    } finally {
      setLoadingSprueche(false);
    }
  }

  async function verbessereDenSpruch() {
    if (!spruch.trim()) return;
    setVerbessernBusy(true);
    setVerbessertVarianten([]);
    try {
      const res = await api('/creatives/spruch-verbessern', {
        method: 'POST',
        body: { job_id: job.id, spruch: spruch.trim() },
      });
      setVerbessertVarianten(res.varianten || []);
    } catch (err) {
      alert(`Verbessern: ${err.message}`);
    } finally {
      setVerbessernBusy(false);
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

  async function deletePerson(id) {
    if (!confirm('Foto löschen?')) return;
    try {
      await api(`/kunden/referenzbilder/${id}`, { method: 'DELETE' });
      setPersonen(prev => prev.filter(r => r.id !== id));
      if (personId === id) setPersonId(null);
      if (fotoId === id) setFotoId(null);
    } catch (err) { alert(err.message); }
  }

  /* ───── Polling (mit Backoff statt hartem Timeout) ─────
   * Phase 1 (0–5 Min):  alle 4s pollen — primäres Fenster
   * Phase 2 (5–15 Min): alle 15s pollen — Hintergrund-Banner zeigen
   * Phase 3 (>15 Min):  alle 30s pollen, dezenter Hinweis statt Fehler
   * Endet nur wenn alle erwarteten Creatives da sind ODER User die Seite verlässt. */
  function stopPolling() {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  }
  function startPolling(baselineCount, expectedNew) {
    stopPolling();
    const startedAt = Date.now();

    async function tick() {
      try {
        const res = await api(`/creatives?job_id=${job.id}`);
        const list = res.creatives || [];
        setCreatives(list);

        // Backend hat einen aktuellen Fehler gemeldet (nach Generierungs-Start aufgetreten)?
        const err = res.last_generation_error;
        if (err && err.ts > startedAt) {
          stopPolling();
          setGenerating(false);
          setExpected(0);
          setGenerateError(err.friendly || err.error || 'Bildgenerierung fehlgeschlagen.');
          // Server-Marker leeren damit nächster Run wieder sauber startet
          api('/creatives/clear-error', { method: 'POST', body: { job_id: job.id } }).catch(() => {});
          return;
        }

        const have = list.length - baselineCount;
        if (have >= expectedNew) {
          stopPolling(); setGenerating(false); setExpected(0); setGenerateError(''); return;
        }
      } catch (err) {
        console.warn('[poll]', err.message);
      }

      // Adaptives Intervall (Backoff)
      const elapsedMin = (Date.now() - startedAt) / 60_000;
      const delay = elapsedMin > 15 ? 30_000
                  : elapsedMin > 5  ? 15_000
                  : 4_000;
      pollRef.current = setTimeout(tick, delay);
    }
    pollRef.current = setTimeout(tick, 4_000);
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
    if (mode === 'overlay' && !spruch.trim()) {
      setGenerateError('Für den Overlay-Modus brauchst du einen Hook/Spruch.');
      return;
    }
    setGenerating(true);
    const baseline = creatives.length;
    try {
      const trimmedSpruch = spruch.trim() || undefined;
      const body = mode === 'ki'
        ? { job_id: job.id, mode, motiv, varianten, personenfoto_id: personId || undefined, spruch: trimmedSpruch, stilvorlage_id: stilvorlageId || undefined }
        : mode === 'foto'
        ? { job_id: job.id, mode, varianten, foto_id: fotoId, spruch: trimmedSpruch, stilvorlage_id: stilvorlageId || undefined }
        : { job_id: job.id, mode: 'overlay', varianten, spruch: trimmedSpruch, benefits: Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [] };
      const res = await api('/creatives/generate', { method: 'POST', body });
      const exp = res.expected || varianten * 2;
      setExpected(exp);
      startPolling(baseline, exp);
      // Persistenter Banner über JobView-Context (übersteht Tab-Wechsel)
      startCreatives?.(exp);
    } catch (err) {
      setGenerateError(err.message);
      setGenerating(false);
    }
  }

  async function onArchive(id) {
    if (!confirm('Creative archivieren? Das Bild verschwindet aus der Galerie, bleibt aber im Archiv wiederherstellbar.')) return;
    try {
      await api(`/creatives/${id}/archivieren`, { method: 'POST' });
      setCreatives(prev => prev.filter(c => c.id !== id));
    } catch (err) { alert(`Archivieren fehlgeschlagen: ${err.message}`); }
  }
  async function onRestore(id) {
    try {
      await api(`/creatives/${id}/wiederherstellen`, { method: 'POST' });
      setCreatives(prev => prev.filter(c => c.id !== id));
    } catch (err) { alert(`Wiederherstellen fehlgeschlagen: ${err.message}`); }
  }
  async function onDeleteForever(id) {
    if (!confirm('Endgültig LÖSCHEN? Das Bild wird aus Storage und Datenbank entfernt und kann nicht mehr wiederhergestellt werden.')) return;
    try {
      await api(`/creatives/${id}`, { method: 'DELETE' });
      setCreatives(prev => prev.filter(c => c.id !== id));
    } catch (err) { alert(`Löschen fehlgeschlagen: ${err.message}`); }
  }

  function openRework(creative) { setReworkTarget(creative); setReworkMotiv(motiv || ''); }
  function cancelRework() {
    // Laufenden Request abbrechen + UI zurücksetzen
    if (reworkAbortRef.current) {
      reworkAbortRef.current.abort();
      reworkAbortRef.current = null;
    }
    setReworkBusy(false);
    setReworkTarget(null);
    setReworkMotiv('');
  }
  async function submitRework() {
    if (!reworkMotiv.trim()) return;
    setReworkBusy(true);
    const controller = new AbortController();
    reworkAbortRef.current = controller;
    try {
      const res = await api(`/creatives/${reworkTarget.id}/regenerate`, {
        method: 'POST',
        body: { mode: 'ki', motiv: reworkMotiv.trim(), personenfoto_id: personId || undefined },
        signal: controller.signal,
      });
      setCreatives(prev => [res.creative, ...prev.filter(c => c.id !== reworkTarget.id)]);
      setReworkTarget(null);
      setReworkMotiv('');
    } catch (err) {
      if (err.name !== 'AbortError') alert(err.message);
    } finally {
      reworkAbortRef.current = null;
      setReworkBusy(false);
    }
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
          {kunde?.logo_url && (
            <button
              className="btn-ghost btn-sm"
              onClick={async () => {
                try {
                  const originalName = decodeURIComponent(kunde.logo_url.split('/').pop() || '').split('?')[0];
                  const ext = (originalName.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];
                  const slug = (kunde.firmenname || 'logo').toString().normalize('NFKD')
                    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'logo';
                  await downloadFromUrl(kunde.logo_url, `${slug}-logo${ext}`);
                } catch (err) { alert('Download fehlgeschlagen: ' + err.message); }
              }}
              title="Logo in Originalqualität herunterladen"
            >⬇ Download</button>
          )}
        </div>
      </div>

      {/* ───────── Modus-Toggle ───────── */}
      {kunde?.keine_ki_bilder && (
        <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#78350f' }}>
          ⚠️ <strong>{kunde.firmenname}</strong> möchte keine KI-Bilder — bitte nur Overlays oder eigene Fotos verwenden.
        </div>
      )}
      <div className="mode-cards">
        <button
          type="button"
          className={`mode-card ${mode === 'ki' ? 'is-active' : ''} ${kunde?.keine_ki_bilder ? 'is-disabled' : ''}`}
          onClick={() => {
            if (kunde?.keine_ki_bilder && !confirm(`${kunde.firmenname} hat KI-Bilder ausgeschlossen. Trotzdem KI-Modus wählen?`)) return;
            setMode('ki');
          }}
          style={kunde?.keine_ki_bilder ? { opacity: 0.55 } : undefined}
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
        <button
          type="button"
          className={`mode-card ${mode === 'overlay' ? 'is-active' : ''}`}
          onClick={() => setMode('overlay')}
          title="Für Kunden ohne KI-Bild-Freigabe — transparentes PNG zum Drüberlegen in Canva"
        >
          <div className="mode-card-title">📐 Nur Overlay (ohne KI)</div>
          <div className="mode-card-desc">
            Transparentes PNG mit Hook, Job-Block, Benefits und Logo. In Canva über ein eigenes Foto legen — kein Bild geht durch die KI.
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

      {/* ───────── Spruch / Headline (beide Modi) ───────── */}
      <section className="card-form spruch-section" style={{ marginTop: 18 }}>
        <div className="motiv-head">
          <div>
            <div className="form-section-title" style={{ marginBottom: 4 }}>Spruch / Headline auf dem Creative</div>
            <div className="motiv-sub">
              Wähle einen Vorschlag oder schreibe deinen eigenen — landet als <strong>Haupt-Headline</strong> im Bild.
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => reloadSpruchVorschlaege(false)} disabled={loadingSprueche}>
            {loadingSprueche ? 'Lade…' : '🔄 Neue Vorschläge'}
          </button>
        </div>

        {/* Vision-Block: nur sichtbar wenn ein Bild ausgewählt ist */}
        {aktivesBildUrl && (
          <div className="vision-block">
            <div className="vision-block-head">
              <img src={aktivesBildUrl} alt="" className="vision-thumb" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  ✨ Sprüche zum {mode === 'foto' ? 'Hintergrund-Foto' : 'Personen-Foto'} generieren
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                  Die KI schaut sich das Bild an und schlägt passende Headlines vor.
                </div>
              </div>
            </div>
            <label className="field field-full" style={{ marginTop: 10 }}>
              <span>Kontext zum Bild (optional)</span>
              <input
                type="text"
                placeholder='z.B. "Das sind die zwei Chefs, die rumblödeln" oder "Unser dienstältester Monteur"'
                value={kontextHinweis}
                onChange={e => setKontextHinweis(e.target.value)}
                maxLength={200}
              />
            </label>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => reloadSpruchVorschlaege(true)}
              disabled={loadingSprueche}
              style={{ marginTop: 10 }}
            >
              {loadingSprueche ? 'Analysiere Bild…' : '✨ Sprüche zum Bild vorschlagen'}
            </button>
          </div>
        )}

        {loadingSprueche && spruchVorschlaege.length === 0 && (
          <div className="motiv-skeleton"><div /><div /><div /><div /></div>
        )}

        {spruchVorschlaege.length > 0 && (
          <>
            {spruechAusBild && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', margin: '12px 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ padding: '2px 8px', background: 'rgba(232,255,61,0.25)', borderRadius: 100, fontWeight: 700, letterSpacing: 0.05, textTransform: 'uppercase', fontSize: 9.5 }}>
                  📷 Aus Bild
                </span>
                <span>Diese Vorschläge basieren auf der Bildanalyse</span>
              </div>
            )}
            <div className="spruch-grid">
              {spruchVorschlaege.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className={`spruch-card ${spruch === s ? 'is-active' : ''}`}
                  onClick={() => setSpruch(s)}
                >{s}</button>
              ))}
            </div>
          </>
        )}

        <label className="field field-full" style={{ marginTop: 14 }}>
          <span>Finaler Spruch (frei editierbar)</span>
          <input
            type="text"
            placeholder='z.B. „Hände, die was bewegen." oder leer lassen für KI-erfundenen Spruch'
            value={spruch}
            onChange={e => { setSpruch(e.target.value); setVerbessertVarianten([]); }}
            maxLength={80}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={verbessereDenSpruch}
            disabled={verbessernBusy || !spruch.trim()}
          >
            {verbessernBusy ? 'Verbessere…' : '✨ Mit KI verbessern'}
          </button>
          {spruch && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setSpruch(''); setVerbessertVarianten([]); }}>
              Leeren
            </button>
          )}
        </div>

        {verbessertVarianten.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="form-section-title" style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>
              ✨ Verbesserte Varianten — klick zum Übernehmen
            </div>
            <div className="spruch-grid">
              {verbessertVarianten.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className="spruch-card spruch-card-verbessert"
                  onClick={() => { setSpruch(v); setVerbessertVarianten([]); }}
                >{v}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ───────── Personen-Sektion (nicht im Overlay-Modus) ───────── */}
      {mode !== 'overlay' && (
      <section className="card-form" style={{ marginTop: 18 }}>
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
          <MultiPhotoUpload
            kundeId={kunde?.id}
            onUploaded={(rb) => {
              setPersonen(prev => [rb, ...prev]);
              if (mode === 'ki') setPersonId(rb.id); else setFotoId(rb.id);
            }}
            dropZoneClassName="ref-card ref-card-upload"
            trigger={<span>+ Foto(s) hochladen<br/><small style={{ fontSize: 10, color: 'var(--ink-3)' }}>Mehrere möglich · Drag &amp; Drop</small></span>}
          />
        </div>
      </section>
      )}

      {/* ───────── Stil-Auswahl (Vorlagen) ───────── */}
      {stilvorlagen.length > 0 && (
        <section className="card-form" style={{ marginTop: 18 }}>
          <div className="form-section-title" style={{ marginBottom: 8 }}>Stil-Vorlage</div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 2px 8px' }}>
            {stilvorlagen.map((v, i) => {
              const aktiv = stilvorlageId === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setStilvorlageId(v.id)}
                  title={v.beschreibung || v.name}
                  style={{
                    position: 'relative',
                    flex: '0 0 180px',
                    border: aktiv ? '2px solid var(--accent, #16a34a)' : '1px solid var(--line)',
                    borderRadius: 10,
                    background: aktiv ? '#f0fdf4' : '#fff',
                    padding: 0, cursor: 'pointer',
                    textAlign: 'left', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                  }}
                >
                  <div style={{
                    aspectRatio: '1/1', background: '#f4f3f0', position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#9a9994', fontSize: 32,
                  }}>
                    {v.vorschau_url
                      ? <img src={v.vorschau_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : '🎨'}
                    {v.vorschau_url && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStilLightboxIndex(i); }}
                        title="Vorschau in Groß-Ansicht öffnen"
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          background: 'rgba(0,0,0,0.65)', color: '#fff',
                          border: 'none', borderRadius: 100, cursor: 'pointer',
                          width: 28, height: 28, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 14,
                        }}
                      >🔍</button>
                    )}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
                    {v.beschreibung && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {v.beschreibung}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
              disabled={generating || (mode === 'ki' ? !motiv : mode === 'foto' ? !fotoId : !spruch.trim())}
            >
              {generating
                ? (mode === 'overlay' ? `Rendere ${expected} Overlays…` : `Generiere ${expected} Bilder…`)
                : (mode === 'overlay' ? 'Overlays rendern' : 'Creatives generieren')}
            </button>
          </div>
        </div>
        {generateError && <div className="alert alert-error" style={{ marginTop: 12 }}>{generateError}</div>}
      </section>

      {/* ───────── Galerie ───────── */}
      <section style={{ marginTop: 24 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">{showArchived ? 'Archiv' : 'Galerie'}</h2>
            <p className="section-sub">
              {creatives.length} {showArchived ? 'archivierte' : 'aktive'} Creative{creatives.length === 1 ? '' : 's'} für dieses Projekt.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn-ghost btn-sm"
              onClick={async () => {
                if (!confirm('Creative-Auftrag jetzt an Laura + info@nowagwirth.de schicken?\n\nDie Mail enthält Kunde, Stelle, Briefing (Benefits, USP), Foto-Status und den Link zum Creatives-Tab.')) return;
                try {
                  await api(`/jobs/${job.id}/send-creative-auftrag`, { method: 'POST' });
                  alert('✓ Creative-Auftrag verschickt.');
                } catch (err) { alert('Fehler: ' + err.message); }
              }}
              title="Reiche Team-Mail mit Briefing an laura.mueller + info@nowagwirth.de"
            >
              📧 Creative-Auftrag an Team senden
            </button>
            <button
              className={`btn-ghost btn-sm ${showArchived ? 'is-active' : ''}`}
              onClick={() => setShowArchived(v => !v)}
              title="Archivierte Creatives anzeigen (wiederherstellbar)"
            >
              {showArchived ? '← Zurück zur Galerie' : '📦 Archiv anzeigen'}
            </button>
            {!showArchived && (
              <button className="btn-ghost btn-sm" onClick={() => setShowCreativeUpload(true)} title="Eigene Bilder/Videos hochladen">
                <Icon name="plus" /> Fertiges Creative hochladen
              </button>
            )}
          </div>
        </div>
        {loadingGalerie && <div className="card empty">Lade Galerie…</div>}
        {!loadingGalerie && creatives.length === 0 && (
          <div className="card empty">
            <h2>Noch keine Creatives</h2>
            <p>Wähle oben einen Modus und klick auf „Creatives generieren" — oder lade rechts oben fertige Anzeigen hoch.</p>
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
                  ) : c.typ === 'overlay' ? (
                    // Schachbrett-Hintergrund macht die Transparenz sofort sichtbar.
                    <div style={{
                      width: '100%', height: '100%',
                      backgroundImage: 'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)',
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
                      backgroundColor: '#f5f5f5',
                    }}>
                      <img src={c.bild_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  ) : (
                    <img src={c.bild_url} alt="" loading="lazy" />
                  )}
                  <span className={`format-badge format-${c.format}`}>
                    {c.typ === 'video' ? 'REEL' : (c.format === 'story' ? '9:16' : c.format === 'sonstiges' ? '?' : '1:1')}
                  </span>
                  {c.typ === 'overlay' && (
                    <span style={{ position: 'absolute', top: 8, left: 8, background: '#0a0a0a', color: '#d4ff00', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.05, textTransform: 'uppercase' }}>
                      📐 Overlay
                    </span>
                  )}
                  {c.quelle === 'upload' && (
                    <span className="creative-upload-badge" title="Manuell hochgeladen">⬆ Hochgeladen</span>
                  )}
                  {(reviewKommentare[`creative_${c.id}`] || '').trim() && (
                    <span className="creative-feedback-badge" title="Kunde hat einen Änderungswunsch hinterlassen">📝 Änderungswunsch</span>
                  )}
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
                {(() => {
                  const kommentar = (reviewKommentare[`creative_${c.id}`] || '').trim();
                  if (!kommentar) return null;
                  return (
                    <div className="creative-kommentar" title="Kundenkommentar aus Review">
                      <div className="creative-kommentar-head">📝 Änderungswunsch vom Kunden</div>
                      <div className="creative-kommentar-body">{kommentar}</div>
                    </div>
                  );
                })()}
                <div className="creative-foot">
                  <span className="creative-date">{new Date(c.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <div className="creative-actions">
                    {c.typ !== 'video' && c.quelle !== 'upload' && (
                      <button className="btn-ghost btn-sm" onClick={() => openRework(c)}>Überarbeiten</button>
                    )}
                    {c.typ !== 'video' && c.bild_ohne_logo_url && kunde?.logo_url && (
                      <button className="btn-ghost btn-sm" onClick={() => setLogoPosTarget(c)}>Logo anpassen</button>
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
                    {showArchived ? (
                      <>
                        <button className="btn-ghost btn-sm" onClick={() => onRestore(c.id)}>Wiederherstellen</button>
                        <button className="btn-ghost btn-sm btn-danger" onClick={() => onDeleteForever(c.id)}>Endgültig löschen</button>
                      </>
                    ) : (
                      <button className="btn-ghost btn-sm btn-danger" onClick={() => onArchive(c.id)}>Archivieren</button>
                    )}
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

        {stilLightboxIndex !== null && stilvorlagen.some(v => v.vorschau_url) && (() => {
          const items = stilvorlagen.filter(v => v.vorschau_url).map(v => ({
            id: v.id, bild_url: v.vorschau_url, format: 'quadrat', typ: 'foto',
            created_at: v.updated_at || v.created_at, name: v.name,
          }));
          const clamped = Math.max(0, Math.min(stilLightboxIndex, items.length - 1));
          return (
            <Lightbox
              items={items}
              index={clamped}
              onClose={() => setStilLightboxIndex(null)}
              onNavigate={setStilLightboxIndex}
              filenameFor={v => `stil-${(v.name || 'vorlage').replace(/[^\w-]+/g, '-')}.png`}
            />
          );
        })()}
      </section>

      {/* ───────── Rework-Modal ───────── */}
      <Modal
        open={!!reworkTarget}
        onClose={cancelRework}
        title="Creative überarbeiten"
        footer={
          <>
            <button className="btn-ghost" onClick={cancelRework}>
              {reworkBusy ? 'Abbrechen' : 'Schließen'}
            </button>
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

      {/* ───────── Upload-Modal: fertige Creatives hochladen ───────── */}
      <UploadCreativesModal
        open={showCreativeUpload}
        onClose={() => setShowCreativeUpload(false)}
        jobId={job.id}
        onUploaded={(c) => setCreatives(prev => [c, ...prev])}
      />

      {/* ───────── Logo-Positions-Modal ───────── */}
      <LogoPositionModal
        open={!!logoPosTarget}
        creative={logoPosTarget}
        logoUrl={kunde?.logo_url}
        onClose={() => setLogoPosTarget(null)}
        onSaved={(updated) => setCreatives(prev => prev.map(c => c.id === updated.id ? updated : c))}
      />
    </div>
  );
}
