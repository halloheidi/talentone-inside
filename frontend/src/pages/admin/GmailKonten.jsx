import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import PageContainer from '../../components/PageContainer.jsx';

export default function GmailKonten() {
  const [cfg, setCfg] = useState(null);
  const [konten, setKonten] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [redirect, setRedirect] = useState('');
  const [cid, setCid] = useState('');
  const [csec, setCsec] = useState('');
  const [rurl, setRurl] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api('/gmail/config').then(c => { setCfg(c); setRedirect(c.redirect || ''); setRurl(c.redirect || ''); }).catch(() => {});
    api('/gmail/konten').then(r => { setKonten(r.konten || []); setConfigured(r.configured); }).catch(() => {});
  }
  useEffect(() => {
    reload();
    const p = new URLSearchParams(window.location.search);
    if (p.get('verbunden')) setMsg({ ok: true, text: `Konto verbunden: ${p.get('verbunden')}` });
    if (p.get('fehler')) setMsg({ ok: false, text: `Verbindung fehlgeschlagen: ${p.get('fehler')}` });
    if (p.get('verbunden') || p.get('fehler')) window.history.replaceState({}, '', '/admin/gmail');
  }, []);

  async function saveCfg() {
    setBusy(true);
    try {
      if (cid.trim()) await api('/gmail/config/google_oauth_client_id', { method: 'PUT', body: { wert: cid.trim() } });
      if (csec.trim()) await api('/gmail/config/google_oauth_client_secret', { method: 'PUT', body: { wert: csec.trim() } });
      if (rurl.trim() && rurl.trim() !== redirect) await api('/gmail/config/google_oauth_redirect', { method: 'PUT', body: { wert: rurl.trim() } });
      setCid(''); setCsec(''); setMsg({ ok: true, text: 'OAuth-Konfiguration gespeichert.' }); reload();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }
  async function connect() {
    try { const { url } = await api('/gmail/oauth/start'); window.location.href = url; }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  async function disconnect(id, email) {
    if (!window.confirm(`Konto ${email} trennen?`)) return;
    try { await api(`/gmail/konten/${id}`, { method: 'DELETE' }); reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>📧 Gmail-Konten</h1>
      <p style={{ fontSize: 13, color: '#5a5955', marginTop: 0 }}>Für die „Wichtige Mails"-Kachel + Antwortvorschläge. Scopes: gmail.readonly, gmail.send, gmail.compose.</p>
      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <section style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>1. Google-OAuth-Client</h2>
        <p style={{ fontSize: 12.5, color: '#5a5955' }}>
          In der Google Cloud Console einen OAuth-2.0-Client (Typ „Web") anlegen, diese <strong>Redirect-URI</strong> autorisieren und Client-ID/Secret hier eintragen.
          Consent-Screen mit den drei Gmail-Scopes; bei nicht-interner App Test-Nutzer eintragen.
        </p>
        <div style={{ fontSize: 12.5, marginBottom: 8 }}>
          Status: Client-ID {cfg?.client_id?.gesetzt ? <b style={{ color: '#027a48' }}>✓ {cfg.client_id.hinweis} ({cfg.client_id.quelle})</b> : <b style={{ color: '#b42318' }}>fehlt</b>}
          {' · '} Secret {cfg?.client_secret?.gesetzt ? <b style={{ color: '#027a48' }}>✓ gesetzt</b> : <b style={{ color: '#b42318' }}>fehlt</b>}
        </div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Redirect-URI (in Google autorisieren)
          <input value={rurl} onChange={e => setRurl(e.target.value)} style={inp} />
        </label>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Client-ID
          <input value={cid} onChange={e => setCid(e.target.value)} placeholder="…apps.googleusercontent.com" style={inp} />
        </label>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Client-Secret
          <input type="password" value={csec} onChange={e => setCsec(e.target.value)} placeholder="neu eintragen…" style={inp} />
        </label>
        <button className="btn-primary" disabled={busy} onClick={saveCfg}>Konfiguration speichern</button>
      </section>

      <section style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>2. Verbundene Konten</h2>
        <button className="btn-primary" disabled={!configured} onClick={connect} style={{ marginBottom: 12 }}>+ Gmail-Konto verbinden</button>
        {!configured && <div style={{ fontSize: 12, color: '#b42318', marginBottom: 10 }}>Erst OAuth-Client oben speichern.</div>}
        {konten.length === 0 ? <div style={{ fontSize: 13, color: '#9a9994', fontStyle: 'italic' }}>Noch keine Konten verbunden.</div>
          : konten.map(k => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f0efed' }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>{k.email} {k.status !== 'aktiv' && <span style={{ color: '#b42318', fontSize: 11 }}>({k.status})</span>}</span>
              <span style={{ fontSize: 11, color: '#9a9994' }}>verbunden {new Date(k.connected_at).toLocaleDateString('de-DE')}</span>
              <button className="btn-secondary" onClick={() => disconnect(k.id, k.email)}>Trennen</button>
            </div>
          ))}
      </section>
    </PageContainer>
  );
}
const inp = { width: '100%', padding: '7px 9px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13, marginTop: 3 };
