import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Lightbox from '../components/Lightbox.jsx';

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

const STYLE_LABEL = {
  emotional: 'Emotional / Story',
  benefit:   'Benefit-fokussiert',
  kompakt:   'Knackig / Hook',
};

// Branding-Mapping pro Agentur
const BRANDING = {
  talentone: {
    name: 'TalentOne', primary: '#0a0a0a', accent: '#d4ff00', accentInk: '#0a0a0a',
    footer: 'TalentOne — Recruiting neu gedacht', website: 'https://talent-one.de',
    logo: <span>Talent<span style={{ color: '#d4ff00' }}>One</span></span>,
  },
  nowagwirth: {
    name: 'Nowag & Wirth', primary: '#1a3a6c', accent: '#ffd966', accentInk: '#1a3a6c',
    footer: 'Nowag & Wirth — Digitales Marketing', website: 'https://nowagwirth.de',
    logo: <img src="/nowagwirth-logo.png" alt="Nowag & Wirth" style={{ height: 32, background: '#fff', borderRadius: 6, padding: '4px 8px', display: 'inline-block' }} />,
  },
};

export default function PublicReview() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [kommentare, setKommentare] = useState({}); // { 'creative_<id>': 'text', 'adcopy_<id>': 'text', 'general': 'text' }
  const [busy, setBusy] = useState(null); // 'freigeben' | 'aenderungen' | null
  const [done, setDone] = useState(null); // 'freigegeben' | 'aenderungen'
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    publicApi(`/review/${token}`)
      .then(d => {
        setData(d);
        // Vorhandene Kommentare laden
        if (d.review?.kommentare && typeof d.review.kommentare === 'object') {
          setKommentare(d.review.kommentare);
        }
        if (d.review?.status === 'freigegeben' || d.review?.status === 'aenderungen') {
          setDone(d.review.status);
        }
      })
      .catch(err => setError(err.message));
  }, [token]);

  const brand = useMemo(() => BRANDING[data?.kunde?.agentur] || BRANDING.talentone, [data?.kunde?.agentur]);

  function setKommentar(key, text) {
    setKommentare(prev => ({ ...prev, [key]: text }));
  }

  async function submit(status) {
    setBusy(status);
    try {
      // Leere Kommentare rausfiltern
      const cleaned = Object.fromEntries(
        Object.entries(kommentare).filter(([, v]) => (v || '').trim())
      );
      await publicApi(`/review/${token}`, {
        method: 'POST', body: { status, kommentare: cleaned },
      });
      setDone(status);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <div className="public-brand">{brand.logo}</div>
          <h1 className="public-title">Hoppla.</h1>
          <p className="public-sub">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="public-page"><div className="public-card">Lade…</div></div>;

  const { job, kunde, creatives = [], adcopies = [], funnel_url, sheet_url } = data;
  const themeStyle = { '--rv-primary': brand.primary, '--rv-accent': brand.accent, '--rv-accent-ink': brand.accentInk };

  // Sortierte AdCopies
  const sortedAdcopies = ['emotional', 'benefit', 'kompakt'].map(s => adcopies.find(a => a.stil === s)).filter(Boolean);

  return (
    <div className="review-page" style={themeStyle}>
      <header className="review-header">
        <div className="review-brand">{brand.logo}</div>
        {kunde?.logo_url && <img className="review-kunde-logo" src={kunde.logo_url} alt={kunde.firmenname || ''} />}
      </header>

      <main className="review-main">
        <div className="review-hero">
          <p className="review-eyebrow">Entwürfe zur Freigabe</p>
          <h1 className="review-h1">{job?.stelle || 'Stelle'}{kunde?.firmenname ? <> · <span style={{ color: 'var(--rv-primary)' }}>{kunde.firmenname}</span></> : ''}</h1>
          <p className="review-intro">Schau dir die ersten Entwürfe in Ruhe an. Bei Bedarf kannst du pro Element kommentieren und dann unten alles freigeben oder Änderungswünsche schicken.</p>
        </div>

        {done && (
          <div className={`review-done review-done-${done}`}>
            {done === 'freigegeben'
              ? <><strong>✅ Du hast die Entwürfe freigegeben.</strong><br/>Vielen Dank! Wir starten direkt mit der Umsetzung.</>
              : <><strong>📝 Deine Änderungswünsche sind angekommen.</strong><br/>Wir setzen sie um und melden uns sobald die neue Version bereit ist.</>}
          </div>
        )}

        {/* Creatives */}
        {creatives.length > 0 && (
          <section className="review-section">
            <h2 className="review-h2">🎨 Creatives ({creatives.length})</h2>
            <div className="review-creative-grid">
              {creatives.map((c, i) => (
                <div key={c.id} className="review-creative">
                  <button type="button" className="review-creative-thumb" onClick={() => setLightboxIndex(i)}>
                    {c.typ === 'video'
                      ? <><video src={c.bild_url} preload="metadata" muted playsInline /><span className="creative-play-icon" aria-hidden>▶</span></>
                      : <img src={c.bild_url} alt="" loading="lazy" />}
                    <span className={`format-badge format-${c.format}`}>
                      {c.typ === 'video' ? 'REEL' : (c.format === 'story' ? '9:16' : '1:1')}
                    </span>
                  </button>
                  <textarea
                    className="review-kommentar"
                    placeholder="Anmerkung zu diesem Creative (optional)…"
                    rows={2}
                    value={kommentare[`creative_${c.id}`] || ''}
                    onChange={e => setKommentar(`creative_${c.id}`, e.target.value)}
                    disabled={!!done}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Ad Copies */}
        {sortedAdcopies.length > 0 && (
          <section className="review-section">
            <h2 className="review-h2">✍️ Werbetexte</h2>
            <div className="review-adcopies">
              {sortedAdcopies.map(a => (
                <div key={a.id} className="review-adcopy">
                  <div className="review-adcopy-label">{STYLE_LABEL[a.stil] || a.stil}</div>
                  <pre className="review-adcopy-text">{a.text}</pre>
                  <textarea
                    className="review-kommentar"
                    placeholder="Anmerkung zu diesem Text (optional)…"
                    rows={2}
                    value={kommentare[`adcopy_${a.id}`] || ''}
                    onChange={e => setKommentar(`adcopy_${a.id}`, e.target.value)}
                    disabled={!!done}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Funnel & Sheet */}
        {(funnel_url || sheet_url) && (
          <section className="review-section">
            <h2 className="review-h2">📩 Bewerbungs-Funnel</h2>
            <div className="review-links">
              {funnel_url && (
                <a href={funnel_url} target="_blank" rel="noreferrer" className="review-link-btn primary">
                  → Funnel-Vorschau ansehen
                </a>
              )}
              {sheet_url && (
                <a href={sheet_url} target="_blank" rel="noreferrer" className="review-link-btn">
                  📊 Google Sheet öffnen
                </a>
              )}
            </div>
            <textarea
              className="review-kommentar"
              placeholder="Anmerkung zum Funnel (optional)…"
              rows={2}
              value={kommentare['funnel'] || ''}
              onChange={e => setKommentar('funnel', e.target.value)}
              disabled={!!done}
            />
          </section>
        )}

        {/* Allgemein */}
        <section className="review-section">
          <h2 className="review-h2">💬 Sonstige Anmerkungen</h2>
          <textarea
            className="review-kommentar review-kommentar-large"
            placeholder="Allgemeines Feedback, übergreifende Wünsche…"
            rows={4}
            value={kommentare['general'] || ''}
            onChange={e => setKommentar('general', e.target.value)}
            disabled={!!done}
          />
        </section>

        {!done && (
          <div className="review-actions">
            <button
              className="review-btn-secondary"
              onClick={() => submit('aenderungen')}
              disabled={busy}
            >
              {busy === 'aenderungen' ? 'Sende…' : '📝 Änderungswünsche senden'}
            </button>
            <button
              className="review-btn-primary"
              onClick={() => submit('freigegeben')}
              disabled={busy}
            >
              {busy === 'freigegeben' ? 'Sende…' : '✅ Alles freigeben'}
            </button>
          </div>
        )}
      </main>

      <footer className="review-footer">
        Made with ❤️ by <a href={brand.website} target="_blank" rel="noreferrer">{brand.name}</a> · {brand.footer}
      </footer>

      {lightboxIndex !== null && (
        <Lightbox
          items={creatives}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
