import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// A5: Mitarbeiterstimmen-Verwaltung (intern, Kunden-Tab). Quelle 'nw'/'pdf'.
// Foto-Upload über den bestehenden Upload-Pfad. Freigabe-Haken = Pflicht für die
// Nutzung in Funnel/Creatives.
const LEER = { name: '', rolle: '', dabei_seit: '', zitat: '', quelle: 'nw', freigabe: false, reihenfolge: 0 };

export default function MitarbeiterStimmenManager({ kundeId, onCount }) {
  const [stimmen, setStimmen] = useState([]);
  const [neu, setNeu] = useState(LEER);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await api(`/kunden/${kundeId}/mitarbeiterstimmen`);
      setStimmen(r.stimmen || []);
      onCount?.((r.stimmen || []).length);
    }
    catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kundeId]);

  async function add() {
    if (!neu.zitat.trim() && !neu.name.trim()) { setMsg('Name oder Zitat angeben.'); return; }
    setBusy(true); setMsg('');
    try { await api(`/kunden/${kundeId}/mitarbeiterstimmen`, { method: 'POST', body: neu }); setNeu(LEER); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function patch(id, body) {
    try { await api(`/kunden/mitarbeiterstimmen/${id}`, { method: 'PATCH', body }); await load(); }
    catch (e) { setMsg(e.message); }
  }
  async function del(id) {
    if (!confirm('Stimme löschen?')) return;
    try { await api(`/kunden/mitarbeiterstimmen/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setMsg(e.message); }
  }
  async function uploadFoto(id, file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/kunden/${kundeId}/mitarbeiterstimmen/${id}/foto`, { method: 'POST', body: { fileData: String(reader.result).split(',')[1], fileName: file.name, contentType: file.type } });
        await load();
      } catch (e) { setMsg(e.message); }
    };
    reader.readAsDataURL(file);
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h2 className="section-title">Mitarbeiterstimmen</h2>
      <p className="section-sub">Testimonials für Funnel &amp; Creatives. Nur mit gesetztem <strong>Freigabe</strong>-Haken werden sie dort angeboten.</p>
      {msg && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 6 }}>{msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stimmen.map(s => (
          <div key={s.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 54, flexShrink: 0 }}>
              {s.foto_url
                ? <img src={s.foto_url} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8 }} />
                : <div style={{ width: 54, height: 54, borderRadius: 8, background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-3)' }}>Foto</div>}
              <label className="btn-ghost btn-sm" style={{ display: 'block', marginTop: 4, textAlign: 'center', cursor: 'pointer', fontSize: 10 }}>
                Foto…<input type="file" accept="image/*" hidden onChange={e => e.target.files[0] && uploadFoto(s.id, e.target.files[0])} />
              </label>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input className="cell-input" style={{ flex: 1, minWidth: 100 }} placeholder="Name" defaultValue={s.name || ''} onBlur={e => e.target.value !== (s.name || '') && patch(s.id, { name: e.target.value })} />
                <input className="cell-input" style={{ flex: 1, minWidth: 100 }} placeholder="Rolle" defaultValue={s.rolle || ''} onBlur={e => e.target.value !== (s.rolle || '') && patch(s.id, { rolle: e.target.value })} />
                <input className="cell-input" style={{ width: 110 }} placeholder="dabei seit" defaultValue={s.dabei_seit || ''} onBlur={e => e.target.value !== (s.dabei_seit || '') && patch(s.id, { dabei_seit: e.target.value })} />
              </div>
              <textarea className="cell-input" rows={2} placeholder="Zitat" defaultValue={s.zitat || ''} onBlur={e => e.target.value !== (s.zitat || '') && patch(s.id, { zitat: e.target.value })} />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontWeight: 600, color: s.freigabe ? '#166534' : '#b91c1c' }}>
                  <input type="checkbox" checked={!!s.freigabe} onChange={e => patch(s.id, { freigabe: e.target.checked })} /> Freigabe zur Nutzung
                </label>
                <span style={{ color: 'var(--ink-3)' }}>Quelle: {s.quelle || 'nw'}</span>
                <button type="button" className="btn-ghost btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={() => del(s.id)}>Löschen</button>
              </div>
            </div>
          </div>
        ))}
        {stimmen.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Noch keine Mitarbeiterstimmen.</div>}
      </div>

      <div style={{ border: '1px dashed var(--line)', borderRadius: 8, padding: 10, marginTop: 10, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input className="cell-input" style={{ flex: 1, minWidth: 100 }} placeholder="Name" value={neu.name} onChange={e => setNeu(s => ({ ...s, name: e.target.value }))} />
          <input className="cell-input" style={{ flex: 1, minWidth: 100 }} placeholder="Rolle" value={neu.rolle} onChange={e => setNeu(s => ({ ...s, rolle: e.target.value }))} />
          <input className="cell-input" style={{ width: 110 }} placeholder="dabei seit" value={neu.dabei_seit} onChange={e => setNeu(s => ({ ...s, dabei_seit: e.target.value }))} />
          <select className="cell-input" style={{ width: 90 }} value={neu.quelle} onChange={e => setNeu(s => ({ ...s, quelle: e.target.value }))}>
            <option value="nw">N&W</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <textarea className="cell-input" rows={2} placeholder="Zitat" value={neu.zitat} onChange={e => setNeu(s => ({ ...s, zitat: e.target.value }))} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={neu.freigabe} onChange={e => setNeu(s => ({ ...s, freigabe: e.target.checked }))} /> Freigabe
          </label>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={add} style={{ marginLeft: 'auto' }}>+ Mitarbeiterstimme</button>
        </div>
      </div>
    </section>
  );
}

// Read-only Vorschlagsliste für Funnel-/Creative-Wizard: NUR freigegebene Stimmen.
export function MitarbeiterStimmenVorschlag({ kundeId, onInsert }) {
  const [stimmen, setStimmen] = useState([]);
  useEffect(() => {
    if (!kundeId) return;
    api(`/kunden/${kundeId}/mitarbeiterstimmen?nur_freigegeben=1`)
      .then(r => setStimmen(r.stimmen || [])).catch(() => setStimmen([]));
  }, [kundeId]);
  if (!stimmen.length) return null;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
        Freigegebene Mitarbeiterstimmen
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stimmen.map(s => (
          <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            {s.foto_url && <img src={s.foto_url} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />}
            <span style={{ flex: 1, minWidth: 0 }}>„{s.zitat || '—'}"{s.name ? ` — ${s.name}` : ''}{s.rolle ? `, ${s.rolle}` : ''}</span>
            {onInsert && <button type="button" className="btn-ghost btn-sm" onClick={() => onInsert(s)}>Übernehmen</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
