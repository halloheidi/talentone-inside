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

  // Neukundengewinnung: kein interner Funnel-Builder — externe Landingpage
  // (onepage.io o. Ä.) + Webhook + interne Anfragen-Liste.
  if (job?.projekttyp === 'neukundengewinnung') {
    return <NeukundenFunnelTab job={job} kunde={kunde} />;
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

/* ═════════════════════ Neukunden-Funnel-Tab ═════════════════════ */
const STATUS_LABEL_NK = { neu: '🆕 Neu', kontaktiert: '📞 Kontaktiert', termin: '📅 Termin', gewonnen: '✅ Gewonnen', verloren: '❌ Verloren' };

function NeukundenFunnelTab({ job, kunde }) {
  const nk = job.neukunden_daten || {};
  const [funnelUrl, setFunnelUrl] = useState(nk.funnel_url || '');
  const [funnelBusy, setFunnelBusy] = useState(false);
  const [funnelMsg, setFunnelMsg] = useState('');
  const [anfragenToken, setAnfragenToken] = useState(job.anfragen_token || '');
  const [anfragen, setAnfragen] = useState([]);
  const [loadingAnfragen, setLoadingAnfragen] = useState(true);

  useEffect(() => {
    if (!anfragenToken) {
      api(`/anfragen/token/ensure/${job.id}`, { method: 'POST' })
        .then(r => setAnfragenToken(r.token || ''))
        .catch(() => {});
    }
    api(`/anfragen?job_id=${job.id}`)
      .then(r => setAnfragen(r.anfragen || []))
      .catch(() => {})
      .finally(() => setLoadingAnfragen(false));
    // eslint-disable-next-line
  }, [job.id]);

  const apiBase = getApiBaseUrl();
  const webhookUrl = `${apiBase}/api/webhooks/leads?job_id=${job.id}`;
  const brandBase = getBrandBaseUrl(kunde?.agentur);
  const anfragenListUrl = anfragenToken ? `${brandBase}/anfragen/${anfragenToken}` : null;

  async function saveFunnelUrl() {
    setFunnelBusy(true); setFunnelMsg('');
    try {
      await api(`/jobs/${job.id}`, { method: 'PATCH', body: { neukunden_daten: { ...nk, funnel_url: funnelUrl.trim() } } });
      setFunnelMsg('Gespeichert.');
    } catch (err) { setFunnelMsg('Fehler: ' + err.message); }
    finally { setFunnelBusy(false); }
  }

  async function refreshAnfragen() {
    setLoadingAnfragen(true);
    try { const r = await api(`/anfragen?job_id=${job.id}`); setAnfragen(r.anfragen || []); }
    finally { setLoadingAnfragen(false); }
  }

  async function updateAnfrage(id, patch) {
    setAnfragen(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
    try { await api(`/anfragen/${id}`, { method: 'PATCH', body: patch }); }
    catch (err) { alert('Speichern fehlgeschlagen: ' + err.message); refreshAnfragen(); }
  }

  function copyToClipboard(text) { navigator.clipboard.writeText(text).catch(() => {}); }

  return (
    <div style={{ display: 'grid', gap: 18, padding: '4px 0' }}>
      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Externe Landingpage (onepage.io o. Ä.)</h3>
        <p className="pane-hint" style={{ marginTop: 0 }}>Die URL, die in Ads / Ad-Copies verlinkt wird.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="url" value={funnelUrl} onChange={e => setFunnelUrl(e.target.value)}
            placeholder="https://landingpage.example.com"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
          <button className="btn-primary btn-sm" onClick={saveFunnelUrl} disabled={funnelBusy}>Speichern</button>
        </div>
        {funnelMsg && <div className="motiv-sub" style={{ marginTop: 6 }}>{funnelMsg}</div>}
      </section>

      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Webhook-URL für die Landingpage</h3>
        <p className="pane-hint" style={{ marginTop: 0 }}>
          In onepage.io als „Webhook / Zapier-URL" hinterlegen. Jede Anfrage POST hierher → landet in der Liste und geht als Mail an den Kunden.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>{webhookUrl}</code>
          <button className="btn-ghost btn-sm" onClick={() => copyToClipboard(webhookUrl)}>Kopieren</button>
        </div>
        <details style={{ marginTop: 12, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>So richtest du das in onepage.io ein</summary>
          <ol style={{ marginTop: 8, paddingLeft: 20, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            <li>Formular-Block bearbeiten → „Integrationen / Nach Absenden" → „Webhook"</li>
            <li>URL einfügen, Method POST, Content-Type application/json</li>
            <li>Alle Formularfelder als Payload weitergeben — Name/E-Mail/Telefon werden automatisch erkannt</li>
            <li>Testen: eine Test-Anfrage abschicken → sollte sofort in der Liste erscheinen</li>
          </ol>
        </details>
      </section>

      {anfragenListUrl && (
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Anfragen-Link für den Kunden</h3>
          <p className="pane-hint" style={{ marginTop: 0 }}>Weitergeben — der Kunde sieht alle Anfragen in Echtzeit.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>{anfragenListUrl}</code>
            <button className="btn-ghost btn-sm" onClick={() => copyToClipboard(anfragenListUrl)}>Kopieren</button>
            <a className="btn-ghost btn-sm" href={anfragenListUrl} target="_blank" rel="noreferrer">Öffnen</a>
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <div>
            <h2 className="section-title">Anfragen ({anfragen.length})</h2>
            <p className="section-sub">Eingegangene Kundenanfragen — Status + Notiz editierbar.</p>
          </div>
          <button className="btn-ghost btn-sm" onClick={refreshAnfragen} disabled={loadingAnfragen}>
            {loadingAnfragen ? 'Lade…' : '↻ Aktualisieren'}
          </button>
        </div>
        {loadingAnfragen && anfragen.length === 0 ? (
          <div className="card empty">Lade Anfragen…</div>
        ) : anfragen.length === 0 ? (
          <div className="card empty">
            <h2>Noch keine Anfragen</h2>
            <p>Sobald über den Webhook oben eine Anfrage eingeht, taucht sie hier auf.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ margin: 0, width: '100%' }}>
                <thead>
                  <tr><th>Datum</th><th>Name</th><th>Kontakt</th><th>Weitere Felder</th><th>Status</th><th>Notizen</th></tr>
                </thead>
                <tbody>
                  {anfragen.map(a => (
                    <tr key={a.id} style={{ opacity: a.status === 'verloren' ? 0.55 : 1 }}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td><strong>{a.name || '—'}</strong></td>
                      <td style={{ fontSize: 12 }}>
                        {a.email  && <div><a href={`mailto:${a.email}`}>{a.email}</a></div>}
                        {a.telefon && <div><a href={`tel:${a.telefon}`}>{a.telefon}</a></div>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {Object.entries(a.daten || {}).slice(0, 4).map(([k, v]) => (
                          <div key={k}><strong>{k}:</strong> {String(v).slice(0, 60)}</div>
                        ))}
                      </td>
                      <td>
                        <select value={a.status} onChange={e => updateAnfrage(a.id, { status: e.target.value })}
                          style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}>
                          {Object.entries(STATUS_LABEL_NK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td>
                        <textarea rows={2} defaultValue={a.notizen || ''}
                          onBlur={e => e.target.value !== (a.notizen || '') && updateAnfrage(a.id, { notizen: e.target.value || null })}
                          placeholder="Notiz…"
                          style={{ width: 200, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, resize: 'vertical' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
