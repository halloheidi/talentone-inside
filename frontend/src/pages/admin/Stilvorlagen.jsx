import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Admin-Verwaltung fuer die Stilvorlagen der Creative-Generierung.
// Editieren des layout_prompt live moeglich (ohne Deploy).
export default function StilvorlagenAdmin() {
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [edit, setEdit] = useState(null);

  async function load() {
    try {
      const res = await api('/stilvorlagen?include_inactive=1');
      setList(res.stilvorlagen || []);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function toggleAktiv(v) {
    setBusyId(v.id);
    try {
      await api(`/stilvorlagen/${v.id}`, { method: 'PATCH', body: { aktiv: !v.aktiv } });
      load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  }

  async function save() {
    if (!edit) return;
    setBusyId(edit.id || 'new');
    try {
      if (edit.id) {
        await api(`/stilvorlagen/${edit.id}`, {
          method: 'PATCH',
          body: {
            name: edit.name, beschreibung: edit.beschreibung,
            layout_prompt: edit.layout_prompt, vorschau_url: edit.vorschau_url || null,
            referenzbild_nutzen: !!edit.referenzbild_nutzen,
            aktiv: !!edit.aktiv, reihenfolge: Number(edit.reihenfolge) || 100,
          },
        });
      } else {
        await api('/stilvorlagen', {
          method: 'POST',
          body: {
            name: edit.name, beschreibung: edit.beschreibung || null,
            layout_prompt: edit.layout_prompt, vorschau_url: edit.vorschau_url || null,
            referenzbild_nutzen: !!edit.referenzbild_nutzen,
            aktiv: true, reihenfolge: Number(edit.reihenfolge) || 100,
          },
        });
      }
      setEdit(null);
      load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  }

  async function remove(v) {
    if (!confirm(`Vorlage "${v.name}" wirklich löschen? Bestehende Creatives behalten die Referenz als NULL.`)) return;
    setBusyId(v.id);
    try {
      await api(`/stilvorlagen/${v.id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">🎨 Stil-Vorlagen</h1>
          <p className="page-sub">Layout-Vorlagen für die Creative-Generierung. Der layout_prompt ersetzt den festen Layout-Block im gpt-image-2-Prompt und kann Platzhalter wie <code>{`{stelle_gross}`}</code>, <code>{`{meta_leiste}`}</code>, <code>{`{hook_anweisung}`}</code>, <code>{`{benefits_liste}`}</code>, <code>{`{logo_platzierung}`}</code>, <code>{`{firmenname}`}</code>, <code>{`{meta_leiste_farbe_hinweis}`}</code>, <code>{`{stellenbereich_farb_hinweis}`}</code>, <code>{`{stellenbereich_farb_hinweis_alternative}`}</code> nutzen.</p>
        </div>
        <button className="btn-primary" onClick={() => setEdit({
          name: '', beschreibung: '', layout_prompt: '', vorschau_url: '',
          referenzbild_nutzen: false, aktiv: true, reihenfolge: 100,
        })}>+ Neue Vorlage</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {list.map(v => (
          <div key={v.id} style={{
            background: '#fff', border: '1px solid var(--line)', borderRadius: 10,
            padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start',
            opacity: v.aktiv ? 1 : 0.55,
          }}>
            <div style={{
              width: 80, height: 80, background: '#f4f3f0', borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
            }}>
              {v.vorschau_url ? <img src={v.vorschau_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : '🎨'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <strong style={{ fontSize: 15 }}>{v.name}</strong>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Reihenfolge: {v.reihenfolge}</span>
                {!v.aktiv && <span style={{ fontSize: 11, color: '#b91c1c', background: '#fee2e2', padding: '1px 8px', borderRadius: 6 }}>inaktiv</span>}
              </div>
              {v.beschreibung && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{v.beschreibung}</div>}
              <details style={{ marginTop: 8, fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--ink-3)' }}>Layout-Prompt anzeigen ({(v.layout_prompt || '').length} Zeichen)</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, background: '#fafaf8', padding: 10, borderRadius: 6, marginTop: 6, maxHeight: 240, overflow: 'auto' }}>{v.layout_prompt}</pre>
              </details>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <button className="btn-ghost btn-sm" onClick={() => setEdit(v)} disabled={busyId === v.id}>Bearbeiten</button>
              <button className="btn-ghost btn-sm" onClick={() => toggleAktiv(v)} disabled={busyId === v.id}>
                {v.aktiv ? 'Deaktivieren' : 'Aktivieren'}
              </button>
              <button className="btn-ghost btn-sm btn-danger" onClick={() => remove(v)} disabled={busyId === v.id}>Löschen</button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit-Modal (einfach) */}
      {edit && (
        <div onClick={() => setEdit(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12, padding: 20, width: 820, maxWidth: '100%',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ marginTop: 0 }}>{edit.id ? `Vorlage bearbeiten: ${edit.name}` : 'Neue Vorlage'}</h2>
            <div className="form-grid" style={{ gap: 10 }}>
              <label className="field field-full">
                <span>Name</span>
                <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
              </label>
              <label className="field field-full">
                <span>Beschreibung</span>
                <input value={edit.beschreibung || ''} onChange={e => setEdit({ ...edit, beschreibung: e.target.value })} />
              </label>
              <label className="field">
                <span>Vorschau-URL (optional)</span>
                <input type="url" value={edit.vorschau_url || ''} onChange={e => setEdit({ ...edit, vorschau_url: e.target.value })} placeholder="https://…" />
              </label>
              <label className="field">
                <span>Reihenfolge</span>
                <input type="number" value={edit.reihenfolge} onChange={e => setEdit({ ...edit, reihenfolge: e.target.value })} />
              </label>
              <label className="field-checkbox field-full">
                <input type="checkbox" checked={!!edit.referenzbild_nutzen} onChange={e => setEdit({ ...edit, referenzbild_nutzen: e.target.checked })} />
                <span>Vorschau-Bild als Style-Referenz an gpt-image-2 mitschicken</span>
              </label>
              <label className="field field-full">
                <span>Layout-Prompt (der Text ersetzt den festen Layout-Block)</span>
                <textarea
                  value={edit.layout_prompt || ''}
                  onChange={e => setEdit({ ...edit, layout_prompt: e.target.value })}
                  rows={18}
                  style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setEdit(null)}>Abbrechen</button>
              <button className="btn-primary" onClick={save} disabled={busyId === edit.id || !edit.name || !edit.layout_prompt}>
                {busyId ? 'Speichere…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
