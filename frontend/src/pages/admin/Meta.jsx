import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Admin: Meta-Integration (Phase 1, nur lesend). Hier den System-User-Token
// eintragen (ads_read, read_insights). Der Token wird NUR serverseitig gespeichert
// und nie zurückgegeben — der Status zeigt nur, ob gesetzt (+ letzte 4 Zeichen).
export default function Meta() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    try { setStatus(await api('/meta/status')); }
    catch (e) { setErr(e.body?.error || e.message); }
  }
  useEffect(() => { load(); }, []);

  async function speichern() {
    if (!token.trim()) { setErr('Bitte einen Token eingeben.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await api('/meta/token', { method: 'PUT', body: { token: token.trim() } });
      setToken('');
      setMsg('Token gespeichert.');
      await load();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setBusy(false); }
  }
  async function entfernen() {
    if (!confirm('Meta System User Token wirklich entfernen? Der Sync ist danach inaktiv.')) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api('/meta/token', { method: 'DELETE' }); setMsg('Token entfernt.'); await load(); }
    catch (e) { setErr(e.body?.error || e.message); }
    finally { setBusy(false); }
  }
  async function jetztSyncen(backfill) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/meta/sync', { method: 'POST', body: { backfill: !!backfill } });
      const res = r.result || {};
      setMsg(res.skipped
        ? `Übersprungen: ${res.reason}`
        : `Sync ok — ${res.konten} Konten, ${res.kampagnen} Kampagnen, ${res.insights} Insight-Tage${res.konto_fehler?.length ? `, ${res.konto_fehler.length} Kontofehler` : ''}.`);
      await load();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setBusy(false); }
  }

  const gesetzt = !!status?.token_gesetzt;
  const sync = status?.sync?.last_result;

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h1 className="section-title" style={{ marginTop: 0 }}>📊 Meta-Integration</h1>
      <p className="section-sub">
        Marketing-API (nur lesend). Trage hier den <strong>System-User-Token</strong> aus dem Business Manager
        ein — er braucht die Berechtigungen <code>ads_read</code> und <code>read_insights</code> sowie
        zugewiesene Werbekonten. Der Token wird ausschließlich serverseitig gespeichert.
      </p>

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="alert" style={{ marginBottom: 12, background: '#e7f6ec', color: '#0a5c2b' }}>{msg}</div>}

      <fieldset className="formular-section">
        <legend>System-User-Token</legend>
        <div style={{ marginBottom: 10, fontSize: 14 }}>
          Status:{' '}
          {gesetzt
            ? <span style={{ color: '#0a8043', fontWeight: 600 }}>✓ gesetzt (endet auf {status.token_hinweis}, Quelle: {status.token_quelle})</span>
            : <span style={{ color: '#b26b00', fontWeight: 600 }}>⚠️ nicht gesetzt — Sync inaktiv</span>}
        </div>
        <label className="field field-full">
          <span>{gesetzt ? 'Neuen Token eintragen (überschreibt)' : 'Token eintragen'}</span>
          <input
            type="password" autoComplete="off" value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="EAA…"
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn-primary btn-sm" onClick={speichern} disabled={busy || !token.trim()}>
            {busy ? 'Speichere…' : 'Token speichern'}
          </button>
          {gesetzt && <button className="btn-ghost btn-sm btn-danger" onClick={entfernen} disabled={busy}>Token entfernen</button>}
        </div>
      </fieldset>

      <fieldset className="formular-section">
        <legend>Sync</legend>
        <p className="pane-hint" style={{ marginTop: 0 }}>
          Lädt Kampagnen + Tages-Insights der hinterlegten Werbekonten. Läuft automatisch täglich um 05:00.
          {status?.backfill_ausstehend && ' Erstlauf: es wird 90 Tage rückwirkend geladen.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost btn-sm" onClick={() => jetztSyncen(false)} disabled={busy || !gesetzt}>
            🔄 Jetzt aktualisieren
          </button>
          <button className="btn-ghost btn-sm" onClick={() => jetztSyncen(true)} disabled={busy || !gesetzt}>
            ⏬ Backfill (90 Tage)
          </button>
        </div>
        {sync && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-3)' }}>
            Letzter Lauf: {status.sync.last_run_at ? new Date(status.sync.last_run_at).toLocaleString('de-DE') : '—'} ·{' '}
            {sync.skipped ? `übersprungen (${sync.reason})` : `${sync.konten ?? 0} Konten, ${sync.kampagnen ?? 0} Kampagnen, ${sync.insights ?? 0} Insight-Tage`}
          </div>
        )}
      </fieldset>
    </div>
  );
}
