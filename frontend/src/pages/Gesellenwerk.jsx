import { useEffect, useMemo, useState } from 'react';
import { api, downloadAuthed } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';

// Etappe 3: Gesellenwerk-Pool (intern). Reine interne Ansicht aller Vormerkungen.
// Gewerk/Wohnort werden serverseitig beim Lesen aus Stelle/Funnel-Antwort abgeleitet.
// Niemals über Portal/Token-Zugänge — nur hinter Inside-Login.

const TABS = [
  { key: 'vorgeschlagen', label: 'Zu prüfen' },
  { key: 'vorgemerkt', label: 'Vorgemerkt' },
  { key: 'uebertragen', label: 'Übertragen' },
  { key: 'zurueckgezogen', label: 'Zurückgezogen' },
];

function einwilligungText(v) {
  if (!v.einwilligung) return { txt: 'fehlt', color: '#9a9994' };
  if (v.einwilligung_art === 'telefon') return { txt: '✓ Telefon', color: '#166534' };
  if (v.einwilligung_art === 'optin_mail') return { txt: '✓ Mail', color: '#166534' };
  return { txt: '✓', color: '#166534' };
}

export default function Gesellenwerk() {
  const [list, setList] = useState([]);
  const [gewerke, setGewerke] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('vorgeschlagen');
  const [fEinwilligung, setFEinwilligung] = useState('alle');  // alle|ja|nein
  const [fGewerk, setFGewerk] = useState('alle');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api('/gesellenwerk');
      setList(r.vormerkungen || []);
      setGewerke(r.gewerke || []);
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = {}; for (const t of TABS) c[t.key] = 0;
    for (const v of list) if (c[v.status] != null) c[v.status]++;
    return c;
  }, [list]);

  const gefiltert = useMemo(() => {
    return list.filter(v => v.status === tab)
      .filter(v => fEinwilligung === 'alle' || (fEinwilligung === 'ja' ? v.einwilligung : !v.einwilligung))
      .filter(v => fGewerk === 'alle' || v.gewerk === fGewerk);
  }, [list, tab, fEinwilligung, fGewerk]);

  async function act(id, fn) {
    setBusyId(id);
    try { await fn(); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  }
  const vormerken = v => act(v.id, () => api(`/gesellenwerk/${v.id}/vormerken`, { method: 'PATCH' }));
  const zurueckziehen = v => { if (window.confirm(`${v.name} aus dem Pool zurückziehen?`)) act(v.id, () => api(`/gesellenwerk/${v.id}/zurueckziehen`, { method: 'PATCH' })); };
  const optinMail = v => {
    if (!v.email) { alert('Kein E-Mail-Kontakt für diesen Kandidaten hinterlegt.'); return; }
    if (window.confirm(`Opt-in-Mail an ${v.name} (${v.email}) senden?`)) act(v.id, () => api(`/gesellenwerk/${v.id}/optin-mail`, { method: 'POST' }));
  };
  const notizBearbeiten = v => {
    const neu = window.prompt('Notiz bearbeiten:', v.notiz || '');
    if (neu === null) return;
    act(v.id, () => api(`/gesellenwerk/${v.id}/notiz`, { method: 'PATCH', body: { notiz: neu } }));
  };

  return (
    <div>
      <PageContainer wide />
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="page-title">Gesellenwerk-Pool</h1>
          <p className="page-sub">Intern vorgemerkte Kandidaten für das Handwerks-Jobportal. Gewerk aus der Stelle, Wohnort aus der Funnel-Antwort.</p>
        </div>
        <button onClick={() => downloadAuthed('/gesellenwerk/export.csv', `gesellenwerk-pool-${new Date().toISOString().slice(0, 10)}.csv`)}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
          ↓ CSV-Export
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {TABS.map(t => {
          const aktiv = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              fontSize: 13, padding: '6px 13px', borderRadius: 100, cursor: 'pointer',
              border: aktiv ? '1.5px solid #0a0a0a' : '1px solid #ececea',
              background: aktiv ? '#0a0a0a' : '#fff', color: aktiv ? '#fff' : '#0a0a0a', fontWeight: aktiv ? 700 : 500,
            }}>{t.label} <span style={{ opacity: 0.7 }}>({counts[t.key] || 0})</span></button>
          );
        })}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#5a5955' }}>Einwilligung:&nbsp;
          <select value={fEinwilligung} onChange={e => setFEinwilligung(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6 }}>
            <option value="alle">alle</option><option value="ja">vorhanden</option><option value="nein">fehlt</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: '#5a5955' }}>Gewerk:&nbsp;
          <select value={fGewerk} onChange={e => setFGewerk(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, maxWidth: 240 }}>
            <option value="alle">alle</option>
            {gewerke.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="card empty">Lade…</div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : gefiltert.length === 0 ? (
        <div className="card empty"><h2>Keine Einträge</h2><p>In dieser Ansicht sind keine Vormerkungen.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, width: '100%' }}>
              <thead>
                <tr>
                  <th>Name</th><th>Gewerk</th><th>Wohnort</th><th>Ursprungskunde</th>
                  <th>Einwilligung</th><th>Vorgemerkt</th><th>Notiz</th><th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map(v => {
                  const e = einwilligungText(v);
                  const disabled = busyId === v.id;
                  return (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.name}{v.email ? <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 400 }}>{v.email}</div> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{v.gewerk}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{v.wohnort}</td>
                      <td>{v.ursprungskunde}</td>
                      <td style={{ whiteSpace: 'nowrap', color: e.color, fontWeight: 600, fontSize: 12 }}>{e.txt}
                        {v.optin_gesendet_am && !v.einwilligung ? <div style={{ fontSize: 10, color: '#9a9994', fontWeight: 400 }}>Opt-in {new Date(v.optin_gesendet_am).toLocaleDateString('de-DE')} gesendet</div> : null}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {v.vorgemerkt_am ? new Date(v.vorgemerkt_am).toLocaleDateString('de-DE') : '—'}
                        {v.vorgemerkt_von ? <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{v.vorgemerkt_von}</div> : null}
                        {v.quelle === 'kundenabsage' ? <div style={{ fontSize: 10, color: '#b45309' }}>aus Kundenabsage</div> : null}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 240 }}>{v.notiz ? <span title={v.notiz}>{v.notiz}</span> : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {v.status === 'vorgeschlagen' && <button disabled={disabled} onClick={() => vormerken(v)} style={btn('#0a0a0a', '#fff')}>Vormerken</button>}
                          {(v.status === 'vorgeschlagen' || v.status === 'vorgemerkt') && !v.einwilligung && <button disabled={disabled} onClick={() => optinMail(v)} style={btn('#fff', '#0a0a0a')}>Opt-in-Mail</button>}
                          <button disabled={disabled} onClick={() => notizBearbeiten(v)} style={btn('#fff', '#0a0a0a')}>Notiz</button>
                          {v.status !== 'zurueckgezogen' && <button disabled={disabled} onClick={() => zurueckziehen(v)} style={btn('#fff', '#b91c1c')}>Zurückziehen</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--ink-4)', borderTop: '1px solid var(--line)' }}>
            {gefiltert.length} Eintrag{gefiltert.length === 1 ? '' : 'e'}
          </div>
        </div>
      )}
    </div>
  );
}

function btn(bg, color) {
  return { fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6, border: `1px solid ${color === '#fff' ? bg : '#e0e0dd'}`, background: bg, color, cursor: 'pointer', whiteSpace: 'nowrap' };
}
