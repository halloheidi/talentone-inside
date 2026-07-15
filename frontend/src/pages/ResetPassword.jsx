import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { supabase } from '../lib/supabase.js';

export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);      // Recovery-Session aus dem Link vorhanden?
  const [linkError, setLinkError] = useState(''); // z.B. Link abgelaufen
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Fehler aus dem Link (abgelaufen/ungültig) landen im URL-Hash.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errDesc = hash.get('error_description') || hash.get('error');
    if (errDesc) setLinkError(errDesc.replace(/\+/g, ' '));

    // supabase-js baut aus dem Recovery-Token (detectSessionInUrl) eine Session auf.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY' || s) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) { setError('Mindestens 8 Zeichen.'); return; }
    if (pw !== pw2) { setError('Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    try {
      await updatePassword(pw);
      setDone(true);
      setTimeout(() => nav('/kunden', { replace: true }), 1500);
    } catch (err) {
      setError(err.message || 'Passwort konnte nicht gesetzt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span>Talent</span>
          <span className="brand-accent">One</span>
        </div>
        <h1 className="login-title">Neues Passwort</h1>
        <p className="login-sub">Inside · Passwort zurücksetzen</p>

        {linkError && (
          <>
            <div className="alert alert-error">
              Der Link ist ungültig oder abgelaufen: {linkError}
            </div>
            <button type="button" className="btn-primary" onClick={() => nav('/login', { replace: true })}>
              Zurück zum Login
            </button>
          </>
        )}

        {!linkError && done && (
          <div className="alert alert-success">
            Passwort gesetzt. Du wirst weitergeleitet…
          </div>
        )}

        {!linkError && !done && !ready && (
          <p className="login-sub">
            Öffne diese Seite über den Link aus der Reset-E-Mail, um ein neues Passwort zu setzen.
          </p>
        )}

        {!linkError && !done && ready && (
          <>
            <label className="field">
              <span>Neues Passwort</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw}
                onChange={e => setPw(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Passwort wiederholen</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={pw2}
                onChange={e => setPw2(e.target.value)}
              />
            </label>

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Speichern…' : 'Passwort setzen'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
