import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

const BRANDING = {
  talentone: { name: 'TalentOne', primary: '#0a0a0a', accent: '#d4ff00', accentInk: '#0a0a0a',
    logo: <span>Talent<span style={{ color: '#d4ff00' }}>One</span></span> },
  nowagwirth: { name: 'Nowag & Wirth', primary: '#1a3a6c', accent: '#ffd966', accentInk: '#1a3a6c',
    logo: <img src="/nowagwirth-logo.png" alt="Nowag & Wirth" style={{ height: 30, background: '#fff', borderRadius: 6, padding: '4px 8px' }} /> },
};

const QUALITAET = [
  { key: 'sehr_gut', label: '😀 Sehr gut' },
  { key: 'okay', label: '🙂 Okay' },
  { key: 'zu_wenig', label: '😕 Zu wenig passende' },
];
const EINSTELLUNG = [
  { key: 'eingestellt', label: '🎉 Ja, eingestellt' },
  { key: 'gespraeche', label: '💬 Gespräche laufen' },
  { key: 'noch_nicht', label: '⏳ Noch nicht' },
];

export default function PublicFeedback() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const [sterne, setSterne] = useState(0);
  const [hover, setHover] = useState(0);
  const [qualitaet, setQualitaet] = useState('');
  const [einstellung, setEinstellung] = useState('');
  const [freitext, setFreitext] = useState('');

  useEffect(() => {
    publicApi(`/feedback/${token}`).then(setData).catch(e => setError(e.message));
  }, [token]);

  const kunde = data?.kunde;
  const brand = BRANDING[kunde?.agentur] || BRANDING.talentone;
  const theme = { '--fb-primary': brand.primary, '--fb-accent': brand.accent, '--fb-accent-ink': brand.accentInk };

  async function submit() {
    setError('');
    if (!(sterne >= 1)) { setError('Bitte vergib zuerst deine Sterne-Bewertung.'); return; }
    setBusy(true);
    try {
      await publicApi(`/feedback/${token}`, {
        method: 'POST',
        body: { sterne, qualitaet: qualitaet || undefined, einstellung: einstellung || undefined, freitext: freitext.trim() || undefined },
      });
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error && !data) {
    return <Shell brand={brand}><h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Hoppla.</h1><p style={{ color: '#5a5955' }}>{error}</p></Shell>;
  }
  if (!data) return <Shell brand={brand}><p>Lade…</p></Shell>;
  if (done) {
    return (
      <Shell brand={brand}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48 }}>🙏</div>
          <h1 style={{ fontSize: 24, margin: '10px 0 8px' }}>Vielen Dank!</h1>
          <p style={{ color: '#5a5955', lineHeight: 1.55 }}>{t(kunde,
            'Dein Feedback ist angekommen — es hilft uns, deine Kampagne weiter zu verbessern.',
            'Ihr Feedback ist angekommen — es hilft uns, Ihre Kampagne weiter zu verbessern.')}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell brand={brand} style={theme}>
      <h1 style={{ fontSize: 23, margin: '0 0 6px', letterSpacing: '-0.01em' }}>Kurzes Feedback</h1>
      <p style={{ color: '#5a5955', margin: '0 0 22px', lineHeight: 1.5, fontSize: 14.5 }}>
        {kunde?.ansprechpartner ? `Hallo ${kunde.ansprechpartner}! ` : ''}{t(kunde,
          'Deine Meinung dauert keine 60 Sekunden — danke, dass du dir kurz Zeit nimmst!',
          'Ihre Meinung dauert keine 60 Sekunden — danke, dass Sie sich kurz Zeit nehmen!')}
      </p>

      {/* Sterne */}
      <div style={{ marginBottom: 22 }}>
        <div style={fbLabel}>Wie zufrieden bist du insgesamt?</div>
        <div style={{ display: 'flex', gap: 6, fontSize: 40, lineHeight: 1, cursor: 'pointer', userSelect: 'none' }}>
          {[1, 2, 3, 4, 5].map(n => (
            <span key={n}
              onClick={() => setSterne(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              style={{ color: (hover || sterne) >= n ? '#f5a623' : '#d8d6d0', transition: 'color .1s' }}
              role="button" aria-label={`${n} Sterne`}
            >★</span>
          ))}
        </div>
      </div>

      {/* Qualität */}
      <FbChoice title="Wie beurteilst du die Qualität der Bewerbungen bisher?"
        options={QUALITAET} value={qualitaet} onChange={setQualitaet} />

      {/* Einstellung */}
      <FbChoice title="Konntest du schon Gespräche führen oder jemanden einstellen?"
        options={EINSTELLUNG} value={einstellung} onChange={setEinstellung} />

      {/* Freitext */}
      <div style={{ marginBottom: 22 }}>
        <div style={fbLabel}>Was können wir besser machen? <span style={{ fontWeight: 400, color: '#9a9994' }}>(optional)</span></div>
        <textarea value={freitext} onChange={e => setFreitext(e.target.value)} rows={3}
          placeholder="Deine Anmerkungen…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid #e2e0da', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      {error && <div style={{ background: '#fde8e8', color: '#9b1c1c', padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 14 }}>{error}</div>}

      <button onClick={submit} disabled={busy}
        style={{ width: '100%', padding: '15px', border: 'none', borderRadius: 100, fontSize: 16, fontWeight: 700,
          background: brand.accent, color: brand.accentInk, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Wird gesendet…' : 'Feedback absenden'}
      </button>
    </Shell>
  );
}

const fbLabel = { fontSize: 14.5, fontWeight: 700, color: '#0a0a0a', marginBottom: 10 };

function FbChoice({ title, options, value, onChange }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={fbLabel}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map(o => (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: 12, fontSize: 15, cursor: 'pointer',
              border: `2px solid ${value === o.key ? 'var(--fb-primary, #0a0a0a)' : '#e2e0da'}`,
              background: value === o.key ? '#faf9f6' : '#fff', fontWeight: value === o.key ? 700 : 500,
            }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Shell({ brand, children, style }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f0efed', padding: '24px 16px', ...style }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ padding: '4px 2px 18px', fontWeight: 700, fontSize: 18 }}>{brand.logo}</div>
        <div style={{ background: '#fff', borderRadius: 18, padding: '24px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
