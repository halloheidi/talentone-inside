import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import FunnelView from '../components/FunnelView.jsx';

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

// Lädt Meta-Pixel-Snippet einmal pro Pixel-ID, feuert PageView.
function loadMetaPixel(pixelId) {
  if (!pixelId || window.fbq) return;
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

export default function PublicFunnel() {
  const { funnelId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    publicApi(`/funnel/${funnelId}`)
      .then(res => {
        // Externer Funnel: sofort redirect
        if (res.redirect_to) {
          window.location.replace(res.redirect_to);
          return;
        }
        setData(res);
        if (res.funnel?.pixel_id) loadMetaPixel(res.funnel.pixel_id);
      })
      .catch(err => setError(err.message));
  }, [funnelId]);

  async function onSubmit(payload) {
    await publicApi(`/funnel/${funnelId}/bewerbung`, { method: 'POST', body: payload });
    // Pixel-Event nur bei NICHT-KO-Submit
    if (!payload.ko_kriterium && window.fbq && data?.funnel?.conversion_ziel) {
      const evt = data.funnel.conversion_ziel;
      const standard = ['Lead', 'CompleteRegistration', 'SubmitApplication'];
      if (standard.includes(evt)) window.fbq('track', evt);
      else window.fbq('trackCustom', evt);
    }
  }

  if (error) {
    return (
      <div className="public-page">
        <div className="public-card">
          <div className="public-brand"><span>Talent</span><span className="brand-accent">One</span></div>
          <h1 className="public-title">Hoppla.</h1>
          <p className="public-sub">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="public-page"><div className="public-card">Lade…</div></div>;

  return (
    <div className="public-funnel-wrap">
      <FunnelView funnel={data.funnel} job={data.job} kunde={data.kunde} onSubmit={onSubmit} />
    </div>
  );
}
