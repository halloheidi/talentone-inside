import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fileToBase64 } from '../lib/files.js';
import { getBrand } from '../lib/branding.js';

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

export default function PublicUpload() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState([]);  // [{name, status, error?}]
  const [pendingFotos, setPendingFotos] = useState([]); // [{file, beschreibung}]
  const logoInputRef = useRef(null);
  const fotosInputRef = useRef(null);

  useEffect(() => {
    publicApi(`/upload/${token}`)
      .then(res => setInfo(res.kunde))
      .catch(err => setError(err.message));
  }, [token]);

  async function uploadOne(file, typ, beschreibung) {
    const id = `${Date.now()}-${Math.random()}`;
    setUploads(prev => [...prev, { id, name: file.name, typ, status: 'lade' }]);
    try {
      const fileData = await fileToBase64(file);
      await publicApi(`/upload/${token}`, {
        method: 'POST',
        body: {
          typ, fileData,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          beschreibung: beschreibung || null,
        },
      });
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'fertig' } : u));
    } catch (err) {
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'fehler', error: err.message } : u));
    }
  }

  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadOne(file, 'logo');
  }

  function onFotosChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setPendingFotos(prev => [...prev, ...files.map(f => ({ file: f, beschreibung: '', id: `${Date.now()}-${Math.random()}` }))]);
  }

  function updatePendingDesc(id, value) {
    setPendingFotos(prev => prev.map(p => p.id === id ? { ...p, beschreibung: value } : p));
  }

  function removePending(id) {
    setPendingFotos(prev => prev.filter(p => p.id !== id));
  }

  async function submitFotos() {
    const items = pendingFotos.slice();
    setPendingFotos([]);
    for (const item of items) {
      await uploadOne(item.file, 'foto', item.beschreibung.trim());
    }
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <BrandHeader agentur={info?.agentur} />
          <h1 className="public-title">Hoppla.</h1>
          <p className="public-sub">{error}</p>
        </div>
      </div>
    );
  }

  if (!info) return <div className="public-page"><div className="public-card">Lade…</div></div>;

  return (
    <div className="public-page">
      <div className="public-card">
        <BrandHeader agentur={info?.agentur} />
        <h1 className="public-title">Hallo {info.ansprechpartner ? info.ansprechpartner.split(' ')[0] : info.firmenname}!</h1>
        <p className="public-sub">
          Schön, dass du hier bist. Lade einfach euer Logo und ein paar Fotos vom Team / Arbeitsplatz hoch — wir nutzen sie für eure Recruiting-Kampagne.
        </p>

        {/* Logo */}
        <div className="upload-block">
          <div className="upload-block-title">
            1) Euer Logo {info.hat_logo && <span className="upload-block-tag">bereits vorhanden — kann ersetzt werden</span>}
          </div>
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={onLogoChange} />
          <button className="btn-primary" onClick={() => logoInputRef.current?.click()}>Logo auswählen</button>
          <p className="upload-block-hint">PNG, JPG, SVG oder WebP — Hauptsache gute Qualität.</p>
        </div>

        {/* Fotos */}
        <div className="upload-block">
          <div className="upload-block-title">2) Fotos von Mitarbeiter:innen, Team oder Geschäftsführung</div>
          <input ref={fotosInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }} onChange={onFotosChange} />
          <button className="btn-primary" onClick={() => fotosInputRef.current?.click()}>Fotos auswählen</button>
          <p className="upload-block-hint">Mehrere auf einmal möglich. Handy-Fotos sind völlig ok — bitte authentisch, kein Stockmaterial.</p>

          {pendingFotos.length > 0 && (
            <div className="pending-fotos">
              <div className="pending-fotos-title">Wer ist auf den Fotos?</div>
              {pendingFotos.map(p => (
                <div key={p.id} className="pending-foto">
                  <div className="pending-foto-name">{p.file.name}</div>
                  <input
                    type="text"
                    placeholder="z.B. Max Müller, Geschäftsführer"
                    value={p.beschreibung}
                    onChange={e => updatePendingDesc(p.id, e.target.value)}
                  />
                  <button className="btn-ghost btn-sm" onClick={() => removePending(p.id)}>×</button>
                </div>
              ))}
              <button className="btn-primary" onClick={submitFotos} style={{ marginTop: 12 }}>
                {pendingFotos.length} Foto{pendingFotos.length === 1 ? '' : 's'} hochladen
              </button>
            </div>
          )}
        </div>

        {uploads.length > 0 && (
          <div className="upload-list">
            {uploads.map(u => (
              <div key={u.id} className={`upload-item upload-${u.status}`}>
                <span className="upload-name">{u.name}</span>
                <span className="upload-status">
                  {u.status === 'lade' && 'lädt…'}
                  {u.status === 'fertig' && '✓ hochgeladen'}
                  {u.status === 'fehler' && `Fehler: ${u.error}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="public-foot">
          Sobald du fertig bist, kannst du den Tab einfach schließen — wir bekommen automatisch Bescheid. Vielen Dank!
        </p>
        <BrandFooter agentur={info?.agentur} />
      </div>
    </div>
  );
}
