// Multi-Upload für fertige Creatives (Bilder + Videos) in einem Job.
// Bilder laufen als base64 über /creatives/upload. Videos werden per signierter
// Upload-URL DIREKT in den Bucket geladen (umgeht das Body-Limit) und danach via
// /creatives/register eingetragen — mit Fortschrittsbalken + Formaterkennung aus
// den Video-Dimensionen. Pro Datei: Thumbnail/Preview + Format-Selector + Status.

import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';
import { fileToBase64 } from '../lib/files.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime';
const MAX_IMAGE = 25 * 1024 * 1024;   // 25 MB
const MAX_VIDEO = 200 * 1024 * 1024;  // 200 MB
const mb = b => (b / 1024 / 1024).toFixed(1).replace('.', ',');

function detectFormat(file) {
  // Versuche aus Dateiname zu erraten (z.B. "...-9x16.mp4" oder "1x1.png")
  const n = (file.name || '').toLowerCase();
  if (/9[x:]?16|story|reel|vertikal|portrait/.test(n)) return 'story';
  if (/4[x:]?5|1080.?1350|feed/.test(n)) return 'feed';
  if (/1[x:]?1|quadrat|square/.test(n)) return 'quadrat';
  return 'quadrat'; // sinnvoller Default für Feed
}

// Format aus Pixel-Dimensionen: 9:16≈0.56, 4:5=0.8, 1:1=1.0.
function formatFromDimensions(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  if (r <= 0.65) return 'story';
  if (r <= 0.92) return 'feed';
  if (r <= 1.15) return 'quadrat';
  return 'sonstiges';
}

// Liest Breite/Höhe eines Videos lokal im Browser (ohne Upload) für die Formaterkennung.
function readVideoDimensions(file) {
  return new Promise(resolve => {
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { const w = v.videoWidth, h = v.videoHeight; try { URL.revokeObjectURL(v.src); } catch (e) {} resolve({ w, h }); };
      v.onerror = () => resolve({ w: 0, h: 0 });
      v.src = URL.createObjectURL(file);
    } catch (e) { resolve({ w: 0, h: 0 }); }
  });
}

// PUT mit echtem Upload-Fortschritt (fetch kann keinen Upload-Progress liefern).
function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Upload fehlgeschlagen (${xhr.status}): ${(xhr.responseText || '').slice(0, 160)}`));
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload.'));
    xhr.send(file);
  });
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
    const items = list.map(file => {
      const isVideo = file.type.startsWith('video/');
      const limit = isVideo ? MAX_VIDEO : MAX_IMAGE;
      const tooLarge = file.size > limit;
      return {
        id: Math.random().toString(36).slice(2),
        file,
        preview: URL.createObjectURL(file),
        format: detectFormat(file),
        isVideo,
        breite: null,
        hoehe: null,
        progress: 0,
        status: tooLarge ? 'error' : 'pending',
        error: tooLarge ? `${mb(file.size)} MB — erlaubt sind ${isVideo ? '200' : '25'} MB.` : null,
      };
    });
    setQueue(prev => [...prev, ...items]);
    // Video-Dimensionen asynchron nachladen und Format daraus ableiten.
    items.filter(it => it.isVideo && it.status === 'pending').forEach(async it => {
      const { w, h } = await readVideoDimensions(it.file);
      const fmt = formatFromDimensions(w, h);
      setQueue(prev => prev.map(q => q.id === it.id ? { ...q, breite: w || null, hoehe: h || null, format: fmt || q.format } : q));
    });
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
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'uploading', progress: 0, error: null } : q));
      try {
        let created;
        if (item.isVideo) {
          // 1) Signierte Upload-URL holen → 2) direkt in den Bucket PUTten → 3) Metadaten registrieren.
          const signed = await api('/creatives/upload-url', {
            method: 'POST',
            body: { job_id: jobId, fileName: item.file.name, contentType: item.file.type },
          });
          await putWithProgress(signed.signedUrl, item.file, pct =>
            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: pct } : q)));
          const reg = await api('/creatives/register', {
            method: 'POST',
            body: { job_id: jobId, path: signed.path, contentType: item.file.type, format: item.format, breite: item.breite, hoehe: item.hoehe },
          });
          created = reg?.creative;
        } else {
          const fileData = await fileToBase64(item.file);
          const res = await api('/creatives/upload', {
            method: 'POST',
            body: { job_id: jobId, files: [{ fileData, fileName: item.file.name, contentType: item.file.type, format: item.format }] },
          });
          created = res?.creatives?.[0];
        }
        if (created && onUploaded) onUploaded(created);
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'done', progress: 100 } : q));
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
        allDone && pendingCount === 0 ? (
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
        PNG, JPG und MP4/MOV möglich. Bilder bis 25 MB, Videos bis 200 MB (Video lädt direkt in den Speicher, mit Fortschrittsanzeige).
        Das Format wird bei Videos automatisch aus den Maßen erkannt — du kannst es pro Datei überschreiben.
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
          <span>oder klicken, um auszuwählen — PNG / JPG / MP4 / MOV · mehrere möglich</span>
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
                {q.status === 'uploading' && <div className="multi-upload-overlay">{q.isVideo ? `${q.progress}%` : '⏳'}</div>}
                {q.status === 'done' && <div className="multi-upload-overlay multi-upload-done">✓</div>}
              </div>
              <div className="multi-upload-meta">
                <div className="multi-upload-name" title={q.file.name}>
                  {q.file.name}
                  <span className="multi-upload-size">{mb(q.file.size)} MB · {q.isVideo ? 'Video' : 'Bild'}{q.breite && q.hoehe ? ` · ${q.breite}×${q.hoehe}` : ''}</span>
                </div>
                <select
                  value={q.format}
                  onChange={e => setFormat(q.id, e.target.value)}
                  disabled={busy || q.status !== 'pending'}
                  style={{ marginTop: 2 }}
                >
                  <option value="quadrat">1:1 (Feed)</option>
                  <option value="feed">4:5 (Mobile-Feed)</option>
                  <option value="story">9:16 (Story/Reel)</option>
                  <option value="sonstiges">Sonstiges</option>
                </select>
                {q.status === 'uploading' && q.isVideo && (
                  <div style={{ height: 6, background: '#e6e6e6', borderRadius: 100, overflow: 'hidden', marginTop: 6 }}>
                    <div style={{ height: '100%', width: `${q.progress}%`, background: '#1b3f80', transition: 'width .2s' }} />
                  </div>
                )}
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
