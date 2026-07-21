import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getBrand } from '../lib/branding.js';
import { t } from '../lib/anrede.js';

const BASE = import.meta.env.VITE_API_BASE || '/api';
async function publicApi(path, options = {}) {
  const res = await fetch(`${BASE}/public${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function BrandHeader({ agentur }) {
  const brand = getBrand(agentur);
  if (brand.key === 'nowagwirth') {
    return <div className="public-brand"><img src={brand.logoUrl} alt={brand.name} style={{ height: 28 }} /></div>;
  }
  return <div className="public-brand"><span>Talent</span><span className="brand-accent">One</span></div>;
}

export default function PublicAvv() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    publicApi(`/avv/${token}`).then(setInfo).catch(e => setLoadError(e.message));
  }, [token]);

  async function accept(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError(t(info, 'Bitte deinen Namen eingeben.', 'Bitte Ihren Namen eingeben.')); return; }
    setBusy(true);
    try {
      await publicApi(`/avv/${token}/akzeptieren`, { method: 'POST', body: { name: name.trim() } });
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (loadError) {
    return <div className="public-page"><div className="public-card"><h1 className="public-title">Hoppla.</h1><p className="public-sub">{loadError}</p></div></div>;
  }
  if (!info) return <div className="public-page"><div className="public-card">Lade…</div></div>;

  const bereitsAkzeptiert = info.akzeptiert || done;

  return (
    <div className="public-page">
      <div className="public-card public-card-form">
        <BrandHeader agentur={info.agentur} />
        <h1 className="public-title">Auftragsverarbeitungsvertrag</h1>
        <p className="public-sub">
          für <strong>{info.firmenname}</strong>{info.version ? ` · Version ${info.version}` : ''}
        </p>

        {info.pdf_url && (
          <div className="avv-pdf-frame">
            <iframe src={info.pdf_url} title="Auftragsverarbeitungsvertrag" />
            <a href={info.pdf_url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" style={{ marginTop: 8, display: 'inline-block' }}>
              📄 PDF in neuem Tab öffnen
            </a>
          </div>
        )}

        {bereitsAkzeptiert ? (
          <div className="alert alert-success" style={{ marginTop: 16 }}>
            ✅ Der Auftragsverarbeitungsvertrag wurde akzeptiert
            {info.akzeptiert_von ? ` von ${info.akzeptiert_von}` : ''}
            {info.akzeptiert_am ? ` am ${new Date(info.akzeptiert_am).toLocaleDateString('de-DE')}` : ''}.
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{t(info, 'Eine Kopie wurde per E-Mail an dich versendet.', 'Eine Kopie wurde per E-Mail an Sie versendet.')}</div>
          </div>
        ) : (
          <form onSubmit={accept} style={{ marginTop: 16 }}>
            <label className="field">
              <span>{t(info, 'Dein Name (zur Bestätigung)', 'Ihr Name (zur Bestätigung)')}</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Vor- und Nachname" autoComplete="name" required />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: 12 }}>
              {busy ? 'Wird bestätigt…' : 'Auftragsverarbeitungsvertrag akzeptieren'}
            </button>
            <p style={{ marginTop: 10, fontSize: 12, color: '#9a9994', lineHeight: 1.5 }}>
              {t(info, 'Mit Klick bestätigst du, den Auftragsverarbeitungsvertrag im Namen von ', 'Mit Klick bestätigen Sie, den Auftragsverarbeitungsvertrag im Namen von ')}<strong>{info.firmenname}</strong> gelesen zu haben und zu akzeptieren.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
