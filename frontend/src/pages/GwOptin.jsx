import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Etappe 3: öffentliche Bestätigungsseite für die Gesellenwerk-Vormerkung.
// Schlicht, Gesellenwerk-Branding. Kein Login, kein Portal-Bezug, keine Kundendaten.
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

const Logo = () => (
  <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: '#fff' }}>
    Gesellen<span style={{ color: '#d4ff00' }}>werk</span>
  </span>
);

export default function GwOptin() {
  const { token } = useParams();
  const [state, setState] = useState('loading'); // loading | ready | done | error | expired
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApi(`/gw-optin/${token}`)
      .then(d => {
        if (cancelled) return;
        setInfo(d);
        if (d.bereits_bestaetigt) setState('done');
        else if (d.abgelaufen) setState('expired');
        else setState('ready');
      })
      .catch(e => { if (!cancelled) { setMsg(e.message); setState('error'); } });
    return () => { cancelled = true; };
  }, [token]);

  async function bestaetigen() {
    setBusy(true);
    try {
      await publicApi(`/gw-optin/${token}/bestaetigen`, { method: 'POST', body: {} });
      setState('done');
    } catch (e) {
      setMsg(e.message);
      setState(e.message?.toLowerCase().includes('abgelaufen') ? 'expired' : 'error');
    } finally { setBusy(false); }
  }

  const vorname = info?.vorname ? ` ${info.vorname}` : '';

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 18, maxWidth: 440, width: '100%', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ background: '#0a0a0a', padding: '22px 28px' }}><Logo /></div>
        <div style={{ padding: 28 }}>
          {state === 'loading' && <p style={{ color: '#5a5955' }}>Einen Moment…</p>}

          {state === 'ready' && (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Hallo{vorname}, dürfen wir dich vormerken?</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5a5955', margin: '0 0 10px' }}>
                Über Gesellenwerk vermitteln wir Fachkräfte im Handwerk an passende Betriebe. Mit deiner Bestätigung dürfen wir uns bei dir melden, sobald ein Betrieb in deiner Region eine passende Stelle hat.
              </p>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: '#9a9994', margin: '0 0 20px' }}>
                Es entstehen dir keine Kosten und keine Verpflichtung. Deine Daten verwenden wir ausschließlich zur Vermittlung passender Stellen; du kannst der Vormerkung jederzeit widersprechen.
              </p>
              <button onClick={bestaetigen} disabled={busy}
                style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '13px 22px', borderRadius: 100, fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%' }}>
                {busy ? 'Einen Moment…' : 'Ja, vormerken'}
              </button>
            </>
          )}

          {state === 'done' && (
            <>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Danke{vorname}!</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5a5955', margin: 0 }}>
                Du bist jetzt im Gesellenwerk-Pool vorgemerkt. Wir melden uns, sobald ein passender Betrieb in deiner Region sucht.
              </p>
            </>
          )}

          {state === 'expired' && (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>Link abgelaufen</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5a5955', margin: 0 }}>
                Dieser Bestätigungslink ist nicht mehr gültig. Melde dich gerne direkt bei uns, wenn du im Gesellenwerk-Pool bleiben möchtest.
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>Da ist etwas schiefgelaufen</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#c1272d', margin: 0 }}>{msg || 'Der Link ist ungültig.'}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
