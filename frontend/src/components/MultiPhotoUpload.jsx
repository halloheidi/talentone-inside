import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';
import { fileToBase64 } from '../lib/files.js';

/**
 * Multi-Photo-Upload für Referenzbilder eines Kunden.
 * Mehrere Bilder auf einmal (File-Picker oder Drag&Drop), pro Bild
 * Beschreibung erfassen, dann sequenziell hochladen mit Fortschritt.
 *
 * Props:
 *  - kundeId           — Kunde-ID, an den die referenzbilder gebunden werden
 *  - onUploaded(rb)    — Callback nach jedem erfolgreichen Upload (Liste aktualisieren)
 *  - trigger           — Render-Prop oder Node, der den Picker öffnet (z.B. "+ Foto hochladen")
 *  - accept            — Akzeptierte MIME-Typen
 *  - dropZoneClassName — CSS-Klasse für die Drop-Zone (default: nichts → trigger ist der Anker)
 */
export default function MultiPhotoUpload({
  kundeId,
  onUploaded,
  trigger,
  accept = 'image/png,image/jpeg,image/webp',
  dropZoneClassName,
}) {
  const inputRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Cleanup ObjectURLs beim Unmount
  useEffect(() => {
    return () => queue.forEach(q => { try { URL.revokeObjectURL(q.preview); } catch (e) {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files) {
    const list = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (list.length === 0) return;
    setQueue(prev => [
      ...prev,
      ...list.map(file => ({
        id: Math.random().toString(36).slice(2),
        file,
        preview: URL.createObjectURL(file),
        desc: '',
        status: 'pending',
        error: null,
      })),
    ]);
  }

  function updateDesc(id, desc) {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, desc } : q));
  }

  function removeItem(id) {
    setQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item) try { URL.revokeObjectURL(item.preview); } catch (e) {}
      return prev.filter(q => q.id !== id);
    });
  }

  function closeAll() {
    queue.forEach(q => { try { URL.revokeObjectURL(q.preview); } catch (e) {} });
    setQueue([]);
  }

  async function uploadAll() {
    if (busy) return;
    setBusy(true);
    // Snapshot der pending IDs, damit wir iterativ status aktualisieren können
    const pending = queue.filter(q => q.status === 'pending');
    for (const item of pending) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'uploading' } : q));
      try {
        const fileData = await fileToBase64(item.file);
        const res = await api(`/kunden/${kundeId}/referenzbilder`, {
          method: 'POST',
          body: {
            fileData,
            fileName: item.file.name,
            contentType: item.file.type || 'image/jpeg',
            beschreibung: item.desc.trim() || null,
          },
        });
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'done' } : q));
        if (res?.referenzbild && onUploaded) onUploaded(res.referenzbild);
      } catch (err) {
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: err.message } : q));
      }
    }
    setBusy(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files || []);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const doneCount = queue.filter(q => q.status === 'done').length;
  const allDone = queue.length > 0 && queue.every(q => q.status === 'done' || q.status === 'error');

  return (
    <>
      <div
        className={dropZoneClassName || ''}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={openPicker}
        role="button"
        tabIndex={0}
        style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: '-4px' } : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
        />
        {trigger}
      </div>

      <Modal
        open={queue.length > 0}
        onClose={() => !busy && closeAll()}
        title={
          allDone
            ? `${doneCount} von ${queue.length} Foto${queue.length === 1 ? '' : 's'} hochgeladen`
            : `${queue.length} Foto${queue.length === 1 ? '' : 's'} bereit zum Hochladen`
        }
        footer={
          allDone ? (
            <button className="btn-primary" onClick={closeAll}>Fertig</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={closeAll} disabled={busy}>Abbrechen</button>
              <button
                className="btn-primary"
                onClick={uploadAll}
                disabled={busy || pendingCount === 0}
              >
                {busy ? `Lade hoch… (${doneCount}/${queue.length})` : `${pendingCount} Foto${pendingCount === 1 ? '' : 's'} hochladen`}
              </button>
            </>
          )
        }
      >
        <p className="pane-hint">
          Pro Foto kannst du eine kurze Beschreibung („Wer ist auf dem Foto?") ergänzen. Das hilft der KI später beim Einsetzen der Person in die Szene.
        </p>

        <div className="multi-upload-list">
          {queue.map(q => (
            <div key={q.id} className={`multi-upload-row is-${q.status}`}>
              <div className="multi-upload-thumb-wrap">
                <img src={q.preview} alt="" className="multi-upload-thumb" />
                {q.status === 'uploading' && <div className="multi-upload-overlay">⏳</div>}
                {q.status === 'done' && <div className="multi-upload-overlay multi-upload-done">✓</div>}
              </div>
              <div className="multi-upload-meta">
                <div className="multi-upload-name" title={q.file.name}>
                  {q.file.name}
                  <span className="multi-upload-size">{(q.file.size / 1024).toFixed(0)} KB</span>
                </div>
                <input
                  type="text"
                  placeholder="Beschreibung: z.B. Max Müller, Geschäftsführer (optional)"
                  value={q.desc}
                  onChange={e => updateDesc(q.id, e.target.value)}
                  disabled={busy || q.status !== 'pending'}
                />
                {q.status === 'error' && <div className="multi-upload-error">⚠ {q.error}</div>}
              </div>
              <div className="multi-upload-actions">
                {(q.status === 'pending' || q.status === 'error') && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => removeItem(q.id)}
                    disabled={busy}
                    title="Aus der Liste entfernen"
                  >×</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!busy && pendingCount > 0 && (
          <p className="form-msg" style={{ marginTop: 10 }}>
            Du kannst weitere Bilder hinzufügen — klick einfach nochmal auf den Upload-Button.
          </p>
        )}
      </Modal>

      <style>{`
        .multi-upload-list { display: flex; flex-direction: column; gap: 10px; max-height: 50vh; overflow-y: auto; padding: 4px 0; }
        .multi-upload-row {
          display: grid; grid-template-columns: 64px 1fr auto;
          gap: 12px; align-items: center;
          padding: 10px; background: var(--bg-2,#f0efed); border-radius: 10px;
          border: 1px solid var(--bg-3,#e2e0dc);
          transition: opacity 0.2s, background 0.2s;
        }
        .multi-upload-row.is-uploading { background: #fffae8; border-color: var(--accent-dark,#c8df00); }
        .multi-upload-row.is-done      { background: #f0fdf4; border-color: #86efac; opacity: 0.92; }
        .multi-upload-row.is-error     { background: #fef2f2; border-color: #fca5a5; }
        .multi-upload-thumb-wrap { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
        .multi-upload-thumb { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; display: block; background: var(--bg-3,#e2e0dc); }
        .multi-upload-overlay {
          position: absolute; inset: 0; background: rgba(255,255,255,0.85); border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px;
        }
        .multi-upload-overlay.multi-upload-done { background: rgba(34,197,94,0.92); color: #fff; font-weight: 700; }
        .multi-upload-meta { min-width: 0; }
        .multi-upload-name {
          font-size: 13px; font-weight: 600; color: var(--ink-1,#0a0a0a);
          margin-bottom: 6px; display: flex; align-items: baseline; gap: 8px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .multi-upload-size { font-weight: 400; font-size: 11.5px; color: var(--ink-3,#999790); flex-shrink: 0; }
        .multi-upload-meta input {
          width: 100%; padding: 7px 10px; font-size: 13px;
          border: 1px solid var(--bg-3,#e2e0dc); border-radius: 6px;
          background: #fff; font-family: inherit; color: var(--ink-1,#0a0a0a);
        }
        .multi-upload-meta input:disabled { background: var(--bg-2,#f0efed); color: var(--ink-2,#5a5955); }
        .multi-upload-error { font-size: 11.5px; color: #b91c1c; margin-top: 6px; }
        .multi-upload-actions { display: flex; align-items: flex-start; }
      `}</style>
    </>
  );
}
