import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { fileToBase64 } from '../../lib/files.js';
import Lightbox from '../../components/Lightbox.jsx';

// Admin-Verwaltung fuer die Stilvorlagen der Creative-Generierung.
// Editieren des layout_prompt live moeglich (ohne Deploy).
export default function StilvorlagenAdmin() {
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [visionBusy, setVisionBusy] = useState(false);
  const fileRef = useRef(null);
  const bulkRef = useRef(null);
  const [bulk, setBulk] = useState(null); // { done, total } während des Direkt-Uploads

  // Direkt-Weg: pro Bild eine fertige, aktive Vorlage (Name + Layout per Vision).
  async function uploadVorlagen(files) {
    if (!files?.length) return;
    setBulk({ done: 0, total: files.length });
    let fehler = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const fileData = await fileToBase64(files[i]);
        await api('/stilvorlagen/aus-bild', {
          method: 'POST',
          body: { fileData, fileName: files[i].name, contentType: files[i].type || 'image/png' },
        });
      } catch (err) { fehler++; console.warn('[bulk-upload]', err.body?.error || err.message); }
      setBulk({ done: i + 1, total: files.length });
      load();
    }
    setBulk(null);
    if (bulkRef.current) bulkRef.current.value = '';
    if (fehler) alert(`${fehler} von ${files.length} Bild(ern) konnten nicht verarbeitet werden.`);
  }

  // Vorlage muss existieren, bevor Bilder hochgeladen werden können.
  // Legt bei Bedarf an (name + layout_prompt Pflicht) und liefert die Vorlage mit id.
  async function ensureSaved() {
    if (edit.id) return edit;
    if (!edit.name || !edit.layout_prompt) {
      throw new Error('Bitte zuerst Name und Layout-Prompt ausfüllen (dann kann hochgeladen werden).');
    }
    const res = await api('/stilvorlagen', {
      method: 'POST',
      body: {
        name: edit.name, beschreibung: edit.beschreibung || null,
        layout_prompt: edit.layout_prompt, vorschau_url: edit.vorschau_url || null,
        referenzbild_nutzen: !!edit.referenzbild_nutzen,
        aktiv: true, reihenfolge: Number(edit.reihenfolge) || 100,
      },
    });
    const created = res.stilvorlage;
    setEdit(created);
    return created;
  }

  async function uploadBeispiel(files) {
    if (!files?.length) return;
    setUploadBusy(true);
    try {
      const vorlage = await ensureSaved();
      let last = vorlage;
      for (const file of files) {
        const fileData = await fileToBase64(file);
        const res = await api(`/stilvorlagen/${vorlage.id}/beispielbild`, {
          method: 'POST',
          body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
        });
        last = res.stilvorlage;
      }
      setEdit(last);
      load();
    } catch (err) { alert(err.body?.error || err.message); }
    finally { setUploadBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function removeBeispiel(url) {
    if (!edit?.id) return;
    setUploadBusy(true);
    try {
      const res = await api(`/stilvorlagen/${edit.id}/beispielbild`, { method: 'DELETE', body: { url } });
      setEdit(res.stilvorlage);
      load();
    } catch (err) { alert(err.body?.error || err.message); }
    finally { setUploadBusy(false); }
  }

  async function layoutAusBild() {
    const imageUrl = edit?.vorschau_url || (Array.isArray(edit?.beispielbild_urls) ? edit.beispielbild_urls[0] : null);
    if (!imageUrl) { alert('Bitte zuerst ein Beispielbild hochladen.'); return; }
    if (edit.layout_prompt?.trim() && !confirm('Der bestehende Layout-Prompt wird durch die KI-Beschreibung ersetzt. Fortfahren?')) return;
    setVisionBusy(true);
    try {
      const res = await api('/stilvorlagen/layout-vorschlag', { method: 'POST', body: { imageUrl } });
      setEdit(e => ({ ...e, layout_prompt: res.layout_prompt || e.layout_prompt }));
    } catch (err) { alert(err.body?.error || err.message); }
    finally { setVisionBusy(false); }
  }

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
            farben_fix: !!edit.farben_fix,
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
            farben_fix: !!edit.farben_fix,
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {bulk && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Verarbeite {bulk.done}/{bulk.total}…</span>}
          <button className="btn-primary" onClick={() => bulkRef.current?.click()} disabled={!!bulk}
            title="Bilder wählen — pro Bild wird automatisch eine fertige, aktive Vorlage angelegt (Name + Layout per KI)">
            {bulk ? 'Lädt…' : '⬆️ Vorlage(n) hochladen'}
          </button>
          <button className="btn-ghost" onClick={() => setEdit({
            name: '', beschreibung: '', layout_prompt: '', vorschau_url: '',
            referenzbild_nutzen: false, aktiv: true, reihenfolge: 100,
          })} disabled={!!bulk}>+ Neue Vorlage</button>
          <input ref={bulkRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }}
            onChange={e => uploadVorlagen(Array.from(e.target.files || []))} />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {list.map(v => (
          <div key={v.id} style={{
            background: '#fff', border: '1px solid var(--line)', borderRadius: 10,
            padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start',
            opacity: v.aktiv ? 1 : 0.55,
          }}>
            <button
              type="button"
              onClick={() => {
                if (!v.vorschau_url) return;
                const idx = list.filter(x => x.vorschau_url).findIndex(x => x.id === v.id);
                setLightboxIndex(idx >= 0 ? idx : 0);
              }}
              disabled={!v.vorschau_url}
              title={v.vorschau_url ? 'Vorschau in Groß-Ansicht öffnen' : 'Keine Vorschau'}
              style={{
                width: 80, height: 80, background: '#f4f3f0', borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                border: 'none', padding: 0, cursor: v.vorschau_url ? 'zoom-in' : 'default',
              }}
            >
              {v.vorschau_url ? <img src={v.vorschau_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : '🎨'}
            </button>
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
                <span>Reihenfolge</span>
                <input type="number" value={edit.reihenfolge} onChange={e => setEdit({ ...edit, reihenfolge: e.target.value })} />
              </label>
              <label className="field">
                <span>Vorschau-URL <small style={{ color: 'var(--ink-3)' }}>(wird beim Upload automatisch gesetzt)</small></span>
                <input type="url" value={edit.vorschau_url || ''} onChange={e => setEdit({ ...edit, vorschau_url: e.target.value })} placeholder="https://…" />
              </label>

              {/* Beispiel-Creatives (Bild-Upload) */}
              <div className="field field-full">
                <span>Beispiel-Creatives <small style={{ color: 'var(--ink-3)' }}>(ein oder mehrere Bilder des gewünschten Stils — erstes wird Thumbnail + KI-Stil-Referenz)</small></span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {(Array.isArray(edit.beispielbild_urls) ? edit.beispielbild_urls : []).map(url => (
                    <div key={url} style={{ position: 'relative', width: 84, height: 84 }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                      <button type="button" onClick={() => removeBeispiel(url)} disabled={uploadBusy}
                        title="Bild entfernen"
                        style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#b91c1c', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadBusy}
                    style={{ width: 84, height: 84, borderRadius: 8, border: '2px dashed var(--line)', background: '#fafaf8', cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)' }}>
                    {uploadBusy ? '…' : '+ Bild'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }}
                    onChange={e => uploadBeispiel(Array.from(e.target.files || []))} />
                </div>
              </div>

              <label className="field-checkbox field-full">
                <input type="checkbox" checked={!!edit.referenzbild_nutzen} onChange={e => setEdit({ ...edit, referenzbild_nutzen: e.target.checked })} />
                <span>Beispielbild als Stil-Referenz an die KI übergeben <small style={{ color: 'var(--ink-3)' }}>(wird als letztes Referenzbild in die Generierung aufgenommen)</small></span>
              </label>

              <label className="field-checkbox field-full">
                <input type="checkbox" checked={!!edit.farben_fix} onChange={e => setEdit({ ...edit, farben_fix: e.target.checked })} />
                <span>Vorlagenfarben beibehalten <small style={{ color: 'var(--ink-3)' }}>(Standard aus: Farben werden an die Kunden-CI angepasst. Nur setzen, wenn die Farbe selbst der Stil ist — z. B. „Pinselstrich Neongrün".)</small></span>
              </label>

              {(Array.isArray(edit.beispielbild_urls) && edit.beispielbild_urls.length > 0) && (
                <div className="field-full" style={{ fontSize: 12, color: 'var(--ink-3)', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px' }}>
                  ℹ️ Die KI übernimmt den Stil und Aufbau der Vorlage — Ergebnisse sind stilistisch angelehnt, keine exakte Kopie.
                </div>
              )}
              <label className="field field-full">
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>Layout-Prompt (der Text ersetzt den festen Layout-Block)</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={layoutAusBild}
                    disabled={visionBusy || uploadBusy || !(edit.vorschau_url || (edit.beispielbild_urls || []).length)}
                    title="Claude analysiert das Beispielbild und schreibt die Layout-Beschreibung">
                    {visionBusy ? 'Analysiere Bild…' : '✨ Layout-Beschreibung aus Bild generieren'}
                  </button>
                </span>
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

      {lightboxIndex !== null && (() => {
        const items = list.filter(v => v.vorschau_url).map(v => ({
          id: v.id, bild_url: v.vorschau_url, format: 'quadrat', typ: 'foto',
          created_at: v.updated_at || v.created_at, name: v.name,
        }));
        if (!items.length) return null;
        const clamped = Math.max(0, Math.min(lightboxIndex, items.length - 1));
        return (
          <Lightbox
            items={items}
            index={clamped}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
            filenameFor={v => `stil-${(v.name || 'vorlage').replace(/[^\w-]+/g, '-')}.png`}
          />
        );
      })()}
    </div>
  );
}
