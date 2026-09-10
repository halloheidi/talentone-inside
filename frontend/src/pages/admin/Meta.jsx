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

  // Werbekonten / Zuordnung
  const [kunden, setKunden] = useState([]);
  const [konten, setKonten] = useState([]);          // gespeicherte Zuordnungen
  const [adaccounts, setAdaccounts] = useState(null); // null = noch nicht aus Meta geladen
  const [adErr, setAdErr] = useState('');
  const [adBusy, setAdBusy] = useState(false);
  const [drafts, setDrafts] = useState({});          // konto_id -> { typ, kunde_id }
  const [savingKonto, setSavingKonto] = useState(null);

  // Nicht zugeordnete Kampagnen
  const [projekte, setProjekte] = useState([]);
  const [kampagnen, setKampagnen] = useState([]);
  const [kampSel, setKampSel] = useState({});        // meta_campaign_id -> projekt_id
  const [savingKamp, setSavingKamp] = useState(null);
  const [matchBusy, setMatchBusy] = useState(false);

  async function load() {
    try { setStatus(await api('/meta/status')); }
    catch (e) { setErr(e.body?.error || e.message); }
  }
  async function loadKonten() {
    try { const r = await api('/meta/konten'); setKonten(r.konten || []); }
    catch (e) { setErr(e.body?.error || e.message); }
  }
  async function loadKampagnen() {
    try { const r = await api('/meta/kampagnen/nicht-zugeordnet'); setKampagnen(r.kampagnen || []); }
    catch (e) { setErr(e.body?.error || e.message); }
  }
  useEffect(() => {
    load();
    loadKonten();
    loadKampagnen();
    api('/kunden').then(r => setKunden(r.kunden || [])).catch(() => {});
    api('/projekte').then(r => setProjekte(r.projekte || [])).catch(() => {});
  }, []);

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

  // ── Werbekonten ──
  async function ladeAdaccounts() {
    setAdBusy(true); setAdErr(''); setMsg('');
    try {
      const r = await api('/meta/adaccounts');
      setAdaccounts(r.accounts || []);
      await loadKonten();
      setMsg(`${(r.accounts || []).length} Werbekonten aus Meta geladen.`);
    } catch (e) {
      // 409 (kein Token) / 502 → Fehlertext prominent im Klartext (Token-Live-Verifikation)
      const text = e.body?.error || e.message;
      const code = e.body?.code ? ` (${e.body.code})` : '';
      setAdErr(`Token ungültig oder Meta-Fehler${code}: ${text}`);
    }
    finally { setAdBusy(false); }
  }

  async function speichereKonto(row, d) {
    if (!d.typ) { setErr('Bitte einen Konto-Typ wählen.'); return; }
    if (d.typ === 'exklusiv' && !d.kunde_id) { setErr('Exklusiv-Konto braucht einen zugeordneten Kunden.'); return; }
    setSavingKonto(row.konto_id); setErr(''); setMsg('');
    try {
      await api(`/meta/konten/${encodeURIComponent(row.konto_id)}`, {
        method: 'PUT',
        body: { name: row.name || '', typ: d.typ, kunde_id: d.typ === 'exklusiv' ? d.kunde_id : null },
      });
      setMsg('Konto-Zuordnung gespeichert.');
      await loadKonten();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setSavingKonto(null); }
  }
  async function entferneKonto(row) {
    if (!confirm(`Zuordnung für „${row.name || row.konto_id}" wirklich entfernen?`)) return;
    setSavingKonto(row.konto_id); setErr(''); setMsg('');
    try {
      await api(`/meta/konten/${encodeURIComponent(row.konto_id)}`, { method: 'DELETE' });
      setDrafts(p => { const n = { ...p }; delete n[row.konto_id]; return n; });
      setMsg('Zuordnung entfernt.');
      await loadKonten();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setSavingKonto(null); }
  }

  // ── Kampagnen ──
  async function zuordneKampagne(kamp, projektId) {
    if (!projektId) return;
    setSavingKamp(kamp.meta_campaign_id); setErr(''); setMsg('');
    try {
      await api(`/meta/kampagnen/${encodeURIComponent(kamp.meta_campaign_id)}/zuordnung`, {
        method: 'PUT', body: { projekt_id: projektId },
      });
      setMsg('Kampagne zugeordnet.');
      await loadKampagnen();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setSavingKamp(null); }
  }
  async function matchingLaufen() {
    setMatchBusy(true); setErr(''); setMsg('');
    try {
      await api('/meta/match', { method: 'POST' });
      setMsg('Matching gelaufen.');
      await Promise.all([loadKampagnen(), loadKonten()]);
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setMatchBusy(false); }
  }

  const gesetzt = !!status?.token_gesetzt;
  const sync = status?.sync?.last_result;

  // Werbekonten aus Meta (falls geladen) mit gespeicherten Zuordnungen zusammenführen.
  const kontoMap = new Map();
  (adaccounts || []).forEach(a => kontoMap.set(a.konto_id, { ...a }));
  konten.forEach(k => {
    const ex = kontoMap.get(k.konto_id);
    kontoMap.set(k.konto_id, { ...(ex || {}), ...k, name: ex?.name || k.name });
  });
  const kontoRows = [...kontoMap.values()];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div className="card">
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

      {/* ══ Werbekonten ══ */}
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Werbekonten</h2>
        <p className="section-sub">
          Ordne jedem Werbekonto einen Typ zu: <strong>Exklusiv für Kunde</strong> (das Konto gehört einem Kunden;
          seine Projekte erben es automatisch) oder <strong>Pool-Konto</strong> (mehrere Kunden; die Zuordnung
          erfolgt dann pro Kampagne über Namens-Matching).
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn-primary btn-sm" onClick={ladeAdaccounts} disabled={adBusy}>
            {adBusy ? 'Lade…' : '📥 Konten aus Meta laden'}
          </button>
        </div>

        {adErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{adErr}</div>}

        {kontoRows.length === 0
          ? <p className="pane-hint" style={{ marginTop: 0 }}>
              {adaccounts === null
                ? 'Noch keine Werbekonten geladen. Klicke „Konten aus Meta laden".'
                : 'Meta hat keine Werbekonten zurückgegeben.'}
            </p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {kontoRows.map(row => {
                const d = drafts[row.konto_id] || { typ: row.typ || '', kunde_id: row.kunde_id || '' };
                const setD = next => setDrafts(p => ({ ...p, [row.konto_id]: next }));
                const gespeichert = konten.some(k => k.konto_id === row.konto_id);
                const rowBusy = savingKonto === row.konto_id;
                const dirty = d.typ !== (row.typ || '') || (d.kunde_id || '') !== (row.kunde_id || '');
                return (
                  <div key={row.konto_id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{row.name || '(ohne Name)'}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                      {row.konto_id}
                      {row.status_label ? ` · ${row.status_label}` : ''}
                      {row.currency ? ` · ${row.currency}` : ''}
                      {gespeichert && row.typ === 'exklusiv' && ` · exklusiv → ${row.kunde_name || row.kunde_id || '?'}`}
                      {gespeichert && row.typ === 'pool' && ' · Pool-Konto'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="cell-input"
                        style={{ maxWidth: 220 }}
                        value={d.typ}
                        disabled={rowBusy}
                        onChange={e => {
                          const typ = e.target.value;
                          setD({ typ, kunde_id: typ === 'exklusiv' ? d.kunde_id : '' });
                        }}
                      >
                        <option value="">— Typ wählen —</option>
                        <option value="exklusiv">Exklusiv für Kunde</option>
                        <option value="pool">Pool-Konto (mehrere Kunden)</option>
                      </select>
                      {d.typ === 'exklusiv' && (
                        <select
                          className="cell-input"
                          style={{ maxWidth: 260 }}
                          value={d.kunde_id || ''}
                          disabled={rowBusy}
                          onChange={e => setD({ ...d, kunde_id: e.target.value || '' })}
                        >
                          <option value="">— Kunde wählen —</option>
                          {kunden.map(k => <option key={k.id} value={k.id}>{k.firmenname || '(ohne Name)'}</option>)}
                        </select>
                      )}
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => speichereKonto(row, d)}
                        disabled={rowBusy || !dirty || !d.typ || (d.typ === 'exklusiv' && !d.kunde_id)}
                      >
                        {rowBusy ? 'Speichere…' : 'Speichern'}
                      </button>
                      {gespeichert && (
                        <button className="btn-ghost btn-sm btn-danger" onClick={() => entferneKonto(row)} disabled={rowBusy}>
                          Entfernen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        <div className="alert" style={{ marginTop: 14, background: '#eef4ff', color: '#274690', fontSize: 13 }}>
          💡 Empfohlene Kampagnen-Benennung für zuverlässiges Pool-Matching:
          {' '}<strong>„[Kundenname] – [Stelle]"</strong> — der Kundenname wird beim Matching priorisiert.
        </div>
      </div>

      {/* ══ Nicht zugeordnete Kampagnen ══ */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>Nicht zugeordnete Kampagnen</h2>
          <button className="btn-ghost btn-sm" onClick={matchingLaufen} disabled={matchBusy}>
            {matchBusy ? 'Matching läuft…' : '🔁 Matching erneut laufen'}
          </button>
        </div>

        {kampagnen.length === 0
          ? <p className="pane-hint" style={{ marginTop: 12 }}>Alle Kampagnen zugeordnet.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {kampagnen.map(kamp => {
                const kundeProjekte = kamp.kunde_id ? projekte.filter(p => p.kunde_id === kamp.kunde_id) : [];
                const andere = projekte.filter(p => !kamp.kunde_id || p.kunde_id !== kamp.kunde_id);
                const defaultSel = kundeProjekte[0]?.id || '';
                const sel = kampSel[kamp.meta_campaign_id] ?? defaultSel;
                const rowBusy = savingKamp === kamp.meta_campaign_id;
                const projLabel = p => `${p.projekt || '(Unbenannt)'}${p.gesuchte_positionen ? ` — ${p.gesuchte_positionen}` : ''}`;
                return (
                  <div key={kamp.meta_campaign_id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{kamp.name || '(ohne Name)'}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                      Werbekonto {kamp.werbekonto_id || '?'}
                      {kamp.effective_status ? ` · ${kamp.effective_status}` : ''}
                      {kamp.kunde_name ? ` · Hinweis: ${kamp.kunde_name}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="cell-input"
                        style={{ maxWidth: 360, flex: 1 }}
                        value={sel}
                        disabled={rowBusy}
                        onChange={e => setKampSel(p => ({ ...p, [kamp.meta_campaign_id]: e.target.value }))}
                      >
                        <option value="">— Projekt wählen —</option>
                        {kundeProjekte.length > 0 && (
                          <optgroup label={`Projekte von ${kamp.kunde_name || 'diesem Kunden'}`}>
                            {kundeProjekte.map(p => <option key={p.id} value={p.id}>{projLabel(p)}</option>)}
                          </optgroup>
                        )}
                        <optgroup label={kundeProjekte.length > 0 ? 'Weitere Projekte' : 'Alle Projekte'}>
                          {andere.map(p => <option key={p.id} value={p.id}>{projLabel(p)}</option>)}
                        </optgroup>
                      </select>
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => zuordneKampagne(kamp, sel)}
                        disabled={rowBusy || !sel}
                      >
                        {rowBusy ? 'Ordne zu…' : 'Zuordnen'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
