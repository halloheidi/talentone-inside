import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { signIn, resetPassword, session } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) nav('/kunden', { replace: true });
  }, [session, nav]);

  function switchMode(next) {
    setMode(next);
    setError('');
    setInfo('');
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await resetPassword(email);
        setInfo('Wenn ein Konto existiert, haben wir dir einen Reset-Link geschickt. Bitte prüfe dein Postfach.');
      } else {
        await signIn(email, password);
        nav('/kunden', { replace: true });
      }
    } catch (err) {
      setError(err.message || (mode === 'forgot' ? 'Reset-Link konnte nicht gesendet werden.' : 'Login fehlgeschlagen.'));
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
        <h1 className="login-title">Inside</h1>
        <p className="login-sub">
          {mode === 'forgot'
            ? 'Passwort zurücksetzen · Reset-Link anfordern'
            : 'Internes Kampagnen-Tool · Mitarbeiter-Login'}
        </p>

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>

        {mode === 'login' && (
          <label className="field">
            <span>Passwort</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </label>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-success">{info}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {mode === 'forgot'
            ? (busy ? 'Senden…' : 'Reset-Link senden')
            : (busy ? 'Anmelden…' : 'Anmelden')}
        </button>

        <button
          type="button"
          className="login-link"
          onClick={() => switchMode(mode === 'forgot' ? 'login' : 'forgot')}
        >
          {mode === 'forgot' ? '← Zurück zum Login' : 'Passwort vergessen?'}
        </button>
      </form>
    </div>
  );
}
