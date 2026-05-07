import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import FunnelView from '../../components/FunnelView.jsx';

const PUBLIC_BASE = (import.meta.env.VITE_PUBLIC_BASE || window.location.origin);

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

export default function JobFunnel() {
  const { job, kunde } = useJob();
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bewerbungen, setBewerbungen] = useState([]);
  const [referenzen, setReferenzen] = useState([]);
  const [generatedImages, setGeneratedImages] = useState([]); // session-only
  const [genBusy, setGenBusy] = useState(false);
  const [fragenBusy, setFragenBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const previewKey = useRef(0); // bumpen, um Vorschau zurückzusetzen

  // Editor-State (lokal, mergt mit funnel beim Save)
  const [fragen, setFragen] = useState([]);
  const [bilder, setBilder] = useState({}); // {start, frage}
  const [pixelId, setPixelId] = useState('');
  const [conversionZiel, setConversionZiel] = useState('');
  const [veroeffentlicht, setVeroeffentlicht] = useState(false);

  function loadAll() {
    setLoading(true);
    Promise.all([
      api(`/funnels?job_id=${job.id}`),
      api(`/kunden/${kunde.id}/referenzbilder`).catch(() => ({ referenzbilder: [] })),
    ])
      .then(([f, r]) => {
        setFunnel(f.funnel);
        setFragen(Array.isArray(f.funnel.fragen) ? f.funnel.fragen : []);
        setBilder(f.funnel.bilder || {});
        setPixelId(f.funnel.pixel_id || '');
        setConversionZiel(f.funnel.conversion_ziel || 'Bewerbung einreichen');
        setVeroeffentlicht(!!f.funnel.veroeffentlicht);
        setReferenzen((r.referenzbilder || []).filter(x => x.typ === 'foto'));
        // Bewerbungen laden
        if (f.funnel.id) {
          api(`/funnels/${f.funnel.id}/bewerbungen`).then(b => setBewerbungen(b.bewerbungen || [])).catch(() => {});
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [job.id]);

  /* ───── Fragen ───── */
  async function vorschlagen() {
    if (fragen.length > 0 && !confirm('Bestehende Fragen überschreiben?')) return;
    setFragenBusy(true);
    setError('');
    try {
      const res = await api(`/funnels/${funnel.id}/fragen-vorschlaege`, { method: 'POST' });
      setFragen(res.fragen || []);
    } catch (err) { setError(err.message); }
    finally { setFragenBusy(false); }
  }
  function addFrage() {
    setFragen([...fragen, { id: uid(), text: 'Neue Frage', options: ['Option 1', 'Option 2'] }]);
  }
  function removeFrage(id) {
    if (!confirm('Frage löschen?')) return;
    setFragen(fragen.filter(f => f.id !== id));
  }
  function moveFrage(id, dir) {
    const idx = fragen.findIndex(f => f.id === id);
    const next = idx + dir;
    if (next < 0 || next >= fragen.length) return;
    const arr = [...fragen];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setFragen(arr);
  }
  function patchFrage(id, patch) {
    setFragen(fragen.map(f => f.id === id ? { ...f, ...patch } : f));
  }
  function addOption(id) {
    const f = fragen.find(x => x.id === id);
    patchFrage(id, { options: [...(f.options || []), 'Neue Option'] });
  }
  function patchOption(id, i, value) {
    const f = fragen.find(x => x.id === id);
    const opts = [...(f.options || [])]; opts[i] = value;
    patchFrage(id, { options: opts });
  }
  function removeOption(id, i) {
    const f = fragen.find(x => x.id === id);
    patchFrage(id, { options: f.options.filter((_, idx) => idx !== i) });
  }

  /* ───── Bilder ───── */
  async function generateImage(format) {
    setGenBusy(true);
    setError('');
    try {
      const res = await api(`/funnels/${funnel.id}/bild-generieren`, {
        method: 'POST', body: { format },
      });
      setGeneratedImages(prev => [{ url: res.url, format, ts: Date.now() }, ...prev]);
    } catch (err) { setError(err.message); }
    finally { setGenBusy(false); }
  }
  function pickStart(url) { setBilder(b => ({ ...b, start: url })); previewKey.current++; }
  function pickFrage(url) { setBilder(b => ({ ...b, frage: url })); previewKey.current++; }
  function clearBild(slot) { setBilder(b => ({ ...b, [slot]: null })); previewKey.current++; }

  /* ───── Speichern + Veröffentlichen ───── */
  async function save(extra = {}) {
    setSaveBusy(true);
    setSaveMsg('');
    try {
      const body = {
        fragen, bilder,
        pixel_id: pixelId.trim() || null,
        conversion_ziel: conversionZiel.trim() || null,
        ...extra,
      };
      const res = await api(`/funnels/${funnel.id}`, { method: 'PATCH', body });
      setFunnel(res.funnel);
      setVeroeffentlicht(!!res.funnel.veroeffentlicht);
      setSaveMsg('Gespeichert.');
      setTimeout(() => setSaveMsg(''), 1800);
    } catch (err) { setSaveMsg(err.message); }
    finally { setSaveBusy(false); }
  }

  async function togglePublish() {
    if (!veroeffentlicht && fragen.length === 0) {
      if (!confirm('Funnel hat noch keine Fragen. Trotzdem veröffentlichen?')) return;
    }
    await save({ veroeffentlicht: !veroeffentlicht });
  }

  if (loading) return <div className="card empty">Lade Funnel…</div>;
  if (!funnel) return <div className="alert alert-error">{error || 'Funnel nicht gefunden.'}</div>;

  const funnelUrl = `${PUBLIC_BASE}/f/${funnel.id}`;
  const previewFunnel = { ...funnel, fragen, bilder, conversion_ziel: conversionZiel };

  // Verfügbare Bilder = Referenzbilder + frisch generierte
  const allImages = [
    ...generatedImages.map(g => ({ id: `g-${g.ts}`, bild_url: g.url, source: 'KI' })),
    ...referenzen.map(r => ({ id: r.id, bild_url: r.bild_url, source: r.uploaded_via === 'kunde' ? 'Kunde' : 'Mitarbeiter' })),
  ];

  return (
    <div className="funnel-editor">
      <div className="funnel-editor-cols">
        {/* ───────── Editor links ───────── */}
        <div className="funnel-editor-left">
          {/* URL + Veröffentlichen */}
          <div className="funnel-publish-card">
            <div className="funnel-publish-status">
              <span className={`funnel-status-dot ${veroeffentlicht ? 'is-live' : ''}`} />
              <strong>{veroeffentlicht ? 'Live' : 'Entwurf'}</strong>
              {veroeffentlicht
                ? <a href={funnelUrl} target="_blank" rel="noreferrer" className="funnel-url-link">{funnelUrl}</a>
                : <span className="funnel-url-link funnel-url-disabled">{funnelUrl}</span>}
            </div>
            <div className="funnel-publish-actions">
              <button className="btn-ghost btn-sm" onClick={() => save()} disabled={saveBusy}>
                {saveBusy ? 'Speichere…' : 'Speichern'}
              </button>
              <button className={veroeffentlicht ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'} onClick={togglePublish}>
                {veroeffentlicht ? 'Offline nehmen' : 'Veröffentlichen'}
              </button>
              {saveMsg && <span className="form-msg">{saveMsg}</span>}
            </div>
          </div>

          {/* Bilder */}
          <fieldset className="formular-section">
            <legend>Stimmungsbilder</legend>
            <p className="motiv-sub" style={{ marginBottom: 12 }}>
              Wähle ein Bild für die Startseite und eines für die Fragen-Screens. Personenfotos vom Kunden + KI-generierte Stimmungsbilder.
            </p>
            <div className="funnel-img-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => generateImage('square')} disabled={genBusy}>
                {genBusy ? 'Generiere…' : '+ KI-Bild generieren (1:1)'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => generateImage('portrait')} disabled={genBusy}>
                {genBusy ? 'Generiere…' : '+ KI-Bild generieren (Hochkant)'}
              </button>
            </div>
            {allImages.length === 0 ? (
              <div className="funnel-img-empty">Noch keine Bilder verfügbar — generiere eins oder lade Referenzbilder beim Kunden hoch.</div>
            ) : (
              <div className="funnel-img-grid">
                {allImages.map(img => (
                  <div key={img.id} className="funnel-img-card">
                    <img src={img.bild_url} alt="" />
                    <div className="funnel-img-source">{img.source}</div>
                    <div className="funnel-img-pick">
                      <button
                        type="button"
                        className={`btn-ghost btn-sm ${bilder.start === img.bild_url ? 'is-selected' : ''}`}
                        onClick={() => pickStart(img.bild_url)}
                      >
                        {bilder.start === img.bild_url ? '✓ Start' : 'Start'}
                      </button>
                      <button
                        type="button"
                        className={`btn-ghost btn-sm ${bilder.frage === img.bild_url ? 'is-selected' : ''}`}
                        onClick={() => pickFrage(img.bild_url)}
                      >
                        {bilder.frage === img.bild_url ? '✓ Fragen' : 'Fragen'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(bilder.start || bilder.frage) && (
              <div className="funnel-img-summary">
                Aktuelle Auswahl:
                {bilder.start && <button className="btn-ghost btn-sm" onClick={() => clearBild('start')}>Start ✕</button>}
                {bilder.frage && <button className="btn-ghost btn-sm" onClick={() => clearBild('frage')}>Fragen ✕</button>}
              </div>
            )}
          </fieldset>

          {/* Fragen */}
          <fieldset className="formular-section">
            <legend>Fragen</legend>
            <div className="funnel-fragen-actions">
              <button type="button" className="btn-primary btn-sm" onClick={vorschlagen} disabled={fragenBusy}>
                {fragenBusy ? 'Lade…' : (fragen.length ? 'Neu vorschlagen' : 'Fragen vorschlagen lassen')}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={addFrage}>+ Frage manuell</button>
            </div>
            {fragen.length === 0 && (
              <div className="motiv-sub" style={{ marginTop: 12 }}>Noch keine Fragen. Lass dir welche vorschlagen oder leg manuell an.</div>
            )}
            <div className="frage-list">
              {fragen.map((f, i) => (
                <div key={f.id} className="frage-card">
                  <div className="frage-card-head">
                    <span className="frage-num">Frage {i + 1}</span>
                    <div className="frage-card-actions">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => moveFrage(f.id, -1)} disabled={i === 0}>↑</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => moveFrage(f.id, 1)} disabled={i === fragen.length - 1}>↓</button>
                      <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => removeFrage(f.id)}>Löschen</button>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="frage-text-input"
                    value={f.text}
                    onChange={e => patchFrage(f.id, { text: e.target.value })}
                    placeholder="Fragetext"
                  />
                  <div className="frage-options">
                    {(f.options || []).map((opt, oi) => (
                      <div key={oi} className="frage-option-row">
                        <input
                          type="text"
                          value={opt}
                          onChange={e => patchOption(f.id, oi, e.target.value)}
                        />
                        <button type="button" className="chip-x" onClick={() => removeOption(f.id, oi)}>×</button>
                      </div>
                    ))}
                    {(f.options || []).length < 4 && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => addOption(f.id)}>+ Option</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          {/* Pixel */}
          <fieldset className="formular-section">
            <legend>Tracking</legend>
            <div className="form-grid">
              <label className="field">
                <span>Meta Pixel ID (optional)</span>
                <input type="text" value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="123456789012345" />
              </label>
              <label className="field">
                <span>Conversion-Event</span>
                <select value={conversionZiel} onChange={e => setConversionZiel(e.target.value)}>
                  <option value="Bewerbung einreichen">Bewerbung einreichen</option>
                  <option value="Lead">Lead</option>
                  <option value="CompleteRegistration">CompleteRegistration</option>
                  <option value="SubmitApplication">SubmitApplication</option>
                </select>
              </label>
            </div>
          </fieldset>

          {error && <div className="alert alert-error">{error}</div>}

          {/* Bewerbungen */}
          <fieldset className="formular-section">
            <legend>Eingegangene Bewerbungen ({bewerbungen.length})</legend>
            {bewerbungen.length === 0 ? (
              <div className="motiv-sub">Noch keine Bewerbungen.</div>
            ) : (
              <div className="bewerbungen-list">
                {bewerbungen.map(b => (
                  <div key={b.id} className="bewerbung-row">
                    <strong>{b.name || '(ohne Namen)'}</strong>
                    <span>{b.email || b.telefon || '—'}</span>
                    <span className="bewerbung-date">{new Date(b.created_at).toLocaleString('de-DE')}</span>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        {/* ───────── Vorschau rechts ───────── */}
        <aside className="funnel-editor-right">
          <div className="funnel-preview-head">
            <strong>Vorschau</strong>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowPreviewModal(true)}>Groß öffnen</button>
          </div>
          <div className="funnel-preview-stage">
            <FunnelView
              key={previewKey.current}
              funnel={previewFunnel}
              job={job}
              kunde={kunde}
              frame="phone"
              readonly
            />
          </div>
        </aside>
      </div>

      {/* Vorschau-Modal */}
      {showPreviewModal && (
        <div className="modal-overlay" onClick={() => setShowPreviewModal(false)}>
          <div className="modal funnel-preview-modal" onClick={e => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Vorschau</h2>
              <button className="modal-close" onClick={() => setShowPreviewModal(false)}>×</button>
            </header>
            <div className="modal-body" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
              <FunnelView funnel={previewFunnel} job={job} kunde={kunde} frame="phone" readonly />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
