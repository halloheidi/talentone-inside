import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

// Admin: Meta-Pixel verwalten (anlegen, bearbeiten, deaktivieren, Fallback) +
// Vorschlags-Bericht je Stelle. Daten liegen in talentone_pixel; Zuordnung je
// Stelle passiert im Bereich „Stelle". Hier wird NICHTS umgehängt.
const GEWERKE = [
  ['shk_kaelte', 'SHK & Kälte'],
  ['elektro', 'Elektro'],
  ['maler', 'Maler & Lackierer'],
  ['bau_tiefbau', 'Bau & Tiefbau'],
  ['fenster_ausbau', 'Fenster & Ausbau'],
  ['kfz', 'KFZ'],
  ['land_hof', 'Land & Hof'],
  ['gala', 'GaLa'],
  ['kaufmaennisch', 'Kaufmännisch & Vertrieb'],
  ['handwerk_allgemein', 'Handwerker Allgemein'],
];
const gewerkLabel = g => (GEWERKE.find(([k]) => k === g) || [, g])[1];

const LEER = { name: '', gewerk: 'shk_kaelte', meta_pixel_id: '', aktiv: true, fallback: false, notiz: '' };

export default function PixelAdmin() {
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);     // Pixel-Objekt in Bearbeitung oder LEER (neu)
  const [busy, setBusy] = useState(false);
  const [bericht, setBericht] = useState(null);
  const [berichtBusy, setBerichtBusy] = useState(false);

  async function load() {
    setError('');
    try { const r = await api('/pixel'); setList(r.pixel || []); }
    catch (e) { setError(e.body?.error || e.message); }
  }
  useEffect(() => { load(); }, []);

  async function speichern() {
    if (!edit.name?.trim() || !edit.meta_pixel_id?.trim()) { setError('Name und Pixel-ID sind Pflicht.'); return; }
    setBusy(true); setError('');
    try {
      const body = { name: edit.name.trim(), gewerk: edit.gewerk, meta_pixel_id: edit.meta_pixel_id.trim(), aktiv: !!edit.aktiv, fallback: !!edit.fallback, notiz: edit.notiz?.trim() || null };
      if (edit.id) await api(`/pixel/${edit.id}`, { method: 'PATCH', body });
      else await api('/pixel', { method: 'POST', body });
      setEdit(null); await load();
    } catch (e) { setError(e.body?.error || e.message); }
    finally { setBusy(false); }
  }

  async function patch(id, body) {
    setError('');
    try { await api(`/pixel/${id}`, { method: 'PATCH', body }); await load(); }
    catch (e) { setError(e.body?.error || e.message); }
  }

  async function ladeBericht() {
    setBerichtBusy(true); setError('');
    try { const r = await api('/pixel/bericht'); setBericht(r.zeilen || []); }
    catch (e) { setError(e.body?.error || e.message); }
    finally { setBerichtBusy(false); }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 className="page-title">🎯 Meta-Pixel</h1>
      <p className="pane-hint" style={{ marginBottom: 16 }}>
        Ein Pixel je Gewerk. Die Zuordnung zur Stelle passiert im Bereich „Stelle" (mit Gewerk-Vorschlag).
        Genau ein Pixel ist der <strong>Fallback</strong> für alles ohne passendes Gewerk.
        Laufende Kampagnen bleiben beim bisherigen Pixel bis zum nächsten Kampagnenstart.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Pixel ({list.length})</h2>
          <button className="btn-primary btn-sm" onClick={() => setEdit({ ...LEER })}>+ Neuer Pixel</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
              <th style={{ padding: '6px 8px' }}>Name</th><th style={{ padding: '6px 8px' }}>Gewerk</th>
              <th style={{ padding: '6px 8px' }}>Pixel-ID</th><th style={{ padding: '6px 8px' }}>Stellen</th>
              <th style={{ padding: '6px 8px' }}>Status</th><th style={{ padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--line)', opacity: p.aktiv ? 1 : 0.55 }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '6px 8px' }}>{gewerkLabel(p.gewerk)}</td>
                <td style={{ padding: '6px 8px' }}><code>{p.meta_pixel_id}</code></td>
                <td style={{ padding: '6px 8px' }}>{p.anzahl_stellen}</td>
                <td style={{ padding: '6px 8px' }}>
                  {p.fallback && <span className="badge" style={{ background: '#eef2ff', color: '#3730a3', padding: '1px 7px', borderRadius: 100, marginRight: 4 }}>Fallback</span>}
                  {p.aktiv ? <span style={{ color: '#1a7f37' }}>aktiv</span> : <span style={{ color: '#c1272d' }}>inaktiv</span>}
                </td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...p })}>Bearbeiten</button>
                  {!p.fallback && (
                    <button className="btn-ghost btn-sm" title="Zum Fallback machen" onClick={() => patch(p.id, { fallback: true })}>↳ Fallback</button>
                  )}
                  {!p.fallback && (
                    <button className="btn-ghost btn-sm" onClick={() => patch(p.id, { aktiv: !p.aktiv })}>{p.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} style={{ padding: 10, color: 'var(--ink-3)' }}>Noch keine Pixel.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{edit.id ? 'Pixel bearbeiten' : 'Neuer Pixel'}</h2>
          <div className="form-grid">
            <label className="field"><span>Name *</span>
              <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="z.B. SHK & Kälte (2027)" /></label>
            <label className="field"><span>Gewerk *</span>
              <select value={edit.gewerk} onChange={e => setEdit({ ...edit, gewerk: e.target.value })}>
                {GEWERKE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label className="field"><span>Meta-Pixel-ID (Dataset) *</span>
              <input value={edit.meta_pixel_id} onChange={e => setEdit({ ...edit, meta_pixel_id: e.target.value })} placeholder="z.B. 497600425380244" /></label>
            <label className="field" style={{ alignSelf: 'end' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!edit.aktiv} onChange={e => setEdit({ ...edit, aktiv: e.target.checked })} /> aktiv
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <input type="checkbox" checked={!!edit.fallback} onChange={e => setEdit({ ...edit, fallback: e.target.checked })} /> Fallback (genau einer)
              </span>
            </label>
            <label className="field field-full"><span>Notiz</span>
              <textarea rows={2} value={edit.notiz || ''} onChange={e => setEdit({ ...edit, notiz: e.target.value })} placeholder="Welche Berufe/Gewerke deckt dieser Pixel ab?" /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-primary" onClick={() => speichern()} disabled={busy}>{busy ? 'Speichere…' : 'Speichern'}</button>
            <button className="btn-ghost" onClick={() => { setEdit(null); setError(''); }} disabled={busy}>Abbrechen</button>
          </div>
        </div>
      )}

      {/* ── Bericht: Vorschlag je Stelle (nur Anzeige) ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Bericht: Vorschlag je Stelle</h2>
          <button className="btn-ghost btn-sm" onClick={ladeBericht} disabled={berichtBusy}>{berichtBusy ? 'Lade…' : (bericht ? 'Aktualisieren' : 'Bericht laden')}</button>
        </div>
        <p className="pane-hint" style={{ marginBottom: 10 }}>
          Nur Anzeige — es wird nichts umgehängt. „Freitext" = <code>projekte.pixel</code> (Altsystem/manuelle Notiz).
        </p>
        {bericht && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '6px 8px' }}>Stelle</th><th style={{ padding: '6px 8px' }}>Kunde</th>
                  <th style={{ padding: '6px 8px' }}>Vorschlag</th><th style={{ padding: '6px 8px' }}>aktuell</th>
                  <th style={{ padding: '6px 8px' }}>Freitext</th>
                </tr>
              </thead>
              <tbody>
                {bericht.map(z => (
                  <tr key={z.job_id} style={{ borderTop: '1px solid var(--line)', background: z.abweichung ? '#fff7e6' : undefined }}>
                    <td style={{ padding: '6px 8px' }}><Link to={`/jobs/${z.job_id}`}>{z.stelle}</Link></td>
                    <td style={{ padding: '6px 8px' }}>{z.firmenname}{z.branche ? <span style={{ color: 'var(--ink-3)' }}> · {z.branche}</span> : null}</td>
                    <td style={{ padding: '6px 8px' }}>{z.vorschlag ? <>{z.vorschlag.name}{z.vorschlag.via_fallback ? ' (Fallback)' : ''}</> : '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{z.aktueller_pixel ? z.aktueller_pixel.name : <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--ink-3)' }}>{z.projekt_pixel_freitext || '—'}</td>
                  </tr>
                ))}
                {bericht.length === 0 && <tr><td colSpan={5} style={{ padding: 10, color: 'var(--ink-3)' }}>Keine Stellen.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
