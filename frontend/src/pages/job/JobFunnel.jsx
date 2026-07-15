import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import FunnelView from '../../components/FunnelView.jsx';
import Modal from '../../components/Modal.jsx';
import CropModal from '../../components/CropModal.jsx';
import BewerbungenTable from '../../components/BewerbungenTable.jsx';
import { getBrandBaseUrl, getApiBaseUrl } from '../../lib/branding.js';

const TYPE_META = {
  intro:    { label: 'Startseite',  icon: '👋', removable: false },
  benefits: { label: 'Vorteile',    icon: '🎁', removable: true },
  tasks:    { label: 'Aufgaben',    icon: '🛠️', removable: true },
  question: { label: 'Frage',       icon: '❓', removable: true },
  contact:  { label: 'Kontakt',     icon: '📩', removable: false },
};

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function newScreen(type) {
  switch (type) {
    case 'question':
      return { id: uid(), type, text: 'Neue Frage', options: [{ text: 'Option 1' }, { text: 'Option 2' }], image_url: null };
    case 'benefits':
      return { id: uid(), type, headline: 'Das erwartet dich bei uns', body: '', quote: '', benefits: [], next_button: 'Weiter →', image_url: null };
    case 'tasks':
      return { id: uid(), type, headline: 'Deine Aufgaben', intro: '', aufgaben: [], next_button: 'Jetzt bewerben →', image_url: null };
    default:
      return { id: uid(), type, headline: '', body: '', image_url: null };
  }
}

// Normalisiert Optionen — String oder Object → immer Object
function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map(o => typeof o === 'string' ? { text: o } : (o || { text: '' }));
}

