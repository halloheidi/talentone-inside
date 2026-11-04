import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from './api.js';

// Für eingeloggte Inside-Nutzer: alte Public-Links (Portal/Bewerbungen) auf die
// interne Stelle umleiten. Token wird SERVERSEITIG aufgelöst
// (bewerbungen_token → Stelle, portal_token → Kunde, ?bewerbung → deren Stelle).
// Nicht eingeloggt → Status 'none', die Public-Seite bleibt unverändert.
//
// Rückgabe:
//   'checking' → Auth lädt noch ODER die Weiterleitung läuft (neutraler Ladebildschirm)
//   'none'     → kein Inside-Login → Public-Seite normal rendern
//   'failed'   → Inside-Login, aber Token nicht auflösbar → Public + Hinweisleiste
export function useInsidePublicRedirect(token, bewerbungId) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    if (loading) { setStatus('checking'); return; }
    if (!session) { setStatus('none'); return; }
    let cancel = false;
    setStatus('checking');
    const q = bewerbungId ? `?bewerbung=${encodeURIComponent(bewerbungId)}` : '';
    api(`/resolve-public-token/${encodeURIComponent(token)}${q}`)
      .then(r => {
        if (cancel) return;
        let target = null;
        if (r?.kunde_id && r?.job_id) {
          const bid = r.bewerbung_id || bewerbungId;
          target = `/kunden/${r.kunde_id}/jobs/${r.job_id}?tab=bewerber${bid ? `&bewerbung=${encodeURIComponent(bid)}` : ''}`;
        } else if (r?.kunde_id) {
          target = `/kunden/${r.kunde_id}`;
        }
        if (target) navigate(target, { replace: true });
        else setStatus('failed');
      })
      .catch(() => { if (!cancel) setStatus('failed'); });
    return () => { cancel = true; };
  }, [loading, session, token, bewerbungId, navigate]);

  return status;
}
