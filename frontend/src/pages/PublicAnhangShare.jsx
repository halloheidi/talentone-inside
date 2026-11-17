import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Öffentlicher, teilbarer Unterlagen-Link /u/:token.
// Kein Login, kein Portal-Token. Holt beim Aufruf eine frische Signed URL für
// GENAU diesen einen Anhang und leitet darauf weiter. Zeigt NUR die Datei,
// keine Bewerberdaten. Widerrufen/abgelaufen → klarer Hinweis (410).
const BASE = import.meta.env.VITE_API_BASE || '/api';

export default function PublicAnhangShare() {
  const { token } = useParams();
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let abbruch = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/public/u/${token}?format=json`, { headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) { if (!abbruch) setFehler(data.error || 'Dieser Link ist nicht verfügbar.'); return; }
        window.location.replace(data.url);
      } catch {
        if (!abbruch) setFehler('Dieser Link ist nicht verfügbar.');
      }
    })();
    return () => { abbruch = true; };
  }, [token]);

  return (
    <div style={{ margin: 0, minHeight: '100vh', fontFamily: '-apple-system,Helvetica,Arial,sans-serif', background: '#f0efed', color: '#0a0a0a', display: 'flex' }}>
      <div style={{ maxWidth: 420, margin: '12vh auto', padding: '28px 26px', background: '#fff', borderRadius: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>📄</div>
        {fehler
          ? <><h1 style={{ fontSize: 17, margin: '0 0 8px' }}>{fehler}</h1>
              <p style={{ fontSize: 13, color: '#5a5955', margin: 0 }}>Bitte wende dich an deinen Ansprechpartner, falls du die Unterlage benötigst.</p></>
          : <h1 style={{ fontSize: 17, margin: 0 }}>Unterlage wird geöffnet …</h1>}
      </div>
    </div>
  );
}