export default function JobFunnel() {
  const { job, kunde, reload } = useJob();
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenzen, setReferenzen] = useState([]);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [genBusy, setGenBusy] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [pickerOpen, setPickerOpen] = useState(null); // screenId
  const [cropping, setCropping] = useState(null); // { sourceUrl, screenId }
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Editor-State
  const [screens, setScreens] = useState([]);
  const [activeScreenId, setActiveScreenId] = useState(null);
  const [pixelId, setPixelId] = useState('');
  const [capiAccessToken, setCapiAccessToken] = useState('');
  const [conversionZiel, setConversionZiel] = useState('');
  const [veroeffentlicht, setVeroeffentlicht] = useState(false);
  const [extern, setExtern] = useState(false);
  const [externUrl, setExternUrl] = useState('');
  const [externSheetUrl, setExternSheetUrl] = useState('');
  const [bewerbungEmail, setBewerbungEmail] = useState('');

  function loadAll() {
    setLoading(true);
    Promise.all([
      api(`/funnels?job_id=${job.id}`),
      api(`/kunden/${kunde.id}/referenzbilder`).catch(() => ({ referenzbilder: [] })),
    ])
      .then(async ([f, r]) => {
        let funnelData = f.funnel;
        // Auto-generate Initial-Screens beim ersten Öffnen
        if (!Array.isArray(funnelData.screens) || funnelData.screens.length === 0) {
          setInitBusy(true);
          try {
            const init = await api(`/funnels/${funnelData.id}/initial-screens`, { method: 'POST' });
            funnelData = { ...funnelData, screens: init.screens };
          } catch (err) {
            setError(`Initial-Generierung: ${err.message}`);
          } finally {
            setInitBusy(false);
          }
        }
        setFunnel(funnelData);
        // Screens laden + Optionen normalisieren (String → Object)
        const rawScreens = Array.isArray(funnelData.screens) ? funnelData.screens : [];
        const normalizedScreens = rawScreens.map(s => s.type === 'question'
          ? { ...s, options: normalizeOptions(s.options) }
          : s);
        setScreens(normalizedScreens);
        setPixelId(funnelData.pixel_id || '');
        setCapiAccessToken(funnelData.capi_access_token || '');
        setConversionZiel(funnelData.conversion_ziel || 'Bewerbung einreichen');
        setVeroeffentlicht(!!funnelData.veroeffentlicht);
        setExtern(!!funnelData.extern);
        setExternUrl(funnelData.extern_url || '');
        setExternSheetUrl(funnelData.extern_sheet_url || '');
        setBewerbungEmail(job?.bewerbung_email || '');
        setReferenzen((r.referenzbilder || []).filter(x => x.typ === 'foto'));
        // Default: Startseite ausgewählt
        if (Array.isArray(funnelData.screens) && funnelData.screens[0]) {
          setActiveScreenId(funnelData.screens[0].id);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [job.id]);

  /* ───── Kundenkommentar aus Review (Funnel + allgemein) ───── */
  const [reviewFunnelKommentar, setReviewFunnelKommentar] = useState('');
  const [reviewAllgemeinKommentar, setReviewAllgemeinKommentar] = useState('');
  useEffect(() => {
    let cancelled = false;
    api(`/jobs/${job.id}/export/review`)
      .then(res => {
        if (cancelled) return;
        const k = res.review?.kommentare;
        if (k && typeof k === 'object') {
          setReviewFunnelKommentar((k['funnel'] || '').trim());
          setReviewAllgemeinKommentar((k['general'] || k['allgemein'] || '').trim());
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.id]);

  const activeIndex = screens.findIndex(s => s.id === activeScreenId);
  const activeScreen = activeIndex >= 0 ? screens[activeIndex] : null;

  function patchActive(patch) {
    setScreens(prev => prev.map(s => s.id === activeScreenId ? { ...s, ...patch } : s));
  }

  /* ───── Screen-Operationen ───── */
  function moveScreen(id, dir) {
    const idx = screens.findIndex(s => s.id === id);
    const next = idx + dir;
    if (next < 0 || next >= screens.length) return;
    const arr = [...screens];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setScreens(arr);
  }
  function removeScreen(id) {
    const s = screens.find(x => x.id === id);
    if (!s || !TYPE_META[s.type]?.removable) return;
    if (!confirm('Screen löschen?')) return;
    setScreens(prev => prev.filter(x => x.id !== id));
    if (activeScreenId === id) setActiveScreenId(screens[0]?.id || null);
  }
  function addScreen(type) {
    const screen = newScreen(type);
    // Question und Info-Screens vor dem contact einfügen, sonst am Ende
    const contactIdx = screens.findIndex(s => s.type === 'contact');
    const insertAt = contactIdx >= 0 ? contactIdx : screens.length;
    const arr = [...screens];
    arr.splice(insertAt, 0, screen);
    setScreens(arr);
    setActiveScreenId(screen.id);
  }

  /* ───── Bilder ───── */
  async function generateImage(format) {
    setGenBusy(true);
    setError('');
    try {
      const res = await api(`/funnels/${funnel.id}/bild-generieren`, {
        method: 'POST', body: { format },
      });
      const newImg = { url: res.url, format, ts: Date.now() };
      setGeneratedImages(prev => [newImg, ...prev]);
      // Bei offenem Picker direkt ins Crop-Tool springen
      if (pickerOpen) {
        const screenId = pickerOpen;
        setPickerOpen(null);
        setCropping({ sourceUrl: res.url, screenId });
      }
    } catch (err) { setError(err.message); }
    finally { setGenBusy(false); }
  }

  // Bild aus Picker → öffnet Crop-Modal (auf 16:9)
  function pickImage(url) {
    if (!pickerOpen) return;
    const screenId = pickerOpen;
    setPickerOpen(null);
    setCropping({ sourceUrl: url, screenId });
  }

  async function confirmCrop(croppedAreaPixels) {
    if (!cropping) return;
    const res = await api(`/funnels/${funnel.id}/crop-image`, {
      method: 'POST',
      body: { source_url: cropping.sourceUrl, crop: croppedAreaPixels },
    });
    setScreens(prev => prev.map(s => s.id === cropping.screenId ? { ...s, image_url: res.url } : s));
    setCropping(null);
  }

  function clearImage(screenId) {
    setScreens(prev => prev.map(s => s.id === screenId ? { ...s, image_url: null } : s));
  }

  /* ───── Save + Publish ───── */
  async function save(extra = {}) {
    setSaveBusy(true); setSaveMsg('');
    try {
      const body = {
        screens,
        pixel_id: pixelId.trim() || null,
        capi_access_token: capiAccessToken.trim() || null,
        conversion_ziel: conversionZiel.trim() || null,
        extern,
        extern_url: externUrl.trim() || null,
        extern_sheet_url: externSheetUrl.trim() || null,
        ...extra,
      };
      const res = await api(`/funnels/${funnel.id}`, { method: 'PATCH', body });
      setFunnel(res.funnel);
      setVeroeffentlicht(!!res.funnel.veroeffentlicht);

      // Job-Empfänger separat speichern (nur wenn geändert)
      const desiredEmail = bewerbungEmail.trim() || null;
      if (desiredEmail !== (job?.bewerbung_email || null)) {
        await api(`/jobs/${job.id}`, { method: 'PATCH', body: { bewerbung_email: desiredEmail } });
        reload?.();
      }

      setSaveMsg('Gespeichert.');
      setTimeout(() => setSaveMsg(''), 1800);
    } catch (err) { setSaveMsg(err.message); }
    finally { setSaveBusy(false); }
  }
  async function togglePublish() {
    if (!veroeffentlicht && screens.filter(s => s.type === 'question').length === 0) {
      if (!confirm('Funnel hat keine Qualifizierungsfragen. Trotzdem veröffentlichen?')) return;
    }
    await save({ veroeffentlicht: !veroeffentlicht });
  }

  if (loading || initBusy) {
    return <div className="card empty">{initBusy ? 'KI generiert die Funnel-Texte… (~10–20 Sekunden)' : 'Lade Funnel…'}</div>;
  }
  if (!funnel) return <div className="alert alert-error">{error || 'Funnel nicht gefunden.'}</div>;

  const brandBase = getBrandBaseUrl(kunde?.agentur);
  const internalUrl = `${brandBase}/f/${funnel.id}`;
  const funnelUrl = extern && externUrl.trim() ? externUrl.trim() : internalUrl;
  const previewFunnel = { ...funnel, screens, conversion_ziel: conversionZiel };

  const allImages = [
    ...generatedImages.map(g => ({ id: `g-${g.ts}`, bild_url: g.url, source: 'KI' })),
    ...referenzen.map(r => ({ id: r.id, bild_url: r.bild_url, source: r.uploaded_via === 'kunde' ? 'Kunde' : 'Mitarbeiter' })),
  ];

  return (
    <div className="funnel-editor">
      {(reviewFunnelKommentar || reviewAllgemeinKommentar) && (
        <div className="creative-kommentar" style={{ marginBottom: 16 }}>
          <div className="creative-kommentar-head">📝 Änderungswunsch vom Kunden zum Funnel</div>
          {reviewFunnelKommentar && <div className="creative-kommentar-body">{reviewFunnelKommentar}</div>}
          {reviewAllgemeinKommentar && (
            <div className="creative-kommentar-body" style={{ marginTop: 6, fontStyle: 'italic' }}>
              <strong>Allgemein:</strong> {reviewAllgemeinKommentar}
            </div>
          )}
        </div>
      )}

      <PerspectiveSection job={job} kunde={kunde} />

      {/* Toggle: Eigener vs. externer Funnel */}
      <div className="funnel-mode-toggle">
        <button
          type="button"
          className={`funnel-mode-btn ${!extern ? 'is-active' : ''}`}
          onClick={() => setExtern(false)}
          disabled={extern && externUrl.trim().length > 0}
          title={extern && externUrl.trim() ? 'Externe URL erst entfernen, um zurück zum eigenen Funnel zu wechseln' : ''}
        >
          🛠 Eigenen Funnel verwenden
        </button>
        <button
          type="button"
          className={`funnel-mode-btn ${extern ? 'is-active' : ''}`}
          onClick={() => setExtern(true)}
        >
          🔗 Externen Funnel verwenden
        </button>
      </div>

      {extern && (
        <fieldset className="formular-section">
          <legend>Externer Funnel</legend>
          <p className="pane-hint">Wenn ihr einen externen Funnel-Builder nutzt (Perspective, Heyflow o.ä.), trag die URLs hier ein. Der interne Editor unten ist dann deaktiviert.</p>
          <div className="form-grid">
            <label className="field field-full">
              <span>Externe Funnel-URL *</span>
              <input type="url" placeholder="https://app.perspective.co/…" value={externUrl} onChange={e => setExternUrl(e.target.value)} />
            </label>
            <label className="field field-full">
              <span>Google Sheet URL der Bewerber (optional)</span>
              <input type="url" placeholder="https://docs.google.com/spreadsheets/…" value={externSheetUrl} onChange={e => setExternSheetUrl(e.target.value)} />
            </label>
          </div>

          <WebhookInfo jobId={job.id} />
        </fieldset>
      )}

      {/* Telefonische Vorqualifizierung */}
      <VorqualifizierungSection job={job} reload={reload} />


      {/* Empfänger der Bewerbungs-Mails */}
      <fieldset className="formular-section">
        <legend>Bewerbungen senden an</legend>
        <p className="pane-hint" style={{ marginBottom: 10 }}>
          E-Mail-Adresse(n), an die neue Bewerbungen verschickt werden. Standard ist die Kunden-E-Mail
          {kunde?.email ? <> (<code>{kunde.email}</code>)</> : null} — pro Stelle überschreibbar.
          Mehrere Empfänger mit <code>;</code> oder <code>,</code> trennen.
        </p>
        <div className="form-grid">
          <label className="field field-full">
            <span>E-Mail-Empfänger</span>
            <input
              type="text"
              value={bewerbungEmail}
              onChange={e => setBewerbungEmail(e.target.value)}
              placeholder={kunde?.email ? `${kunde.email}; chef@firma.de` : 'name@firma.de; chef@firma.de'}
            />
          </label>
        </div>
      </fieldset>

      {/* Publish-Card */}
      <div className="funnel-publish-card">
        <div className="funnel-publish-status">
          <span className={`funnel-status-dot ${(veroeffentlicht || extern) ? 'is-live' : ''}`} />
          <strong>{extern ? 'Extern' : (veroeffentlicht ? 'Live' : 'Entwurf')}</strong>
          {((veroeffentlicht && !extern) || (extern && externUrl.trim()))
            ? <a href={funnelUrl} target="_blank" rel="noreferrer" className="funnel-url-link">{funnelUrl}</a>
            : <span className="funnel-url-link funnel-url-disabled">{funnelUrl}</span>}
        </div>
        <div className="funnel-publish-actions">
          <button className="btn-ghost btn-sm" onClick={() => save()} disabled={saveBusy}>
            {saveBusy ? 'Speichere…' : 'Speichern'}
          </button>
          {!extern && (
            <button className={veroeffentlicht ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'} onClick={togglePublish}>
              {veroeffentlicht ? 'Offline nehmen' : 'Veröffentlichen'}
            </button>
          )}
          {saveMsg && <span className="form-msg">{saveMsg}</span>}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className={`funnel-editor-cols ${extern && externUrl.trim() ? 'is-extern-active' : ''}`}>
        {/* ───────── Linke Spalte: Screen-Liste + Detail-Editor ───────── */}
        <div className="funnel-editor-left">

          <fieldset className="formular-section screens-section">
            <legend>Screens ({screens.length})</legend>
            <div className="screen-list">
              {screens.map((s, i) => {
                const meta = TYPE_META[s.type] || { label: s.type, icon: '·', removable: true };
                const title = s.headline || s.text || meta.label;
                const isActive = s.id === activeScreenId;
                return (
                  <div key={s.id} className={`screen-row ${isActive ? 'is-active' : ''}`}>
                    <button type="button" className="screen-row-main" onClick={() => setActiveScreenId(s.id)}>
                      <span className="screen-row-num">{i + 1}</span>
                      <div className="screen-row-thumb">
                        {s.image_url
                          ? <img src={s.image_url} alt="" />
                          : <span>{meta.icon}</span>}
                      </div>
                      <div className="screen-row-text">
                        <span className="screen-row-type">{meta.icon} {meta.label}</span>
                        <span className="screen-row-title">{title || <em>—</em>}</span>
                      </div>
                    </button>
                    <div className="screen-row-actions">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => moveScreen(s.id, -1)} disabled={i === 0}>↑</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => moveScreen(s.id, 1)} disabled={i === screens.length - 1}>↓</button>
                      {meta.removable && (
                        <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => removeScreen(s.id)}>×</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="screen-add">
              <span>+ Screen hinzufügen:</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => addScreen('question')}>Frage</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => addScreen('benefits')}>Vorteile</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => addScreen('tasks')}>Aufgaben</button>
            </div>
          </fieldset>

          {/* Detail-Editor des aktiven Screens — nur bei internem Funnel */}
          {activeScreen && !(extern && externUrl.trim()) && <ScreenEditor
            screen={activeScreen}
            patch={patchActive}
            onPickImage={() => setPickerOpen(activeScreen.id)}
            onClearImage={() => clearImage(activeScreen.id)}
          />}

          {/* Tracking — nur bei internem Funnel (extern → Tracking läuft direkt in Perspective o.ä.) */}
          {!extern && (
          <fieldset className="formular-section">
            <legend>Tracking-Pixel</legend>
            <p className="pane-hint" style={{ marginBottom: 12 }}>
              Der Pixel wird auf <strong>allen Funnel-Seiten</strong> geladen und feuert automatisch ein <code>PageView</code>.
              Das ausgewählte Conversion-Event wird ausgelöst, sobald der Bewerber auf der letzten Seite seine Kontaktdaten abschickt.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Meta Pixel ID</span>
                <input type="text" value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="123456789012345" />
              </label>
              <label className="field">
                <span>Conversion-Event</span>
                <select value={conversionZiel} onChange={e => setConversionZiel(e.target.value)}>
                  <option value="Bewerbung einreichen">Bewerbung einreichen</option>
                  <option value="Lead">Lead (Standard-Event)</option>
                  <option value="CompleteRegistration">CompleteRegistration (Standard-Event)</option>
                  <option value="SubmitApplication">SubmitApplication (Standard-Event)</option>
                </select>
              </label>
              <label className="field field-full">
                <span>Conversion API Access Token (optional)</span>
                <input type="text" value={capiAccessToken} onChange={e => setCapiAccessToken(e.target.value)} placeholder="EAAxxxxxxxxxxxxxxxxxxx" />
              </label>
            </div>
            <p className="pane-hint" style={{ marginTop: 8 }}>
              💡 Für zuverlässigeres Tracking empfehlen wir die <strong>Conversion API</strong> zusätzlich zum Pixel — sie umgeht Ad-Blocker und iOS-14-Tracking-Schutz. Token aus dem Meta Events Manager → Pixel → Einstellungen → „Token für die Conversions API erstellen".
            </p>
          </fieldset>
          )}
        </div>

        {/* ───────── Rechte Spalte: Live-Vorschau ───────── */}
        <aside className="funnel-editor-right">
          <div className="funnel-preview-head">
            <strong>Vorschau · Screen {activeIndex + 1}/{screens.length}</strong>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPreviewModalOpen(true)}>Groß öffnen</button>
          </div>
          <div className="funnel-preview-stage">
            <FunnelView
              key={activeScreenId + '-' + (activeScreen?.image_url || '')}
              funnel={previewFunnel} job={job} kunde={kunde}
              frame="phone" readonly
              jumpToIndex={activeIndex}
            />
          </div>
        </aside>
      </div>

      {/* Bewerbungen — eigener Full-Width-Container damit die Tabelle mit
          horizontalem Scroll nicht das 2-Spalten-Layout darüber sprengt.
          Bei externem Funnel ausgeblendet (Tracking läuft dort extern). */}
      {!(extern && externUrl.trim()) && (
        <fieldset className="formular-section bewerbungen-section bewerbungen-fullwidth">
          <legend>Eingegangene Bewerbungen</legend>
          <BewerbungenLink jobId={job.id} token={job.bewerbungen_token} agentur={kunde?.agentur} />
          <BewerbungenTable
            job={job}
            kunde={kunde}
            internalSpalten={Array.isArray(job.interne_spalten) ? job.interne_spalten : []}
            onChangeInternalSpalten={async (next) => {
              await api(`/jobs/${job.id}`, { method: 'PATCH', body: { interne_spalten: next } });
              reload?.();
            }}
          />
        </fieldset>
      )}

      {/* Bild-Picker-Modal */}
      <Modal
        open={!!pickerOpen}
        onClose={() => setPickerOpen(null)}
        title="Bild für Screen wählen"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPickerOpen(null)}>Abbrechen</button>
            <button className="btn-primary btn-sm" onClick={() => generateImage('landscape')} disabled={genBusy}>
              {genBusy ? 'Generiere…' : '+ KI-Bild generieren (16:9-tauglich)'}
            </button>
          </>
        }
      >
        <p className="pane-hint">KI-generiertes Stimmungsbild zur Stelle (kein Text-Overlay) oder vorhandenes Personenfoto verwenden.</p>
        {allImages.length === 0 && (
          <div className="funnel-img-empty">Noch keine Bilder verfügbar — generiere eins über die Buttons unten.</div>
        )}
        <div className="funnel-img-grid">
          {allImages.map(img => (
            <button key={img.id} type="button" className="funnel-img-card" onClick={() => pickImage(img.bild_url)}>
              <img src={img.bild_url} alt="" />
              <div className="funnel-img-source">{img.source}</div>
            </button>
          ))}
        </div>
      </Modal>

      {/* Crop-Modal */}
      <CropModal
        open={!!cropping}
        imageUrl={cropping?.sourceUrl}
        onCancel={() => setCropping(null)}
        onConfirm={confirmCrop}
      />

      {/* Vorschau-Modal */}
      {previewModalOpen && (
        <div className="modal-overlay" onClick={() => setPreviewModalOpen(false)}>
          <div className="modal funnel-preview-modal" onClick={e => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Vorschau</h2>
              <button className="modal-close" onClick={() => setPreviewModalOpen(false)}>×</button>
            </header>
            <div className="modal-body" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
              <FunnelView funnel={previewFunnel} job={job} kunde={kunde} frame="phone" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════ Vorqualifizierungs-Section ═════════════════════ */

function VorqualifizierungSection({ job, reload }) {
  const felder = Array.isArray(job.vorqualifizierung_felder) ? job.vorqualifizierung_felder : [];
  const [busy, setBusy] = useState(false);
  const [showFelder, setShowFelder] = useState(felder.length > 0);
  const [newName, setNewName] = useState('');
  const [newTyp, setNewTyp] = useState('text');
  const [newOptionen, setNewOptionen] = useState('');

  async function toggleVorqual(checked) {
    await api(`/jobs/${job.id}`, { method: 'PATCH', body: { vorqualifizierung: checked } });
    reload?.();
    if (checked && felder.length === 0) {
      // Auto-trigger KI-Vorschlag
      await suggestFromAI();
    }
  }

  async function suggestFromAI() {
    setBusy(true);
    try {
      const res = await api(`/bewerbungen/job/${job.id}/vorqualifizierung-vorschlaege`, { method: 'POST' });
      await api(`/jobs/${job.id}`, { method: 'PATCH', body: { vorqualifizierung_felder: res.felder } });
      reload?.();
      setShowFelder(true);
    } catch (err) {
      alert('KI-Vorschlag fehlgeschlagen: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFelder(next) {
    await api(`/jobs/${job.id}`, { method: 'PATCH', body: { vorqualifizierung_felder: next } });
    reload?.();
  }

  async function addFeld() {
    if (!newName.trim()) return;
    const optionen = newTyp === 'dropdown'
      ? newOptionen.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const next = [...felder, { name: newName.trim(), typ: newTyp, ...(optionen ? { optionen } : {}) }];
    await saveFelder(next);
    setNewName(''); setNewTyp('text'); setNewOptionen('');
  }
  async function removeFeld(idx) {
    if (!confirm('Feld entfernen?')) return;
    await saveFelder(felder.filter((_, i) => i !== idx));
  }
  async function renameFeld(idx, name) {
    const next = felder.map((f, i) => i === idx ? { ...f, name } : f);
    await saveFelder(next);
  }

  return (
    <fieldset className="formular-section">
      <legend>Telefonische Vorqualifizierung</legend>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={!!job.vorqualifizierung}
          onChange={e => toggleVorqual(e.target.checked)}
          disabled={busy}
        />
        <span>
          <strong>Telefonische Vorqualifizierung durch uns</strong>
          <span className="pane-hint" style={{ display: 'block', marginTop: 2 }}>
            Wenn aktiviert: Bewerberliste schaltet auf Telefonisten-Ansicht — Anruf-Spalten, Status-Dropdown, Vorqualifizierungs-Felder werden inline editierbar.
          </span>
        </span>
      </label>

      {job.vorqualifizierung && (
        <div style={{ marginTop: 18 }}>
          <div className="vorqual-head">
            <strong>Vorqualifizierungs-Felder ({felder.length})</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setShowFelder(v => !v)}>
                {showFelder ? '✕ Liste schließen' : 'Felder anzeigen'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={suggestFromAI} disabled={busy}>
                {busy ? 'KI generiert…' : (felder.length === 0 ? '✨ KI-Vorschläge holen' : '✨ Neu vorschlagen')}
              </button>
            </div>
          </div>

          {felder.length === 0 && !busy && (
            <p className="pane-hint" style={{ marginTop: 8 }}>
              Noch keine Felder angelegt. Hol dir per KI passende Vorschläge basierend auf Stelle + Branche + Funnel-Fragen.
            </p>
          )}

          {showFelder && felder.length > 0 && (
            <div className="vorqual-list">
              {felder.map((f, i) => (
                <div key={i} className="vorqual-row">
                  <input
                    type="text"
                    className="vorqual-name"
                    defaultValue={f.name}
                    onBlur={e => { if (e.target.value !== f.name) renameFeld(i, e.target.value); }}
                  />
                  <span className="vorqual-typ">{f.typ}{f.typ === 'dropdown' && f.optionen ? ` (${f.optionen.length})` : ''}</span>
                  <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => removeFeld(i)}>×</button>
                </div>
              ))}
            </div>
          )}

          {showFelder && (
            <div className="vorqual-add">
              <input type="text" placeholder="Neues Feld z.B. Führerschein" value={newName} onChange={e => setNewName(e.target.value)} />
              <select value={newTyp} onChange={e => setNewTyp(e.target.value)}>
                <option value="text">Text</option>
                <option value="dropdown">Auswahl</option>
                <option value="datum">Datum</option>
              </select>
              {newTyp === 'dropdown' && (
                <input type="text" placeholder="Optionen, Komma getrennt" value={newOptionen} onChange={e => setNewOptionen(e.target.value)} />
              )}
              <button type="button" className="btn-ghost btn-sm" onClick={addFeld}>+ Hinzufügen</button>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/* ═════════════════════ Bewerbungen-Link für Kunden ═════════════════════ */

function BewerbungenLink({ token, agentur }) {
  const url = `${getBrandBaseUrl(agentur)}/bewerbungen/${token}`;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }
  if (!token) return null;
  return (
    <div className="bewerbungen-link-box">
      <div className="bewerbungen-link-title">Bewerberliste für den Kunden</div>
      <div className="bewerbungen-link-row">
        <code className="bewerbungen-link-url">{url}</code>
        <button type="button" className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓ Kopiert' : 'Kopieren'}</button>
        <a className="btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">Öffnen</a>
      </div>
      <p className="bewerbungen-link-hint">Diesen Link an den Kunden weitergeben — er zeigt alle Bewerbungen in Echtzeit. Status, Vorstellungsgespräch-Termin und Notizen kann der Kunde direkt eintragen.</p>
    </div>
  );
}

/* ═════════════════════ ScreenEditor (per Type) ═════════════════════ */

function ScreenEditor({ screen, patch, onPickImage, onClearImage }) {
  const meta = TYPE_META[screen.type] || { label: screen.type };
  return (
    <fieldset className="formular-section">
      <legend>{meta.icon} {meta.label} bearbeiten</legend>

      <div className="screen-image-row">
        <div className="screen-image-thumb">
          {screen.image_url
            ? <img src={screen.image_url} alt="" />
            : <span>kein Bild</span>}
        </div>
        <div className="screen-image-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={onPickImage}>
            {screen.image_url ? 'Bild ändern' : 'Bild zuweisen'}
          </button>
          {screen.image_url && (
            <button type="button" className="btn-ghost btn-sm" onClick={onClearImage}>Bild entfernen</button>
          )}
        </div>
      </div>

      {screen.type === 'intro' && (
        <div className="form-grid">
          <label className="field field-full">
            <span>Headline</span>
            <input value={screen.headline || ''} onChange={e => patch({ headline: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Text über das Unternehmen</span>
            <textarea rows={3} value={screen.body || ''} onChange={e => patch({ body: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Neugier-Frage</span>
            <input value={screen.teaser || ''} onChange={e => patch({ teaser: e.target.value })} />
          </label>
          <label className="field">
            <span>Button 1 (Ja)</span>
            <input value={screen.yes_button || ''} onChange={e => patch({ yes_button: e.target.value })} />
          </label>
          <label className="field">
            <span>Button 2 (mehr Infos)</span>
            <input value={screen.info_button || ''} onChange={e => patch({ info_button: e.target.value })} />
          </label>
        </div>
      )}

      {screen.type === 'benefits' && (
        <div className="form-grid">
          <label className="field field-full">
            <span>Headline</span>
            <input value={screen.headline || ''} onChange={e => patch({ headline: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Einleitung (optional)</span>
            <textarea rows={2} value={screen.body || ''} onChange={e => patch({ body: e.target.value })} />
          </label>
          <div className="field field-full">
            <span className="field-label">Benefits</span>
            <ChipsEditor
              items={Array.isArray(screen.benefits) ? screen.benefits : []}
              onChange={items => patch({ benefits: items })}
              placeholder="Benefit hinzufügen"
            />
          </div>
          <label className="field field-full">
            <span>Highlight / Zitat (optional)</span>
            <textarea rows={2} value={screen.quote || ''} onChange={e => patch({ quote: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Weiter-Button</span>
            <input value={screen.next_button || ''} onChange={e => patch({ next_button: e.target.value })} />
          </label>
        </div>
      )}

      {screen.type === 'tasks' && (
        <div className="form-grid">
          <label className="field field-full">
            <span>Headline</span>
            <input value={screen.headline || ''} onChange={e => patch({ headline: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Einleitung (optional)</span>
            <textarea rows={2} value={screen.intro || ''} onChange={e => patch({ intro: e.target.value })} />
          </label>
          <div className="field field-full">
            <span className="field-label">Aufgaben</span>
            <ChipsEditor
              items={Array.isArray(screen.aufgaben) ? screen.aufgaben : []}
              onChange={items => patch({ aufgaben: items })}
              placeholder="Aufgabe hinzufügen"
              vertical
            />
          </div>
          <label className="field field-full">
            <span>Weiter-Button</span>
            <input value={screen.next_button || ''} onChange={e => patch({ next_button: e.target.value })} />
          </label>
        </div>
      )}

      {screen.type === 'question' && (
        <div className="form-grid">
          <label className="field field-full">
            <span>Fragetext</span>
            <input value={screen.text || ''} onChange={e => patch({ text: e.target.value })} />
          </label>
          <div className="field field-full">
            <span className="field-label">Antwort-Optionen</span>
            <p className="pane-hint" style={{ margin: '0 0 8px' }}>
              Klick auf 🚩 markiert eine Antwort als <strong>KO-Kriterium</strong> — wer das wählt sieht statt des Kontaktformulars eine Absage.
            </p>
            <OptionsEditor
              options={normalizeOptions(screen.options)}
              onChange={items => patch({ options: items.slice(0, 4) })}
            />
          </div>
        </div>
      )}

      {screen.type === 'contact' && (
        <div className="form-grid">
          <label className="field field-full">
            <span>Headline</span>
            <input value={screen.headline || ''} onChange={e => patch({ headline: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Untertitel</span>
            <input value={screen.body || ''} onChange={e => patch({ body: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Submit-Button</span>
            <input value={screen.submit_button || ''} onChange={e => patch({ submit_button: e.target.value })} />
          </label>
        </div>
      )}
    </fieldset>
  );
}

/* ═════════════════════ Webhook-Info Box (Perspective) ═════════════════════ */

/* ═══════════════════════ Perspective-Integration ═══════════════════════ */
function PerspectiveSection({ job, kunde }) {
  const [funnelRow, setFunnelRow] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Vorhandenen Perspective-Funnel dieses Jobs laden
  async function load() {
    try {
      const res = await api(`/funnels?job_id=${job.id}`);
      const row = (res.funnels || []).find(f => !!f.perspective_job_id) || null;
      setFunnelRow(row);
    } catch (e) { console.warn('[perspective/load]', e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  // Polling wenn Status polling/creating
  useEffect(() => {
    if (!funnelRow?.id) return;
    if (!['polling', 'creating'].includes(funnelRow.perspective_status)) return;
    let timer;
    async function tick() {
      try {
        const res = await api(`/perspective/status/${funnelRow.id}`);
        if (res.status === 'completed') {
          await load();
          return;
        }
        if (res.status === 'error') { setErr(res.error || 'Fehler in Perspective'); await load(); return; }
      } catch (e) { /* stay polling */ }
      timer = setTimeout(tick, 8000);
    }
    timer = setTimeout(tick, 5000);
    return () => timer && clearTimeout(timer);
  }, [funnelRow?.id, funnelRow?.perspective_status]);

  async function toggleChecklist(field, value) {
    try {
      const res = await api(`/perspective/checklist/${funnelRow.id}`, { method: 'PATCH', body: { [field]: value } });
      setFunnelRow(res.funnel);
    } catch (e) { alert(e.message); }
  }

  return (
    <fieldset className="formular-section" style={{ borderColor: '#7c3aed' }}>
      <legend style={{ color: '#7c3aed', fontWeight: 700 }}>🚀 Perspective-Funnel (automatisch erstellen)</legend>
      {!funnelRow && (
        <>
          <p className="pane-hint">Perspective baut den Funnel per KI aus deinen Job-Daten. Der Funnel bleibt Draft, bis du ihn hier veröffentlichst.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>🚀 Perspective-Funnel erstellen</button>
        </>
      )}
      {funnelRow && (
        <>
          {(funnelRow.perspective_status === 'creating' || funnelRow.perspective_status === 'polling') && (
            <div style={{ padding: 14, background: '#f5f3ff', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>⏳ Funnel wird generiert…</div>
              <div style={{ fontSize: 12, color: '#5a5955' }}>Perspective braucht 3–8 Minuten. Der Status aktualisiert sich automatisch — du kannst weiterarbeiten.</div>
            </div>
          )}
          {funnelRow.perspective_status === 'error' && (
            <div style={{ padding: 14, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 12 }}>
              <strong>Fehler:</strong> {funnelRow.perspective_last_error || err || 'Unbekannt'}
              <button className="btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setShowCreate(true)}>Neu versuchen</button>
            </div>
          )}
          {funnelRow.perspective_status === 'completed' && (
            <>
              <div style={{ padding: 14, background: '#dcfce7', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>✅ Perspective-Funnel erstellt</div>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  {funnelRow.perspective_editor_url && (
                    <>Editor: <a href={funnelRow.perspective_editor_url} target="_blank" rel="noreferrer">{funnelRow.perspective_editor_url}</a></>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!funnelRow.extern_url && (
                    <button className="btn-primary btn-sm" onClick={() => setShowPublish(true)}>📤 Funnel veröffentlichen</button>
                  )}
                  <button className="btn-ghost btn-sm" onClick={() => setShowUpdate(true)}>✏️ Funnel anpassen</button>
                </div>
              </div>

              {funnelRow.extern_url && (
                <div style={{ padding: 12, background: '#eff6ff', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                  <strong>Live:</strong> <a href={funnelRow.extern_url} target="_blank" rel="noreferrer">{funnelRow.extern_url}</a>
                </div>
              )}

              <ManuellChecklist funnelRow={funnelRow} onToggle={toggleChecklist} jobId={job.id} />
            </>
          )}
        </>
      )}

      {showCreate && (
        <CreateModal
          job={job} kunde={kunde}
          onClose={() => setShowCreate(false)}
          onDone={(row) => { setFunnelRow(row); setShowCreate(false); }}
        />
      )}
      {showPublish && funnelRow && (
        <PublishModal
          funnelRow={funnelRow} kunde={kunde}
          onClose={() => setShowPublish(false)}
          onDone={(updated) => { setFunnelRow(updated); setShowPublish(false); }}
        />
      )}
      {showUpdate && funnelRow && (
        <UpdateModal
          funnelRow={funnelRow}
          onClose={() => setShowUpdate(false)}
          onDone={() => { setShowUpdate(false); load(); }}
        />
      )}
    </fieldset>
  );
}

function ManuellChecklist({ funnelRow, onToggle, jobId }) {
  const webhookUrl = `${getApiBaseUrl()}/api/webhooks/leads?job_id=${jobId}`;
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#78350f', marginBottom: 6 }}>⚠️ Noch manuell in Perspective erledigen:</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
        <input type="checkbox" checked={!!funnelRow.manual_pixel_done}
          onChange={e => onToggle('manual_pixel_done', e.target.checked)} />
        Meta Pixel + CAPI im Funnel hinterlegen
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
        <input type="checkbox" checked={!!funnelRow.manual_webhook_done}
          onChange={e => onToggle('manual_webhook_done', e.target.checked)} />
        Webhook einrichten (Event „Funnel komplettiert"):
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 24 }}>
        <code style={{ fontSize: 11, background: '#fff', padding: '3px 8px', borderRadius: 4, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{webhookUrl}</code>
        <button className="btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? '✓' : 'Kopieren'}
        </button>
      </div>
    </div>
  );
}

function CreateModal({ job, kunde, onClose, onDone }) {
  const [schema, setSchema] = useState('lang');
  const [domain, setDomain] = useState(kunde?.website_domain || kunde?.website_url || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const benefits = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];

  async function run() {
    setBusy(true); setErr('');
    try {
      const res = await api('/perspective/create', {
        method: 'POST',
        body: { job_id: job.id, schema, website_domain: domain.trim() || null },
      });
      // Nach Anlegen: erste Row-Version zurueckziehen
      const { funnels } = await api(`/funnels?job_id=${job.id}`);
      const row = (funnels || []).find(f => f.id === res.funnel_row_id) || (funnels || [])[0];
      onDone(row);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 22, width: 620, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 12px' }}>🚀 Perspective-Funnel erstellen</h2>
        <div style={{ padding: 12, background: '#fafaf8', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          <div><strong>Firma:</strong> {kunde?.firmenname}</div>
          <div><strong>Stelle:</strong> {job.stelle || '—'} · <strong>Region:</strong> {job.region || '—'}</div>
          <div><strong>Branche:</strong> {kunde?.branche || '—'}</div>
          <div><strong>Benefits:</strong> {benefits.length ? benefits.slice(0, 5).join(' · ') : '—'}</div>
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 4 }}>Kunden-Website (für Brand-Erstellung)</div>
          <input type="url" value={domain} onChange={e => setDomain(e.target.value)}
            placeholder="https://www.beispiel-firma.de"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ececea', borderRadius: 6, fontSize: 13 }} />
        </label>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 6 }}>Funnel-Schema</div>
          <label style={{ display: 'flex', gap: 8, padding: 10, border: `1px solid ${schema === 'lang' ? '#0a0a0a' : '#ececea'}`, borderRadius: 8, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" checked={schema === 'lang'} onChange={() => setSchema('lang')} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Langer Funnel (Standard)</div>
              <div style={{ fontSize: 11, color: '#5a5955' }}>Hero → Vorteile → Aufgaben → 3 Quali-Fragen → Kontakt → Danke</div>
            </div>
          </label>
          <label style={{ display: 'flex', gap: 8, padding: 10, border: `1px solid ${schema === 'kurz' ? '#0a0a0a' : '#ececea'}`, borderRadius: 8, cursor: 'pointer' }}>
            <input type="radio" checked={schema === 'kurz'} onChange={() => setSchema('kurz')} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Kurzer Funnel</div>
              <div style={{ fontSize: 11, color: '#5a5955' }}>Hero → Benefits kompakt → 1–2 Fragen → Kontakt</div>
            </div>
          </label>
        </div>

        {err && <div style={{ color: '#c1272d', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} className="btn-ghost">Abbrechen</button>
          <button onClick={run} disabled={busy || !domain.trim()} className="btn-primary">
            {busy ? '⏳ Starte…' : '🚀 Funnel erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PublishModal({ funnelRow, kunde, onClose, onDone }) {
  const [domains, setDomains] = useState(null);
  const [domainId, setDomainId] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/perspective/domains').then(r => setDomains(r.domains || [])).catch(() => setDomains([]));
    // Slug initial: firmenname-stelle (vom Backend nochmal slugified)
    const s = [kunde?.firmenname, funnelRow?.perspective_schema].filter(Boolean).join('-')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    setSlug(s);
  }, [funnelRow?.id]);

  async function run() {
    setBusy(true); setErr('');
    try {
      const res = await api('/perspective/publish', {
        method: 'POST',
        body: { funnel_row_id: funnelRow.id, domain_id: domainId || null, slug: slug.trim() },
      });
      onDone(res.funnel);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 22, width: 520, maxWidth: '100%' }}>
        <h2 style={{ margin: '0 0 12px' }}>📤 Funnel veröffentlichen</h2>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 4 }}>Domain</div>
          <select value={domainId} onChange={e => setDomainId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ececea', borderRadius: 6, fontSize: 13 }}>
            <option value="">
              {kunde?.agentur === 'talentone' ? 'jobs.talent-one.de (Standard)' : 'Perspective-Standard-Domain'}
            </option>
            {(domains || []).map(d => (
              <option key={d.id || d.name} value={d.id}>{d.name || d.domain || d.id}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', marginBottom: 4 }}>Slug (URL-Pfad)</div>
          <input value={slug} onChange={e => setSlug(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ececea', borderRadius: 6, fontSize: 13 }} />
          <div style={{ fontSize: 11, color: '#5a5955', marginTop: 4 }}>Beispiel: <code>{slug || 'firmenname-stelle'}</code></div>
        </label>

        {err && <div style={{ color: '#c1272d', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} className="btn-ghost">Abbrechen</button>
          <button onClick={run} disabled={busy || !slug.trim()} className="btn-primary">
            {busy ? '⏳ Veröffentliche…' : '📤 Veröffentlichen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateModal({ funnelRow, onClose, onDone }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run() {
    setBusy(true); setErr('');
    try {
      await api('/perspective/update', { method: 'POST', body: { funnel_row_id: funnelRow.id, prompt: prompt.trim() } });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 22, width: 520, maxWidth: '100%' }}>
        <h2 style={{ margin: '0 0 12px' }}>✏️ Funnel anpassen</h2>
        <p style={{ fontSize: 13, color: '#5a5955', marginBottom: 10 }}>Beschreibe deine Änderungen in Freitext (z.B. „Headline auf X ändern", „Frage zur Verfügbarkeit ergänzen"). Perspective erzeugt einen neuen Draft — bitte danach im Editor prüfen und neu veröffentlichen.</p>
        <textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Was soll geändert werden?"
          style={{ width: '100%', padding: 10, border: '1px solid #ececea', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />

        {err && <div style={{ color: '#c1272d', fontSize: 12, marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} disabled={busy} className="btn-ghost">Abbrechen</button>
          <button onClick={run} disabled={busy || !prompt.trim()} className="btn-primary">
            {busy ? '⏳ Aktualisiere…' : '✏️ Änderung senden'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WebhookInfo({ jobId }) {
  const webhookUrl = `${getApiBaseUrl()}/api/webhooks/perspective?job_id=${jobId}`;
  const [copied, setCopied] = useState(false);
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }
  return (
    <div className="webhook-info">
      <div className="webhook-info-title">Webhook-URL für Perspective</div>
      <div className="webhook-info-row">
        <code className="webhook-url">{webhookUrl}</code>
        <button type="button" className="btn-ghost btn-sm" onClick={copyToClipboard}>
          {copied ? '✓ Kopiert' : 'Kopieren'}
        </button>
      </div>
      <p className="webhook-info-hint">
        Diese URL in Perspective unter <strong>Integrationen → Webhook</strong> eintragen. Bei jeder neuen Bewerbung
        werden die Daten automatisch übermittelt und der Kunde benachrichtigt (Branding nach Agentur-Einstellung).
      </p>

      <details className="webhook-guide">
        <summary className="webhook-guide-summary">
          <span className="webhook-guide-icon">📖</span>
          <span>So richtest du den Webhook in Perspective ein</span>
        </summary>
        <ol className="webhook-guide-steps">
          <li>Öffne deinen Funnel in Perspective</li>
          <li>Gehe zu <strong>Integrationen → Webhooks</strong></li>
          <li>
            Unter <strong>„Funnel komplettiert"</strong> die folgende URL einfügen:
            <div className="webhook-info-row webhook-guide-url-row">
              <code className="webhook-url">{webhookUrl}</code>
              <button type="button" className="btn-ghost btn-sm" onClick={copyToClipboard}>
                {copied ? '✓ Kopiert' : 'Kopieren'}
              </button>
            </div>
          </li>
          <li>Auf <strong>„Hinzufügen"</strong> klicken</li>
          <li>Teste mit einer Test-Bewerbung — sie sollte innerhalb von Sekunden hier in der Bewerbungsliste erscheinen</li>
        </ol>

        <div className="webhook-guide-note">
          <span className="webhook-guide-note-icon">💡</span>
          <span>
            Trage die URL unter <strong>„Funnel komplettiert"</strong> ein (nicht unter <strong>„Neuer Lead"</strong>),
            damit nur vollständige Bewerbungen übermittelt werden.
          </span>
        </div>

        <p className="webhook-guide-footer">
          Nach der Einrichtung werden alle Bewerbungen aus diesem Perspective-Funnel automatisch hier angezeigt
          und der Kunde wird per Mail benachrichtigt.
        </p>
      </details>
    </div>
  );
}

/* ═════════════════════ OptionsEditor (Antworten mit KO-Flag) ═════════════════════ */

function OptionsEditor({ options = [], onChange }) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (options.length >= 4) return;
    if (options.some(o => o.text === v)) { setDraft(''); return; }
    onChange([...options, { text: v }]);
    setDraft('');
  }
  function update(i, value) {
    const arr = [...options]; arr[i] = { ...arr[i], text: value };
    onChange(arr);
  }
  function toggleKo(i) {
    const arr = [...options]; arr[i] = { ...arr[i], ko: !arr[i].ko };
    onChange(arr);
  }
  function remove(i) {
    onChange(options.filter((_, idx) => idx !== i));
  }
  return (
    <div className="chips-editor is-vertical">
      {options.map((o, i) => (
        <div key={i} className={`chip-edit-row option-row ${o.ko ? 'is-ko' : ''}`}>
          <button
            type="button"
            className={`option-ko-flag ${o.ko ? 'is-ko' : ''}`}
            onClick={() => toggleKo(i)}
            title={o.ko ? 'KO-Kriterium aktiv — Klick entfernt' : 'Als KO-Kriterium markieren'}
            aria-label="KO-Kriterium umschalten"
          >🚩</button>
          <input value={o.text} onChange={e => update(i, e.target.value)} />
          <button type="button" className="chip-x" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      {options.length < 4 && (
        <div className="chip-add">
          <input
            type="text"
            placeholder="Option hinzufügen"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={add}>Hinzufügen</button>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════ ChipsEditor (für benefits, aufgaben, options) ═════════════════════ */

function ChipsEditor({ items = [], onChange, placeholder, max, vertical }) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (max && items.length >= max) return;
    if (items.includes(v)) { setDraft(''); return; }
    onChange([...items, v]);
    setDraft('');
  }
  function update(i, value) {
    const arr = [...items]; arr[i] = value;
    onChange(arr);
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className={`chips-editor ${vertical ? 'is-vertical' : ''}`}>
      {items.map((it, i) => (
        <div key={i} className="chip-edit-row">
          <input value={it} onChange={e => update(i, e.target.value)} />
          <button type="button" className="chip-x" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      {(!max || items.length < max) && (
        <div className="chip-add">
          <input
            type="text"
            placeholder={placeholder || 'Hinzufügen'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={add}>Hinzufügen</button>
        </div>
      )}
    </div>
  );
}
