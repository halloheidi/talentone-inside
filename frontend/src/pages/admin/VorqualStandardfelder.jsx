import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Pflege der globalen Standard-Vorqualifizierungsfelder (erscheinen bei JEDER
// Stelle vor den stellenspezifischen Feldern). Deaktivieren = verschwindet
// überall. notiz_feld (Spiegelung bestehender Spalten) ist nicht editierbar,
// nur als Hinweis sichtbar.
const TYP_LABEL = { text: 'Text', select: 'Auswahl', janein: 'Ja/Nein', zahl: 'Zahl' };

function FeldRow({ feld, onSaved, onDeleted }) {
  const [f, setF] = useState(feld);
  const [busy, setBusy] = useState(false);
  const [optText, setOptText] = useState((feld.optionen || []).join(', '));
  useEffect(() => { setF(feld); setOptText((feld.optionen || []).join(', ')); }, [feld]);
  const dirty = f.name !== feld.name || f.typ !== feld.typ || f.sichtbar_fuer !== feld.sichtbar_fuer
    || (f.reihenfolge ?? 0) !== (feld.reihenfolge ?? 0) || optText !== (feld.optionen || []).join(', ');

  async function save(extra = {}) {
    setBusy(true);
    try {
      const body = {
        name: f.name, typ: f.typ, sichtbar_fuer: f.sichtbar_fuer,
        reihenfolge: Number(f.reihenfolge) || 0,
        optionen: f.typ === 'select' ? optText.split(',').map(s => s.trim()).filter(Boolean) : null,
        ...extra,
      };
      const r = await api(`/vorqual-standardfelder/${feld.id}`, { method: 'PUT', body });
      onSaved(r.feld);
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function toggleAktiv() { await save({ aktiv: !feld.aktiv }); }
  async function del() {
    if (!window.confirm(`Feld „${feld.name}" löschen? Bereits erfasste Werte bleiben in den Notizen, werden aber nicht mehr angezeigt.`)) return;
    setBusy(true);
    try { await api(`/vorqual-standardfelder/${feld.id}`, { method: 'DELETE' }); onDeleted(feld.id); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }

  const cell = { padding: '6px 8px', borderBottom: '1px solid #f1f1ee', verticalAlign: 'middle' };
  const inp = { fontSize: 13, padding: '4px 7px', border: '1px solid #e0e0dd', borderRadius: 6, background: '#fff' };
  return (
    <tr style={{ opacity: feld.aktiv ? 1 : 0.5 }}>
      <td style={{ ...cell, width: 70 }}>
        <input type="number" value={f.reihenfolge ?? 0} onChange={e => setF({ ...f, reihenfolge: e.target.value })} style={{ ...inp, width: 56 }} />
      </td>
      <td style={cell}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={{ ...inp, width: 200 }} />
      </td>
      <td style={cell}>
        <select value={f.typ} onChange={e => setF({ ...f, typ: e.target.value })} style={inp} disabled={!!feld.notiz_feld}>
          {Object.entries(TYP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {f.typ === 'select' && (
          <input value={optText} onChange={e => setOptText(e.target.value)} placeholder="Optionen, kommagetrennt" style={{ ...inp, width: 220, marginLeft: 6 }} />
        )}
      </td>
      <td style={cell}>
        <select value={f.sichtbar_fuer} onChange={e => setF({ ...f, sichtbar_fuer: e.target.value })} style={inp}>
          <option value="kunde">Kunde + intern</option>
          <option value="intern">nur intern</option>
        </select>
      </td>
      <td style={{ ...cell, fontSize: 11, color: '#5a5955' }}>
        {feld.notiz_feld && <span title="Spiegelt eine bestehende Notiz-Spalte, kein Doppelspeichern" style={{ background: '#eef2ff', color: '#3730a3', padding: '2px 6px', borderRadius: 4 }}>spiegelt: {feld.notiz_feld}</span>}
        {feld.validierung && <span style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 4 }}>{feld.validierung}</span>}
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        {dirty && <button className="btn-primary btn-sm" disabled={busy} onClick={() => save()}>Speichern</button>}
        <button className="btn-ghost btn-sm" disabled={busy} onClick={toggleAktiv} style={{ marginLeft: 6 }}>{feld.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={del} style={{ marginLeft: 6, color: '#b91c1c' }}>Löschen</button>
      </td>
    </tr>
  );
}

// ───────── Zuordnung je Stelle ─────────
// Bildet stellenspezifische Vorqual-Felder auf globale Standardfelder ab:
// kopiert vorhandene Werte ins Zielfeld (nur wo leer), entfernt danach den
// stellenspezifischen Schlüssel + die Felddefinition aus allen Stellen.
function ZuordnungRow({ row, standardfelder, onDone }) {
  const [ziel, setZiel] = useState(row.vorschlag_id || '');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);

  // Dry-Run bei Ziel-Änderung (und initial): zeigt betroffene Bewerber.
  useEffect(() => {
    let abbruch = false;
    if (!ziel) { setCount(0); return; }
    setCount(null);
    api(`/vorqual-zuordnung/dry-run?name=${encodeURIComponent(row.name)}&ziel_feld_id=${encodeURIComponent(ziel)}`)
      .then(r => { if (!abbruch) setCount(r.count ?? 0); })
      .catch(() => { if (!abbruch) setCount(null); });
    return () => { abbruch = true; };
  }, [ziel, row.name]);

  async function uebernehmen() {
    const zf = standardfelder.find(s => String(s.id) === String(ziel));
    if (!zf) return;
    if (!window.confirm(`„${row.name}" → Standardfeld „${zf.name}" übernehmen?\n\nWerte werden kopiert (nur wo das Zielfeld leer ist), danach wird das stellenspezifische Feld aus allen ${row.stellen_count} Stellen entfernt.`)) return;
    setBusy(true);
    try {
      const r = await api('/vorqual-zuordnung/uebernehmen', { method: 'POST', body: { name: row.name, ziel_feld_id: ziel } });
      onDone(row.name, `„${row.name}" → „${zf.name}": ${r.kopiert} Werte kopiert, ${r.stellen_bereinigt} Stellen bereinigt, ${r.feldwerte_entfernt} Feldwerte entfernt.`);
    } catch (e) { alert(e.message); setBusy(false); }
  }

  const cell = { padding: '6px 8px', borderBottom: '1px solid #f1f1ee', verticalAlign: 'middle' };
  const inp = { fontSize: 13, padding: '4px 7px', border: '1px solid #e0e0dd', borderRadius: 6, background: '#fff' };
  return (
    <tr>
      <td style={cell}><strong>{row.name}</strong></td>
      <td style={{ ...cell, textAlign: 'center', color: '#5a5955' }}>{row.stellen_count}</td>
      <td style={cell}>
        <select value={ziel} onChange={e => setZiel(e.target.value)} style={{ ...inp, minWidth: 220 }}>
          <option value="">— (nicht zuordnen)</option>
          {standardfelder.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td style={{ ...cell, textAlign: 'center', fontSize: 12, color: '#5a5955' }}>
        {!ziel ? '—' : count === null ? '…' : `${count} Bewerber`}
      </td>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <button className="btn-primary btn-sm" disabled={busy || !ziel} onClick={uebernehmen}>Bestätigen</button>
      </td>
    </tr>
  );
}

function ZuordnungCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notiz, setNotiz] = useState('');

  function load() {
    setData(null);
    api('/vorqual-zuordnung').then(setData).catch(e => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  function onDone(name, meldung) {
    setNotiz(meldung);
    load();
  }

  const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.05, color: '#5a5955', borderBottom: '1px solid #ececea' };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Zuordnung je Stelle</h3>
      <p className="page-sub" style={{ margin: '0 0 12px' }}>
        Stellenspezifische Vorqual-Felder, die inhaltlich einem Standardfeld entsprechen. Beim Bestätigen werden vorhandene Werte ins Standardfeld übernommen (nur wo dort noch leer) und das stellenspezifische Feld aus allen Stellen entfernt. Nicht zugeordnete Felder bleiben unverändert.
      </p>
      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>{error}</div>}
      {notiz && <div className="alert" style={{ marginBottom: 10, background: '#ecfdf5', color: '#065f46', padding: '8px 10px', borderRadius: 6, fontSize: 13 }}>{notiz}</div>}
      {!data ? <div className="empty" style={{ color: '#9a9994', padding: 8 }}>Lade…</div> : (
        data.rows.length === 0 ? (
          <div style={{ color: '#9a9994', padding: 8, fontSize: 13 }}>Keine offenen Zuordnungen – alle stellenspezifischen Felder sind bereits Standardfelder oder individuell.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Feldname</th><th style={{ ...th, textAlign: 'center' }}>Stellen</th>
                  <th style={th}>entspricht Standardfeld</th><th style={{ ...th, textAlign: 'center' }}>Betroffen</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => (
                  <ZuordnungRow key={row.name} row={row} standardfelder={data.standardfelder} onDone={onDone} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export default function VorqualStandardfelder() {
  const [felder, setFelder] = useState(null);
  const [error, setError] = useState('');
  const [neu, setNeu] = useState({ name: '', typ: 'text', sichtbar_fuer: 'kunde', optionen: '' });
  const [busy, setBusy] = useState(false);

  function load() { api('/vorqual-standardfelder').then(r => setFelder(r.felder || [])).catch(e => setError(e.message)); }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!neu.name.trim()) { alert('Bitte einen Namen eingeben.'); return; }
    setBusy(true);
    try {
      const body = {
        name: neu.name.trim(), typ: neu.typ, sichtbar_fuer: neu.sichtbar_fuer,
        optionen: neu.typ === 'select' ? neu.optionen.split(',').map(s => s.trim()).filter(Boolean) : null,
      };
      const r = await api('/vorqual-standardfelder', { method: 'POST', body });
      setFelder(fs => [...(fs || []), r.feld].sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0)));
      setNeu({ name: '', typ: 'text', sichtbar_fuer: 'kunde', optionen: '' });
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  function onSaved(f) { setFelder(fs => (fs || []).map(x => x.id === f.id ? f : x).sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0))); }
  function onDeleted(id) { setFelder(fs => (fs || []).filter(x => x.id !== id)); }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!felder) return <div className="card empty">Lade…</div>;

  const inp = { fontSize: 13, padding: '5px 8px', border: '1px solid #e0e0dd', borderRadius: 6, background: '#fff' };
  const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.05, color: '#5a5955', borderBottom: '1px solid #ececea' };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Standard-Vorqualifizierung</h1>
          <p className="page-sub">Diese Felder erscheinen bei <strong>jeder</strong> Stelle in der internen Bewerberliste (vor den stellenspezifischen Feldern). „Kunde + intern" zeigt das Feld auch im Portal (dort read-only).</p>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Reihenf.</th><th style={th}>Name</th><th style={th}>Typ</th>
              <th style={th}>Sichtbar</th><th style={th}>Hinweis</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {felder.map(f => <FeldRow key={f.id} feld={f} onSaved={onSaved} onDeleted={onDeleted} />)}
            {felder.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: '#9a9994' }}>Noch keine Standardfelder.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Neues Standardfeld</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Name (z.B. Schichtbereitschaft)" value={neu.name} onChange={e => setNeu({ ...neu, name: e.target.value })} style={{ ...inp, width: 240 }} />
          <select value={neu.typ} onChange={e => setNeu({ ...neu, typ: e.target.value })} style={inp}>
            {Object.entries(TYP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {neu.typ === 'select' && (
            <input placeholder="Optionen, kommagetrennt" value={neu.optionen} onChange={e => setNeu({ ...neu, optionen: e.target.value })} style={{ ...inp, width: 240 }} />
          )}
          <select value={neu.sichtbar_fuer} onChange={e => setNeu({ ...neu, sichtbar_fuer: e.target.value })} style={inp}>
            <option value="kunde">Kunde + intern</option>
            <option value="intern">nur intern</option>
          </select>
          <button className="btn-primary" disabled={busy} onClick={create}>+ Hinzufügen</button>
        </div>
      </div>

      <ZuordnungCard />
    </div>
  );
}
