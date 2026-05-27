import { useCallback, useEffect } from 'react';
import Icon from './Icon.jsx';
import { downloadFromUrl } from '../lib/files.js';

export default function Lightbox({ items, index, onClose, onNavigate, filenameFor }) {
  const item = items[index];

  const next = useCallback(() => {
    if (items.length <= 1) return;
    onNavigate((index + 1) % items.length);
  }, [index, items.length, onNavigate]);

  const prev = useCallback(() => {
    if (items.length <= 1) return;
    onNavigate((index - 1 + items.length) % items.length);
  }, [index, items.length, onNavigate]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, next, prev]);

  if (!item) return null;

  async function onDownload(e) {
    e.stopPropagation();
    try {
      await downloadFromUrl(item.bild_url, filenameFor ? filenameFor(item) : 'creative.png');
    } catch (err) {
      alert(err.message);
    }
  }

  const dateStr = new Date(item.created_at).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="lb-overlay" onClick={onClose}>
      <div className="lb-topbar" onClick={e => e.stopPropagation()}>
        <div className="lb-meta">
          <span className={`format-badge format-${item.format}`}>{item.format === 'story' ? '9:16' : '1:1'}</span>
          <span className="lb-meta-date">{dateStr}</span>
          <span className="lb-meta-counter">{index + 1} / {items.length}</span>
        </div>
        <div className="lb-actions">
          <button className="lb-btn" onClick={onDownload} title="Herunterladen">
            <Icon name="download" size={18} />
            <span>Download</span>
          </button>
          <button className="lb-btn lb-btn-icon" onClick={onClose} title="Schließen (Esc)" aria-label="Schließen">
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <button className="lb-arrow lb-arrow-left" onClick={e => { e.stopPropagation(); prev(); }} aria-label="Vorheriges">
          <Icon name="chevron-left" size={28} />
        </button>
      )}

      <div className="lb-stage" onClick={onClose}>
        {item.typ === 'video' ? (
          <video
            key={item.id}
            src={item.bild_url}
            className="lb-img"
            controls
            autoPlay
            loop
            playsInline
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <img
            key={item.id}
            src={item.bild_url}
            alt=""
            className="lb-img"
            onClick={e => e.stopPropagation()}
          />
        )}
      </div>

      {items.length > 1 && (
        <button className="lb-arrow lb-arrow-right" onClick={e => { e.stopPropagation(); next(); }} aria-label="Nächstes">
          <Icon name="chevron-right" size={28} />
        </button>
      )}
    </div>
  );
}
