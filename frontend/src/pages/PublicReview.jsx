import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Lightbox from '../components/Lightbox.jsx';
import { t } from '../lib/anrede.js';

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
    // Sicherheits-Confirm vor der Freigabe — verhindert versehentliche Klicks.
    // Bei Aenderungswuenschen ist eine Nachfrage nicht noetig (Kunde hat ja
    // schon Text im Feld).
    if (status === 'freigegeben') {
      const ok = window.confirm(t(data?.kunde,
        'Möchtest du wirklich ALLE Entwürfe freigeben und die Kampagne live schalten?\n\n' +
        'Danach wird sofort mit der Umsetzung gestartet. Falls du noch Änderungen möchtest, ' +
        'klick stattdessen auf "Änderungswünsche senden".',
        'Möchten Sie wirklich ALLE Entwürfe freigeben und die Kampagne live schalten?\n\n' +
        'Danach wird sofort mit der Umsetzung gestartet. Falls Sie noch Änderungen möchten, ' +
        'klicken Sie stattdessen auf "Änderungswünsche senden".'
      ));
      if (!ok) return;
    }
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
          <p className="review-intro">{t(kunde,
            'Schau dir die ersten Entwürfe in Ruhe an. Bei Bedarf kannst du pro Element kommentieren und dann unten alles freigeben oder Änderungswünsche schicken.',
            'Schauen Sie sich die ersten Entwürfe in Ruhe an. Bei Bedarf können Sie pro Element kommentieren und dann unten alles freigeben oder Änderungswünsche schicken.')}</p>
        </div>

        {done && (
          <div className={`review-done review-done-${done}`}>
            {done === 'freigegeben'
              ? <><strong>✅ {t(kunde, 'Du hast die Entwürfe freigegeben.', 'Sie haben die Entwürfe freigegeben.')}</strong><br/>Vielen Dank! Wir starten direkt mit der Umsetzung.</>
              : <><strong>📝 {t(kunde, 'Deine Änderungswünsche sind angekommen.', 'Ihre Änderungswünsche sind angekommen.')}</strong><br/>Wir setzen sie um und melden uns sobald die neue Version bereit ist.</>}
          </div>
        )}

        {/* Vorherige Runden — einklappbar */}
        <VorherigeRunden runden={data.vorherige_runden || []} creatives={creatives} adcopies={adcopies} kunde={kunde} />

        {(data.review?.runde || 1) > 1 && !done && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e', fontSize: 13 }}>
            🔄 <strong>Runde {data.review.runde}</strong> — {t(kunde, 'Danke für dein Feedback!', 'Danke für Ihr Feedback!')} Wir haben die Entwürfe überarbeitet.
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

        {!done && (() => {
          const hasComments = Object.values(kommentare).some(v => (v || '').trim().length > 0);
          return (
            <>
              {hasComments && (
                <div className="review-comments-hint">
                  {t(kunde, 'Du hast Anmerkungen hinterlassen', 'Sie haben Anmerkungen hinterlassen')} — diese senden wir an unser Team zur Überarbeitung.
                </div>
              )}
              <div className="review-actions">
                <button
                  className={hasComments ? 'review-btn-primary' : 'review-btn-secondary'}
                  onClick={() => submit('aenderungen')}
                  disabled={busy}
                >
                  {busy === 'aenderungen' ? 'Sende…' : '📝 Änderungswünsche senden'}
                </button>
                {!hasComments && (
                  <button
                    className="review-btn-primary"
                    onClick={() => submit('freigegeben')}
                    disabled={busy}
                  >
                    {busy === 'freigegeben' ? 'Sende…' : '✅ Alles freigeben'}
                  </button>
                )}
              </div>
            </>
          );
        })()}
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

/**
 * „Dein Feedback aus Runde N" — einklappbar. Nur sichtbar, wenn es
 * mindestens eine vorherige abgeschlossene Runde gibt.
 */
function VorherigeRunden({ runden, creatives, adcopies, kunde }) {
  const [open, setOpen] = useState(false);
  const withKommentare = (runden || []).filter(r => r.kommentare && Object.keys(r.kommentare).length > 0);
  if (withKommentare.length === 0) return null;

  return (
    <section style={{ marginBottom: 20 }}>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        style={{
          background: 'transparent', border: '1px solid var(--rv-line, #ddd)',
          borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600,
          color: 'var(--rv-ink, #0a0a0a)',
        }}
      >
        <span>{open ? '▼' : '▶'}</span>
        {t(kunde, 'Dein Feedback aus ', 'Ihr Feedback aus ')}{withKommentare.length === 1 ? `Runde ${withKommentare[0].runde || 1}` : `${withKommentare.length} vorherigen Runden`}
      </button>
      {open && withKommentare.map(r => (
        <div key={r.id} style={{ marginTop: 10, padding: 14, borderRadius: 10, background: '#fafaf8', border: '1px solid var(--rv-line, #ddd)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rv-ink-3, #5a5955)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.04 }}>
            Runde {r.runde || 1} · {r.updated_at ? new Date(r.updated_at).toLocaleDateString('de-DE') : ''}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {Object.entries(r.kommentare || {}).filter(([, v]) => (v || '').trim()).map(([key, text]) => {
              let label = key;
              if (key === 'general' || key === 'allgemein') label = 'Allgemein';
              else if (key === 'funnel') label = 'Funnel';
              else if (key.startsWith('creative_')) {
                const id = key.slice('creative_'.length);
                const snap = r.kommentare_snapshot?.[key];
                const c = (snap && snap.bild_url) ? snap : (creatives || []).find(x => x.id === id);
                label = `Creative ${c?.format || ''}`.trim();
              } else if (key.startsWith('adcopy_')) {
                const id = key.slice('adcopy_'.length);
                const snap = r.kommentare_snapshot?.[key];
                const a = snap || (adcopies || []).find(x => x.id === id);
                label = `Ad-Copy ${a?.stil || ''}`.trim();
              }
              return (
                <li key={key} style={{ fontSize: 13 }}>
                  <strong style={{ color: 'var(--rv-ink-3, #5a5955)' }}>{label}:</strong>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
