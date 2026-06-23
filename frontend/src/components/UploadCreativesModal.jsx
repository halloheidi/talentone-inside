// Multi-Upload für fertige Creatives (Bilder + Videos) in einem Job.
// Pro Datei: Thumbnail/Preview + Format-Selector + Status (pending/uploading/done/error).

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';
import { fileToBase64 } from '../lib/files.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime';

function detectFormat(file) {
  // Versuche aus Dateiname zu erraten (z.B. "...-9x16.mp4" oder "1x1.png")
  const n = (file.name || '').toLowerCase();
  if (/9[x:]?16|story|reel|vertikal|portrait/.test(n)) return 'story';
  if (/1[x:]?1|quadrat|square/.test(n)) return 'quadrat';
  return 'quadrat'; // sinnvoller Default für Feed
}

export default function UploadCreativesModal({ open, onClose, jobId, onUploaded }) {
  const inputRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Cleanup ObjectURLs beim Schließen
  useEffect(() => {
    if (!open) {
      queue.forEach(q => { try { URL.revokeObjectURL(q.preview); } catch (e) {} });
      setQueue([]);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function addFiles(files) {
    const list = Array.from(files || []).filter(f => {
      if (!f?.type) return false;
      return f.type.startsWith('image/') || f.type.startsWith('video/');
    });
    if (list.length === 0) return;
    setQueue(prev => [
      ...prev,
      ...list.map(file => ({
        id: Math.random().toString(36).slice(2),
        file,
        preview: URL.createObjectURL(file),
        format: detectFormat(file),
        isVideo: file.type.startsWith('video/'),
        status: 'pending',
        error: null,
      })),
    ]);
  }

  function setFormat(id, format) {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, format } : q));
  }
  function removeItem(id) {
    setQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item) try { URL.revokeObjectURL(item.preview); } catch (e) {}
      return prev.filter(q => q.id !== id);
    });
  }

  async function uploadAll() {
    if (busy || queue.length === 0) return;
    setBusy(true);
    const pending = queue.filter(q => q.status === 'pending');
    for (const item of pending) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'uploading' } : q));
      try {
        const fileData = await fileToBase64(item.file);
        const res = await api('/creatives/upload', {
          method: 'POST',
          body: {
            job_id: jobId,
            files: [{
              fileData,
              fileName: item.file.name,
              contentType: item.file.type,
              format: item.format,
            }],
          },
        });
        const created = res?.creatives?.[0];
        if (created && onUploaded) onUploaded(created);
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'done' } : q));
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

  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const doneCount = queue.filter(q => q.status === 'done').length;
  const allDone = queue.length > 0 && queue.every(q => q.status === 'done' || q.status === 'error');

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose?.()}
      title="Fertige Creatives hochladen"
      footer={
        allDone ? (
          <button className="btn-primary" onClick={() => onClose?.()}>Fertig</button>
        ) : (
          <>
            <button className="btn-ghost" onClick={() => onClose?.()} disabled={busy}>Abbrechen</button>
            <button
              className="btn-primary"
              onClick={uploadAll}
              disabled={busy || pendingCount === 0}
            >
              {busy ? `Lade hoch… (${doneCount}/${queue.length})` : `${pendingCount} Datei${pendingCount === 1 ? '' : 'en'} hochladen`}
            </button>
          </>
        )
      }
    >
      <p className="pane-hint">
        PNG, JPG und MP4 möglich. Wähle pro Datei das passende Format — bei 9:16-Bildern kannst du anschließend in der Galerie die „Reel"-Option nutzen.
      </p>

      <div
        className={`drop-zone ${dragOver ? 'is-over' : ''} ${queue.length > 0 ? 'has-file' : ''}`}
        style={{ marginBottom: 14 }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          disabled={busy}
        />
        <div className="drop-empty">
          <strong>{queue.length > 0 ? '+ Weitere Dateien hinzufügen' : 'Dateien hierher ziehen'}</strong>
          <span>oder klicken, um auszuwählen — PNG / JPG / MP4 · mehrere möglich</span>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="multi-upload-list">
          {queue.map(q => (
            <div key={q.id} className={`multi-upload-row is-${q.status}`}>
              <div className="multi-upload-thumb-wrap">
                {q.isVideo ? (
                  <div className="multi-upload-thumb" style={{ background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>▶</div>
                ) : (
                  <img src={q.preview} alt="" className="multi-upload-thumb" />
                )}
                {q.status === 'uploading' && <div className="multi-upload-overlay">⏳</div>}
                {q.status === 'done' && <div className="multi-upload-overlay multi-upload-done">✓</div>}
              </div>
              <div className="multi-upload-meta">
                <div className="multi-upload-name" title={q.file.name}>
                  {q.file.name}
                  <span className="multi-upload-size">{(q.file.size / 1024).toFixed(0)} KB · {q.isVideo ? 'Video' : 'Bild'}</span>
                </div>
                <select
                  value={q.format}
                  onChange={e => setFormat(q.id, e.target.value)}
                  disabled={busy || q.status !== 'pending'}
                  style={{ marginTop: 2 }}
                >
                  <option value="quadrat">1:1 (Feed)</option>
                  <option value="story">9:16 (Story/Reel)</option>
                  <option value="sonstiges">Sonstiges</option>
                </select>
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
      )}
    </Modal>
  );
}
