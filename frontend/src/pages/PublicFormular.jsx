import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fileToBase64 } from '../lib/files.js';
import { getBrand } from '../lib/branding.js';

// Meta Pixel — TalentOne (Formular-Eingang als Lead)
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || '1696247654718860';
function loadMetaPixel(pixelId) {
  if (!pixelId || typeof window === 'undefined' || window.fbq) return;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
    n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
}
function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function BrandHeader({ agentur }) {
  const brand = getBrand(agentur);
  if (brand.key === 'nowagwirth') {
    return (
      <div className="public-brand">
        <img src={brand.logoUrl} alt={brand.name} style={{ height: 28 }} />
      </div>
    );
  }
  return <div className="public-brand"><span>Talent</span><span className="brand-accent">One</span></div>;
}

function BrandFooter({ agentur }) {
  const brand = getBrand(agentur);
  return (
    <p className="public-footer-line" style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: '#9a9994' }}>
      {brand.madeWith.split('by')[0]}by <a href={brand.websiteUrl} target="_blank" rel="noreferrer" style={{ color: '#5a5955', textDecoration: 'none', borderBottom: '1px dotted #c0bfba' }}>{brand.name}</a>
    </p>
  );
}

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function publicApi(path, options = {}) {
  const res = await fetch(`${BASE}/public${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const BRANCHE_OPTIONS = [
  { value: '', label: '— bitte wählen —' },
  { value: 'handwerk', label: 'Handwerk & Bau' },
  { value: 'pflege', label: 'Pflege & Soziales' },
  { value: 'einzelhandel', label: 'Einzelhandel' },
  { value: 'gastro', label: 'Gastronomie & Hotel' },
  { value: 'buero', label: 'Büro & Verwaltung' },
  { value: 'logistik', label: 'Logistik & Transport' },
];

const MITARBEITER_OPTIONS = [
  { value: '', label: '— bitte wählen —' },
  { value: '1-10', label: '1–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '200+', label: '200+' },
];

const REISE_OPTIONS = [
  { value: '', label: 'keine' },
  { value: 'regional', label: 'regional' },
  { value: 'bundesweit', label: 'bundesweit' },
];

const ERFAHRUNG_OPTIONS = [
  { value: '', label: 'egal' },
  { value: '1-2', label: '1–2 Jahre' },
  { value: '3-5', label: '3–5 Jahre' },
  { value: '5+', label: '5+ Jahre' },
];

const BENEFIT_OPTIONS = [
  'Firmenwagen', 'Tankkarte', 'Jobrad', 'Betriebliche Altersvorsorge',
  'Flexible Arbeitszeiten', 'Home Office', 'Weiterbildungsbudget',
  '4-Tage-Woche', 'Überdurchschnittliches Gehalt', 'Bonuszahlungen',
  '30+ Tage Urlaub', 'Team-Events', 'Kostenlose Getränke / Obst', 'Fitnesszuschuss',
];

const SOFT_SKILL_OPTIONS = [
  'Teamfähigkeit', 'Zuverlässigkeit', 'Eigeninitiative',
  'Kommunikationsstärke', 'Belastbarkeit', 'Lernbereitschaft',
  'Organisationstalent', 'Kundenorientierung',
];

const EMPTY_FORM = {
  // Unternehmen
  firmenname: '', ansprechpartner: '', telefon: '',
  website_url: '', mitarbeiter_anzahl: '', branche: '',
  unterschied: '', mitarbeiter_gerne: '', unternehmenskultur: '',
  // Stelle
  stelle: '', region: '', gehalt: '', besonderheiten: '',
  reisebereitschaft: '', quereinsteiger: false,
  // Benefits
  benefits: [], benefits_zusatz: '',
  // Idealer Kandidat
  ausbildung: '', soft_skills: [], soft_skills_zusatz: '',
  berufserfahrung: '', kandidat_eigenschaften: '',
};

function detectFileType(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(file.name)
  ) return 'docx';
  return null;
}

export default function PublicFormular() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [projekttyp, setProjekttyp] = useState('mitarbeitergewinnung');
  const [loadError, setLoadError] = useState('');
  const [done, setDone] = useState(false);

  // Modus oben (URL / PDF / Manuell)
  const [mode, setMode] = useState('manual');
  const [extractUrl, setExtractUrl] = useState('');
  const [extractFile, setExtractFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractedHinweis, setExtractedHinweis] = useState('');
  const extractFileInputRef = useRef(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [logo, setLogo] = useState(null); // { url } nach Upload
  const [logoBusy, setLogoBusy] = useState(false);
  const [fotos, setFotos] = useState([]); // [{ id, bild_url, beschreibung }]
  const [pendingFotos, setPendingFotos] = useState([]); // [{file, beschreibung, id}]
  const [fotoBusy, setFotoBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const logoInputRef = useRef(null);
  const fotosInputRef = useRef(null);

  useEffect(() => { loadMetaPixel(META_PIXEL_ID); }, []);

  useEffect(() => {
    publicApi(`/formular/${token}`)
      .then(res => {
        setInfo(res.kunde);
        setProjekttyp(res.projekttyp || 'mitarbeitergewinnung');
        setForm(prev => ({
          ...prev,
          firmenname: res.kunde.firmenname || '',
          ansprechpartner: res.kunde.ansprechpartner || '',
        }));
      })
      .catch(err => setLoadError(err.message));
  }, [token]);

  function setField(key, value) { setForm(prev => ({ ...prev, [key]: value })); }
  function toggleArrayField(key, value) {
    setForm(prev => {
      const arr = prev[key] || [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value] };
    });
  }

  /* ───── Auto-Fill aus URL/PDF ───── */
  function applyExtracted(e) {
    if (!e || typeof e !== 'object') return;
    const benefits = Array.isArray(e.benefits) ? e.benefits.filter(Boolean) : [];
    const matchedBenefits = benefits.filter(b =>
      BENEFIT_OPTIONS.some(opt => opt.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(opt.toLowerCase()))
    ).map(b => {
      const match = BENEFIT_OPTIONS.find(opt => opt.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(opt.toLowerCase()));
      return match;
    }).filter(Boolean);
    const restBenefits = benefits.filter(b => !matchedBenefits.some(m => m.toLowerCase() === b.toLowerCase()));

    setForm(prev => ({
      ...prev,
      firmenname: e.firma || prev.firmenname,
      ansprechpartner: e.ansprechpartner || prev.ansprechpartner,
      telefon: e.kontakt_telefon || prev.telefon,
      branche: e.branche || prev.branche,
      stelle: e.position || prev.stelle,
      region: e.standort || prev.region,
      gehalt: e.gehalt || prev.gehalt,
      ausbildung: e.ausbildung || prev.ausbildung,
      besonderheiten: [
        e.aufgaben && `Aufgaben: ${e.aufgaben}`,
        e.kenntnisse && `Kenntnisse: ${e.kenntnisse}`,
      ].filter(Boolean).join('\n') || prev.besonderheiten,
      unterschied: e.unterschied || prev.unterschied,
      unternehmenskultur: e.betriebsklima || prev.unternehmenskultur,
      benefits: [...new Set([...(prev.benefits || []), ...matchedBenefits])],
      benefits_zusatz: restBenefits.join(', ') || prev.benefits_zusatz,
      quereinsteiger: typeof e.quereinsteiger === 'boolean' ? e.quereinsteiger : prev.quereinsteiger,
      reisebereitschaft: typeof e.reisebereitschaft === 'boolean' && e.reisebereitschaft ? 'regional' : prev.reisebereitschaft,
    }));
  }

  async function runExtractUrl() {
    if (!extractUrl.trim()) return;
    setExtracting(true);
    setExtractError('');
    setExtractedHinweis('');
    try {
      const res = await publicApi(`/formular/${token}/extract`, {
        method: 'POST', body: { mode: 'url', url: extractUrl.trim() },
      });
      applyExtracted(res.extracted);
      setExtractedHinweis('Felder wurden vorausgefüllt — bitte unten prüfen und ergänzen.');
      setMode('manual'); // weiter im Formular
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  async function runExtractFile() {
    if (!extractFile) return;
    const fileType = detectFileType(extractFile);
    if (!fileType) { setExtractError('Bitte PDF oder DOCX hochladen.'); return; }
    setExtracting(true);
    setExtractError('');
    setExtractedHinweis('');
    try {
      const fileData = await fileToBase64(extractFile);
      const res = await publicApi(`/formular/${token}/extract`, {
        method: 'POST', body: { mode: 'file', fileType, fileData },
      });
      applyExtracted(res.extracted);
      setExtractedHinweis('Felder wurden aus der Datei vorausgefüllt — bitte unten prüfen.');
      setMode('manual');
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  /* ───── Logo ───── */
  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    try {
      const fileData = await fileToBase64(file);
      const res = await publicApi(`/formular/${token}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      setLogo({ url: res.logo_url });
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoBusy(false);
    }
  }

  /* ───── Fotos ───── */
  function onFotosChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setPendingFotos(prev => [...prev, ...files.map(f => ({ file: f, beschreibung: '', id: `${Date.now()}-${Math.random()}` }))]);
  }
  function updatePending(id, value) {
    setPendingFotos(prev => prev.map(p => p.id === id ? { ...p, beschreibung: value } : p));
  }
  function removePending(id) {
    setPendingFotos(prev => prev.filter(p => p.id !== id));
  }
  async function uploadFotos() {
    setFotoBusy(true);
    const items = pendingFotos.slice();
    setPendingFotos([]);
    for (const item of items) {
      try {
        const fileData = await fileToBase64(item.file);
        const res = await publicApi(`/formular/${token}/foto`, {
          method: 'POST',
          body: {
            fileData, fileName: item.file.name,
            contentType: item.file.type || 'image/jpeg',
            beschreibung: item.beschreibung.trim() || null,
          },
        });
        setFotos(prev => [res.referenzbild, ...prev]);
      } catch (err) {
        alert(`Foto "${item.file.name}" fehlgeschlagen: ${err.message}`);
      }
    }
    setFotoBusy(false);
  }

  /* ───── Submit ───── */
  async function onSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!form.firmenname.trim()) { setSubmitError('Firmenname ist Pflicht.'); return; }
    if (!form.stelle.trim()) { setSubmitError('Stellenbezeichnung ist Pflicht.'); return; }
    if (!form.unterschied.trim()) { setSubmitError('Bitte beschreibt, was euch von anderen unterscheidet.'); return; }
    if (!form.mitarbeiter_gerne.trim()) { setSubmitError('Bitte beantwortet, warum Mitarbeiter gerne bei euch sind.'); return; }

    setSubmitBusy(true);
    try {
      const benefitsList = [
        ...(form.benefits || []),
        ...(form.benefits_zusatz ? form.benefits_zusatz.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : []),
      ];
      // Pixel-Lead-Event clientseitig
      try {
        if (window.fbq) {
          window.fbq('track', 'Lead', { content_name: 'Briefing-Formular', source: form.firmenname });
        }
      } catch { /* noop */ }

      await publicApi(`/formular/${token}/submit`, {
        method: 'POST',
        body: {
          kunde: {
            firmenname: form.firmenname,
            ansprechpartner: form.ansprechpartner,
            telefon: form.telefon,
            website_url: form.website_url,
            branche: form.branche,
          },
          job: {
            stelle: form.stelle,
            region: form.region,
            gehalt: form.gehalt,
            benefits: benefitsList,
            besonderheiten: form.besonderheiten,
            reisebereitschaft: !!form.reisebereitschaft,
            quereinsteiger: form.quereinsteiger,
          },
          formdata: form,
          _fbp: getCookie('_fbp'),
          _fbc: getCookie('_fbc'),
        },
      });
      setDone(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="public-page">
        <div className="public-card">
          <BrandHeader agentur={info?.agentur} />
          <h1 className="public-title">Hoppla.</h1>
          <p className="public-sub">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!info) return <div className="public-page"><div className="public-card">Lade…</div></div>;
  if (done) {
    return (
      <div className="public-page">
        <div className="public-card">
          <BrandHeader agentur={info?.agentur} />
          <h1 className="public-title">Vielen Dank!</h1>
          <p className="public-sub">Eure Angaben sind bei uns angekommen. Wir machen uns sofort an die Arbeit und melden uns mit den ersten Creatives bei euch.</p>
        </div>
      </div>
    );
  }

  // Weiche: bei Neukundengewinnung zeigen wir die Produkt/Zielgruppe-Variante.
  if (projekttyp === 'neukundengewinnung') {
    return <NeukundenBriefingForm
      token={token} info={info}
      onDone={() => setDone(true)}
    />;
  }

  return (
    <div className="public-page">
      <div className="public-card public-card-form">
        <BrandHeader agentur={info?.agentur} />
        <h1 className="public-title">Briefing-Formular</h1>
        <p className="public-sub">
          Hallo {info.ansprechpartner ? info.ansprechpartner.split(' ')[0] : (info.firmenname || 'zusammen')}! Damit wir eine passgenaue Recruiting-Kampagne für euch bauen können, brauchen wir ein paar Infos. ~10 Minuten.
        </p>

        {/* ───── Modus oben: URL / PDF / Manuell ───── */}
        <div className="form-quick">
          <div className="form-quick-tabs">
            <button type="button" className={`form-quick-tab ${mode === 'url' ? 'is-active' : ''}`} onClick={() => setMode('url')}>URL</button>
            <button type="button" className={`form-quick-tab ${mode === 'file' ? 'is-active' : ''}`} onClick={() => setMode('file')}>PDF / DOCX</button>
            <button type="button" className={`form-quick-tab ${mode === 'manual' ? 'is-active' : ''}`} onClick={() => setMode('manual')}>Manuell</button>
          </div>
          {mode === 'url' && (
            <div className="form-quick-pane">
              <p>Falls ihr eine bestehende Stellenanzeige als URL habt, fügt sie hier ein — wir füllen die Felder unten automatisch aus.</p>
              <div className="form-quick-row">
                <input type="url" placeholder="https://…" value={extractUrl} onChange={e => setExtractUrl(e.target.value)} />
                <button type="button" className="btn-primary btn-sm" onClick={runExtractUrl} disabled={extracting || !extractUrl.trim()}>
                  {extracting ? 'Lese…' : 'Auslesen'}
                </button>
              </div>
            </div>
          )}
          {mode === 'file' && (
            <div className="form-quick-pane">
              <p>Stellenanzeige als PDF oder DOCX hochladen — wir lesen sie aus und befüllen die Felder.</p>
              <div className="form-quick-row">
                <input ref={extractFileInputRef} type="file" accept=".pdf,.docx,application/pdf" style={{ display: 'none' }} onChange={e => setExtractFile(e.target.files?.[0] || null)} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => extractFileInputRef.current?.click()}>
                  {extractFile ? extractFile.name : 'Datei wählen'}
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={runExtractFile} disabled={extracting || !extractFile}>
                  {extracting ? 'Lese…' : 'Auslesen'}
                </button>
              </div>
            </div>
          )}
          {mode === 'manual' && extractedHinweis && (
            <div className="form-quick-pane">
              <p style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{extractedHinweis}</p>
            </div>
          )}
          {extractError && <div className="alert alert-error" style={{ marginTop: 10 }}>{extractError}</div>}
        </div>

        <form onSubmit={onSubmit} className="formular">
          {/* ───── Über das Unternehmen ───── */}
          <fieldset className="formular-section">
            <legend>Über das Unternehmen</legend>
            <div className="form-grid">
              <label className="field field-full">
                <span>Firmenname *</span>
                <input value={form.firmenname} onChange={e => setField('firmenname', e.target.value)} required />
              </label>
              <label className="field">
                <span>Ansprechpartner</span>
                <input value={form.ansprechpartner} onChange={e => setField('ansprechpartner', e.target.value)} />
              </label>
              <label className="field">
                <span>Telefon</span>
                <input type="tel" value={form.telefon} onChange={e => setField('telefon', e.target.value)} />
              </label>
              <label className="field field-full">
                <span>Website-URL</span>
                <input type="url" placeholder="https://…" value={form.website_url} onChange={e => setField('website_url', e.target.value)} />
              </label>
              <label className="field">
                <span>Branche</span>
                <select value={form.branche} onChange={e => setField('branche', e.target.value)}>
                  {BRANCHE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Wie viele Mitarbeiter?</span>
                <select value={form.mitarbeiter_anzahl} onChange={e => setField('mitarbeiter_anzahl', e.target.value)}>
                  {MITARBEITER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field field-full">
                <span>Was unterscheidet euch von anderen Arbeitgebern? *</span>
                <textarea rows={3} value={form.unterschied} onChange={e => setField('unterschied', e.target.value)} required />
              </label>
              <label className="field field-full">
                <span>Warum arbeiten eure Mitarbeiter gerne bei euch? *</span>
                <textarea rows={3} value={form.mitarbeiter_gerne} onChange={e => setField('mitarbeiter_gerne', e.target.value)} required />
              </label>
              <label className="field field-full">
                <span>Unternehmenskultur — wie würdet ihr sie beschreiben?</span>
                <textarea rows={2} value={form.unternehmenskultur} onChange={e => setField('unternehmenskultur', e.target.value)} />
              </label>
            </div>
          </fieldset>

          {/* ───── Stelle ───── */}
          <fieldset className="formular-section">
            <legend>Die offene Stelle</legend>
            <div className="form-grid">
              <label className="field field-full">
                <span>Stellenbezeichnung *</span>
                <input value={form.stelle} onChange={e => setField('stelle', e.target.value)} required />
              </label>
              <label className="field">
                <span>Region / Ort</span>
                <input value={form.region} onChange={e => setField('region', e.target.value)} />
              </label>
              <label className="field">
                <span>Gehalt / Spanne</span>
                <input value={form.gehalt} onChange={e => setField('gehalt', e.target.value)} placeholder="z.B. 3.000–4.000 € brutto" />
              </label>
              <label className="field field-full">
                <span>Besonderheiten der Stelle</span>
                <textarea rows={2} value={form.besonderheiten} onChange={e => setField('besonderheiten', e.target.value)} placeholder="z.B. Neue Filiale, Aufstieg möglich, Spezialisierung…" />
              </label>
              <label className="field">
                <span>Reisebereitschaft</span>
                <select value={form.reisebereitschaft} onChange={e => setField('reisebereitschaft', e.target.value)}>
                  {REISE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field-checkbox">
                <input type="checkbox" checked={form.quereinsteiger} onChange={e => setField('quereinsteiger', e.target.checked)} />
                <span>Quereinsteiger willkommen</span>
              </label>
            </div>
          </fieldset>

          {/* ───── Benefits ───── */}
          <fieldset className="formular-section">
            <legend>Benefits</legend>
            <div className="check-grid">
              {BENEFIT_OPTIONS.map(b => (
                <label key={b} className="check-item">
                  <input type="checkbox" checked={form.benefits.includes(b)} onChange={() => toggleArrayField('benefits', b)} />
                  <span>{b}</span>
                </label>
              ))}
            </div>
            <label className="field field-full" style={{ marginTop: 14 }}>
              <span>Weitere Benefits die ihr bietet</span>
              <textarea rows={2} value={form.benefits_zusatz} onChange={e => setField('benefits_zusatz', e.target.value)} placeholder="Mehrere mit Komma trennen" />
            </label>
          </fieldset>

          {/* ───── Idealer Kandidat ───── */}
          <fieldset className="formular-section">
            <legend>Idealer Kandidat</legend>
            <div className="form-grid">
              <label className="field field-full">
                <span>Welche Ausbildung / Qualifikation wird benötigt?</span>
                <input value={form.ausbildung} onChange={e => setField('ausbildung', e.target.value)} />
              </label>
              <label className="field">
                <span>Berufserfahrung gewünscht?</span>
                <select value={form.berufserfahrung} onChange={e => setField('berufserfahrung', e.target.value)}>
                  {ERFAHRUNG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <div className="field field-full">
                <span className="field-label">Welche Soft Skills sind euch wichtig?</span>
                <div className="check-grid">
                  {SOFT_SKILL_OPTIONS.map(s => (
                    <label key={s} className="check-item">
                      <input type="checkbox" checked={form.soft_skills.includes(s)} onChange={() => toggleArrayField('soft_skills', s)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="field field-full">
                <span>Weitere Soft Skills (Freitext)</span>
                <input value={form.soft_skills_zusatz} onChange={e => setField('soft_skills_zusatz', e.target.value)} />
              </label>
              <label className="field field-full">
                <span>Welche Eigenschaften soll der ideale Kandidat mitbringen?</span>
                <textarea rows={2} value={form.kandidat_eigenschaften} onChange={e => setField('kandidat_eigenschaften', e.target.value)} />
              </label>
            </div>
          </fieldset>

          {/* ───── Logo + Fotos ───── */}
          <fieldset className="formular-section">
            <legend>Logo & Fotos</legend>
            <div className="upload-block" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
              <div className="upload-block-title">Euer Logo</div>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={onLogoChange} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {logo?.url && <img src={logo.url} alt="" style={{ width: 56, height: 56, borderRadius: 10, border: '1px solid var(--line)', objectFit: 'contain', background: '#fff', padding: 4 }} />}
                <button type="button" className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
                  {logoBusy ? 'Lade hoch…' : (logo ? 'Logo tauschen' : 'Logo wählen')}
                </button>
              </div>
              <p className="upload-block-hint">PNG, JPG, SVG oder WebP. Aus dem Logo extrahieren wir auch automatisch eure Markenfarben.</p>
            </div>
            <div className="upload-block">
              <div className="upload-block-title">Fotos vom Team / Mitarbeitern / Geschäftsführung</div>
              <input ref={fotosInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }} onChange={onFotosChange} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => fotosInputRef.current?.click()}>Fotos auswählen</button>
              <p className="upload-block-hint">Mehrere möglich. Handy-Fotos sind ok — bitte authentisch.</p>
              {fotos.length > 0 && (
                <div className="ref-strip-grid" style={{ marginTop: 12 }}>
                  {fotos.map(r => (
                    <div key={r.id} className="ref-strip-thumb"><img src={r.bild_url} alt="" /></div>
                  ))}
                </div>
              )}
              {pendingFotos.length > 0 && (
                <div className="pending-fotos">
                  <div className="pending-fotos-title">Wer ist auf den Fotos?</div>
                  {pendingFotos.map(p => (
                    <div key={p.id} className="pending-foto">
                      <div className="pending-foto-name">{p.file.name}</div>
                      <input type="text" placeholder="z.B. Max Müller, Geschäftsführer" value={p.beschreibung} onChange={e => updatePending(p.id, e.target.value)} />
                      <button type="button" className="btn-ghost btn-sm" onClick={() => removePending(p.id)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="btn-primary btn-sm" onClick={uploadFotos} disabled={fotoBusy} style={{ marginTop: 10 }}>
                    {fotoBusy ? 'Lade hoch…' : `${pendingFotos.length} Foto${pendingFotos.length === 1 ? '' : 's'} hochladen`}
                  </button>
                </div>
              )}
            </div>
          </fieldset>

          {submitError && <div className="alert alert-error" style={{ marginTop: 8 }}>{submitError}</div>}

          <div className="formular-submit">
            <button type="submit" className="btn-primary" disabled={submitBusy}>
              {submitBusy ? 'Sende…' : 'Briefing absenden'}
            </button>
          </div>
        </form>
        <BrandFooter agentur={info?.agentur} />
      </div>
    </div>
  );
}

/* ═════════════════════ Neukunden-Briefing-Formular ═════════════════════
   Alternative Formular-Variante für projekttyp='neukundengewinnung'.
   Reine Public-Ansicht — nutzt dieselben /formular/:token/{extract,logo,foto,submit}
   Endpoints, schickt aber projekttyp='neukundengewinnung' mit und mapt die
   Felder in job.neukunden_daten. */

function NeukundenBriefingForm({ token, info, onDone }) {
  const [mode, setMode] = useState('manual');
  const [extractUrl, setExtractUrl] = useState('');
  const [extractFile, setExtractFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractedHinweis, setExtractedHinweis] = useState('');
  const extractFileInputRef = useRef(null);

  const [form, setForm] = useState({
    firmenname: info.firmenname || '',
    ansprechpartner: info.ansprechpartner || '',
    telefon: '',
    website_url: '',
    branche: '',
    produkt: '',
    kundenprofil: '',
    zielgruppe: '',
    vorteile: [],
    unterschied: '',
    preisrahmen: '',
    einzugsgebiet: '',
  });
  const [newVorteil, setNewVorteil] = useState('');
  const [logo, setLogo] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [fotos, setFotos] = useState([]);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const logoInputRef = useRef(null);
  const fotoInputRef = useRef(null);

  function setF(k, v) { setForm(prev => ({ ...prev, [k]: v })); }
  function addVorteil() {
    const v = newVorteil.trim();
    if (!v) return;
    setF('vorteile', [...form.vorteile, v]);
    setNewVorteil('');
  }
  function removeVorteil(i) {
    setF('vorteile', form.vorteile.filter((_, idx) => idx !== i));
  }

  async function runExtractUrl() {
    if (!extractUrl.trim()) return setExtractError('Bitte URL eingeben.');
    setExtracting(true); setExtractError(''); setExtractedHinweis('');
    try {
      const res = await publicApi(`/formular/${token}/extract`, {
        method: 'POST',
        body: { mode: 'url', url: extractUrl.trim(), projekttyp: 'neukundengewinnung' },
      });
      applyExtracted(res.extracted);
      setMode('manual');
      setExtractedHinweis('✅ Wir haben deine Website analysiert. Bitte prüf die Angaben unten und ergänze fehlende Punkte.');
    } catch (err) { setExtractError('Extraktion fehlgeschlagen: ' + err.message); }
    finally { setExtracting(false); }
  }

  async function runExtractFile() {
    if (!extractFile) return setExtractError('Bitte Datei auswählen.');
    const fileType = detectFileType(extractFile);
    if (!fileType) return setExtractError('Nur PDF oder DOCX unterstützt.');
    setExtracting(true); setExtractError(''); setExtractedHinweis('');
    try {
      const fileData = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',').pop());
        r.onerror = reject;
        r.readAsDataURL(extractFile);
      });
      const res = await publicApi(`/formular/${token}/extract`, {
        method: 'POST',
        body: { mode: 'file', fileData, fileType, projekttyp: 'neukundengewinnung' },
      });
      applyExtracted(res.extracted);
      setMode('manual');
      setExtractedHinweis('✅ Wir haben das PDF analysiert. Bitte prüf die Angaben unten und ergänze fehlende Punkte.');
    } catch (err) { setExtractError('Extraktion fehlgeschlagen: ' + err.message); }
    finally { setExtracting(false); }
  }

  function applyExtracted(ex) {
    if (!ex) return;
    setForm(prev => ({
      ...prev,
      firmenname:    prev.firmenname || ex.firma || '',
      branche:       prev.branche || ex.branche || '',
      produkt:       prev.produkt || ex.produkt || '',
      kundenprofil:  prev.kundenprofil || ex.kundenprofil || '',
      zielgruppe:    prev.zielgruppe || ex.zielgruppe || '',
      vorteile:      prev.vorteile.length ? prev.vorteile : (Array.isArray(ex.vorteile) ? ex.vorteile : []),
      unterschied:   prev.unterschied || ex.unterschied || '',
      preisrahmen:   prev.preisrahmen || ex.preisrahmen || '',
      einzugsgebiet: prev.einzugsgebiet || ex.einzugsgebiet || '',
      telefon:       prev.telefon || ex.kontakt_telefon || '',
    }));
  }

  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    try {
      const fileData = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',').pop());
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await publicApi(`/formular/${token}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      setLogo({ url: res.logo_url });
    } catch (err) { alert('Logo-Upload fehlgeschlagen: ' + err.message); }
    finally { setLogoBusy(false); }
  }

  async function onFotosChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setFotoBusy(true);
    try {
      for (const file of files) {
        const fileData = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',').pop());
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const res = await publicApi(`/formular/${token}/foto`, {
          method: 'POST',
          body: {
            fileData, fileName: file.name, contentType: file.type || 'image/jpeg',
            beschreibung: 'Produktbild',
          },
        });
        setFotos(prev => [...prev, res.foto || { id: Date.now(), bild_url: res.bild_url }]);
      }
    } catch (err) { alert('Foto-Upload fehlgeschlagen: ' + err.message); }
    finally { setFotoBusy(false); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!form.firmenname.trim()) return setSubmitError('Firmenname ist Pflicht.');
    if (!form.produkt.trim())    return setSubmitError('Produkt/Dienstleistung ist Pflicht.');
    setSubmitBusy(true);
    try {
      await publicApi(`/formular/${token}/submit`, {
        method: 'POST',
        body: {
          projekttyp: 'neukundengewinnung',
          kunde: {
            firmenname:      form.firmenname.trim(),
            ansprechpartner: form.ansprechpartner.trim() || null,
            telefon:         form.telefon.trim() || null,
            website_url:     form.website_url.trim() || null,
            branche:         form.branche || null,
          },
          job: {
            neukunden_daten: {
              produkt:       form.produkt.trim(),
              kundenprofil:  form.kundenprofil.trim(),
              zielgruppe:    form.zielgruppe.trim(),
              vorteile:      form.vorteile.filter(Boolean),
              unterschied:   form.unterschied.trim(),
              preisrahmen:   form.preisrahmen.trim(),
              einzugsgebiet: form.einzugsgebiet.trim(),
            },
          },
        },
      });
      onDone();
    } catch (err) { setSubmitError(err.message); }
    finally { setSubmitBusy(false); }
  }

  return (
    <div className="public-page">
      <div className="public-card public-card-form">
        <BrandHeader agentur={info?.agentur} />
        <h1 className="public-title">Neukunden-Briefing</h1>
        <p className="public-sub">
          Hallo {info.ansprechpartner ? info.ansprechpartner.split(' ')[0] : 'zusammen'}! Damit wir eine passgenaue Kampagne für neue Kunden bauen können, brauchen wir ein paar Infos zu deinem Angebot. ~10 Minuten.
        </p>

        {/* Eingabewege — URL / PDF / Manuell */}
        <div className="modal-tabs" style={{ marginBottom: 16 }}>
          <button className={`modal-tab ${mode === 'url' ? 'is-active' : ''}`} onClick={() => setMode('url')}>🌐 Website / URL</button>
          <button className={`modal-tab ${mode === 'file' ? 'is-active' : ''}`} onClick={() => setMode('file')}>📄 PDF / Broschüre</button>
          <button className={`modal-tab ${mode === 'manual' ? 'is-active' : ''}`} onClick={() => setMode('manual')}>✍️ Selbst ausfüllen</button>
        </div>

        {mode === 'url' && (
          <div className="modal-pane">
            <p className="pane-hint">URL deiner Firmen-Website oder Produkt-Landingpage — die KI zieht Produkt, Zielgruppe und Vorteile automatisch raus.</p>
            <label className="field field-full">
              <span>URL</span>
              <input type="url" placeholder="https://…" value={extractUrl} onChange={e => setExtractUrl(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" onClick={runExtractUrl} disabled={extracting || !extractUrl.trim()}>
              {extracting ? 'Analysiere…' : 'Analysieren'}
            </button>
            {extractError && <div className="alert alert-error" style={{ marginTop: 8 }}>{extractError}</div>}
          </div>
        )}

        {mode === 'file' && (
          <div className="modal-pane">
            <p className="pane-hint">Angebots-PDF, Produktbroschüre oder Firmenpräsentation hochladen.</p>
            <input ref={extractFileInputRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }} onChange={e => setExtractFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn-ghost" onClick={() => extractFileInputRef.current?.click()}>
              {extractFile ? `📎 ${extractFile.name}` : '📎 Datei auswählen'}
            </button>
            <button type="button" className="btn-primary" style={{ marginLeft: 8 }} onClick={runExtractFile} disabled={extracting || !extractFile}>
              {extracting ? 'Analysiere…' : 'Analysieren'}
            </button>
            {extractError && <div className="alert alert-error" style={{ marginTop: 8 }}>{extractError}</div>}
          </div>
        )}

        {extractedHinweis && (
          <div className="alert" style={{ background: '#dcfce7', color: '#166534', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {extractedHinweis}
          </div>
        )}

        {/* Manuelles Formular — immer sichtbar */}
        <form onSubmit={onSubmit} className="public-form">
          <fieldset className="formular-section">
            <legend>Deine Firma</legend>
            <div className="stelle-grid">
              <label className="field"><span>Firmenname *</span>
                <input required value={form.firmenname} onChange={e => setF('firmenname', e.target.value)} />
              </label>
              <label className="field"><span>Ansprechpartner</span>
                <input value={form.ansprechpartner} onChange={e => setF('ansprechpartner', e.target.value)} />
              </label>
              <label className="field"><span>Telefon</span>
                <input value={form.telefon} onChange={e => setF('telefon', e.target.value)} />
              </label>
              <label className="field"><span>Website</span>
                <input type="url" placeholder="https://…" value={form.website_url} onChange={e => setF('website_url', e.target.value)} />
              </label>
              <label className="field"><span>Branche</span>
                <select value={form.branche} onChange={e => setF('branche', e.target.value)}>
                  <option value="">— bitte wählen —</option>
                  <option value="handwerk">Handwerk & Bau</option>
                  <option value="pflege">Pflege & Soziales</option>
                  <option value="einzelhandel">Einzelhandel</option>
                  <option value="gastro">Gastronomie & Hotel</option>
                  <option value="buero">Büro & Verwaltung</option>
                  <option value="logistik">Logistik & Transport</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="formular-section">
            <legend>Dein Angebot</legend>
            <div className="stelle-grid">
              <label className="field field-full"><span>Produkt / Dienstleistung — was bietet ihr an? *</span>
                <input required value={form.produkt} onChange={e => setF('produkt', e.target.value)}
                  placeholder="z. B. Photovoltaik-Komplettlösung inkl. Speicher" />
              </label>
              <label className="field field-full"><span>Wofür werden Kunden gesucht?</span>
                <textarea rows={2} value={form.kundenprofil} onChange={e => setF('kundenprofil', e.target.value)}
                  placeholder="z. B. Photovoltaik-Anlagen für Eigenheimbesitzer" />
              </label>
              <label className="field field-full"><span>Zielgruppe — wen wollt ihr erreichen?</span>
                <textarea rows={2} value={form.zielgruppe} onChange={e => setF('zielgruppe', e.target.value)}
                  placeholder="z. B. Hausbesitzer 35-65, ländlich, mit eigenem Dach" />
              </label>
              <label className="field"><span>Region / Einzugsgebiet</span>
                <input value={form.einzugsgebiet} onChange={e => setF('einzugsgebiet', e.target.value)}
                  placeholder="z. B. Bayern, Oberpfalz" />
              </label>
              <label className="field"><span>Preisrahmen (optional)</span>
                <input value={form.preisrahmen} onChange={e => setF('preisrahmen', e.target.value)}
                  placeholder="z. B. ab 15.000 €" />
              </label>
            </div>
          </fieldset>

          <fieldset className="formular-section">
            <legend>Vorteile deines Produkts</legend>
            <div className="benefits-list">
              {form.vorteile.map((v, i) => (
                <span key={i} className="benefit-chip">
                  {v}
                  <button type="button" className="benefit-chip-x" onClick={() => removeVorteil(i)} aria-label="Entfernen">×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="text" value={newVorteil} onChange={e => setNewVorteil(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVorteil(); } }}
                placeholder='Neuer Vorteil, z. B. "Amortisation in 8 Jahren"' style={{ flex: 1 }} />
              <button type="button" className="btn-ghost btn-sm" onClick={addVorteil} disabled={!newVorteil.trim()}>+ Hinzufügen</button>
            </div>
          </fieldset>

          <fieldset className="formular-section">
            <legend>Was unterscheidet euch vom Wettbewerb?</legend>
            <label className="field field-full">
              <textarea rows={3} value={form.unterschied} onChange={e => setF('unterschied', e.target.value)}
                placeholder="z. B. Regionaler Anbieter, keine Subunternehmen, 25 Jahre Erfahrung, eigenes Montageteam" />
            </label>
          </fieldset>

          <fieldset className="formular-section">
            <legend>Logo (empfohlen)</legend>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
              style={{ display: 'none' }} onChange={onLogoChange} />
            {logo?.url ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <img src={logo.url} alt="" style={{ maxHeight: 60, background: '#fff', padding: 6, borderRadius: 6 }} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()}>Ersetzen</button>
              </div>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
                {logoBusy ? 'Lade hoch…' : '📎 Logo hochladen'}
              </button>
            )}
          </fieldset>

          <fieldset className="formular-section">
            <legend>Produktbilder ({fotos.length})</legend>
            <p className="pane-hint" style={{ margin: '0 0 8px' }}>
              Bilder deines Produkts / typischer Anwendungssituationen / zufriedener Kunden. Bitte in guter Qualität — landen später als Herzstück in den Werbeanzeigen.
            </p>
            <input ref={fotoInputRef} type="file" multiple accept="image/*"
              style={{ display: 'none' }} onChange={onFotosChange} />
            <button type="button" className="btn-ghost" onClick={() => fotoInputRef.current?.click()} disabled={fotoBusy}>
              {fotoBusy ? 'Lade hoch…' : '📎 Bilder hinzufügen'}
            </button>
            {fotos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {fotos.map((f, i) => (
                  <img key={f.id || i} src={f.bild_url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6 }} />
                ))}
              </div>
            )}
          </fieldset>

          {submitError && <div className="alert alert-error" style={{ marginTop: 8 }}>{submitError}</div>}

          <div className="formular-submit">
            <button type="submit" className="btn-primary" disabled={submitBusy || !form.firmenname.trim() || !form.produkt.trim()}>
              {submitBusy ? 'Sende…' : 'Briefing absenden'}
            </button>
          </div>
        </form>

        <BrandFooter agentur={info?.agentur} />
      </div>
    </div>
  );
}
