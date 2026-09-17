import { useEffect, useRef, useState, useCallback } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Dialog „Text anpassen": verschiebt die Textblöcke eines Sharp-gerenderten
// Creatives (Layout-Vorlagen A/B + Strikt). Drag pro Block + Größen-Slider,
// Snap-Linien (Zentrum/Drittel/Ränder), Safe-Zone-Markierung (9:16). Beim
// Speichern rendert das Backend die Textebene exakt neu (PATCH /text-positionen).

const ASPECT = { quadrat: '1 / 1', feed: '4 / 5', story: '9 / 16' };
const CANVAS_W = 1080;
// Basis-Schriftgrade je Block (== text-bloecke.js), fürs Proxy-Rendering.
const BASE_FONT = {
  'layout:A': { hook: 52, stelle: 150, pill: 30 },
  'layout:B': { textblock: 76, stelle: 120, pill: 30 },
  strikt: { hook: 96 },
};
const SNAP = 0.018; // Snap-Toleranz (Anteil)

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function TextPositionModal({ open, creative, onClose, onSaved }) {
  const [data, setData] = useState(null);      // Server-Antwort (bloecke, slots, …)
  const [pos, setPos] = useState({});          // { key: {x,y,scale} }
  const [sel, setSel] = useState(null);        // aktiver Block-Key
  const [guides, setGuides] = useState({ vx: [], hy: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const stageRef = useRef(null);
  const stageWRef = useRef(480);

  useEffect(() => {
    if (!open || !creative) return;
    setError(''); setData(null); setPos({}); setSel(null); setGuides({ vx: [], hy: [] });
    setLoading(true);
    api(`/creatives/${creative.id}/text-bloecke`)
      .then(d => {
        setData(d);
        const p = {};
        for (const b of d.bloecke) {
          const cur = d.positionen[b.key] || d.defaults[b.key] || { x: 0.05, y: 0.1, scale: 1 };
          p[b.key] = { x: cur.x, y: cur.y, scale: cur.scale ?? 1 };
        }
        setPos(p);
        setSel(d.bloecke[0]?.key || null);
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [open, creative]);

  const catKey = data ? (data.kind === 'layout' ? `layout:${data.vorlage}` : 'strikt') : null;
  const meta = data?.positionen || {};   // enthält w/align je Block
  const safe = data?.safe || { top: 0.04, bottom: 0.04 };

  const startDrag = useCallback((key, e) => {
    if (!stageRef.current) return;
    e.preventDefault();
    setSel(key);
    const rect = stageRef.current.getBoundingClientRect();
    stageWRef.current = rect.width;
    const w = (meta[key]?.w) || 0.8;
    const startPoint = e.touches?.[0] || e;
    const cur = pos[key] || { x: 0.05, y: 0.1 };
    // Greif-Offset innerhalb des Blocks (in Anteilen der Bühne)
    const offX = (startPoint.clientX - rect.left) / rect.width - cur.x;
    const offY = (startPoint.clientY - rect.top) / rect.height - cur.y;

    const move = (ev) => {
      const point = ev.touches?.[0] || ev;
      let x = (point.clientX - rect.left) / rect.width - offX;
      let y = (point.clientY - rect.top) / rect.height - offY;
      // Snap-Kandidaten X: linker Rand, zentriert, rechter Rand
      const xCand = [0.055, 0.5 - w / 2, 1 - 0.055 - w];
      const yCand = [safe.top, (1 - safe.top - safe.bottom) / 3 + safe.top, 0.5 - 0.06, 1 - safe.bottom - 0.16];
      const vx = [], hy = [];
      for (const c of xCand) if (Math.abs(x - c) < SNAP) { x = c; vx.push(c + w / 2); }
      for (const c of yCand) if (Math.abs(y - c) < SNAP) { y = c; hy.push(y); }
      x = clamp(x, 0, 1 - w);
      y = clamp(y, safe.top, 1 - safe.bottom - 0.05);
      setPos(prev => ({ ...prev, [key]: { ...prev[key], x, y } }));
      setGuides({ vx, hy });
    };
    const stop = () => {
      setGuides({ vx: [], hy: [] });
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', stop);
  }, [pos, meta, safe]);

  function resetBlock(key) {
    if (!data?.defaults?.[key]) return;
    const d = data.defaults[key];
    setPos(prev => ({ ...prev, [key]: { x: d.x, y: d.y, scale: d.scale ?? 1 } }));
  }

  async function save() {
    setError(''); setSaving(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(pos)) payload[k] = { x: v.x, y: v.y, scale: v.scale };
      const res = await api(`/creatives/${creative.id}/text-positionen`, {
        method: 'PATCH', body: { positionen: payload },
      });
      if (onSaved) onSaved(res.creative);
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally { setSaving(false); }
  }

  if (!open || !creative) return null;

  const stageW = stageRef.current?.getBoundingClientRect().width || stageWRef.current || 480;
  const pxFor = (key) => {
    const base = (BASE_FONT[catKey] || {})[key] || 40;
    return base * (pos[key]?.scale || 1) * (stageW / CANVAS_W);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Text anpassen"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || loading || !data}>
            {saving ? 'Rendere neu…' : 'Anwenden'}
          </button>
        </>
      }
    >
      {loading && <p style={{ color: '#5a5955' }}>Lade Textblöcke…</p>}
      {error && <p style={{ color: '#c1272d', fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {data.bloecke.map(b => (
              <button key={b.key} type="button"
                onClick={() => setSel(b.key)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: sel === b.key ? '2px solid #0078ff' : '1px solid #d5d3ce',
                  background: sel === b.key ? '#eaf3ff' : '#fff',
                  fontWeight: sel === b.key ? 700 : 500,
                }}>
                {b.label}
              </button>
            ))}
          </div>

          <div
            ref={stageRef}
            style={{
              position: 'relative', width: '100%', maxWidth: 460, margin: '0 auto',
              aspectRatio: ASPECT[data.format] || '1 / 1',
              background: '#000', borderRadius: 8, overflow: 'hidden',
              userSelect: 'none', touchAction: 'none',
            }}
          >
            {data.base_bild_url && (
              <img src={data.base_bild_url} alt="" draggable={false}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
            )}
            {data.dunkel && (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 42%, rgba(0,0,0,0.85) 100%)' }} />
            )}

            {/* Safe-Zonen (nur 9:16 relevant sichtbar) */}
            {['story'].includes(data.format) && <>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${safe.top * 100}%`,
                background: 'repeating-linear-gradient(45deg, rgba(255,60,60,0.14) 0 8px, transparent 8px 16px)',
                borderBottom: '1px dashed rgba(255,80,80,0.7)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${safe.bottom * 100}%`,
                background: 'repeating-linear-gradient(45deg, rgba(255,60,60,0.14) 0 8px, transparent 8px 16px)',
                borderTop: '1px dashed rgba(255,80,80,0.7)', pointerEvents: 'none' }} />
            </>}

            {/* Snap-Hilfslinien */}
            {guides.vx.map((x, i) => (
              <div key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x * 100}%`,
                width: 1, background: 'rgba(0,180,255,0.9)', pointerEvents: 'none' }} />
            ))}
            {guides.hy.map((y, i) => (
              <div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${y * 100}%`,
                height: 1, background: 'rgba(0,180,255,0.9)', pointerEvents: 'none' }} />
            ))}

            {/* Block-Proxies */}
            {data.bloecke.map(b => {
              const p = pos[b.key]; if (!p) return null;
              const m = meta[b.key] || { w: 0.8, align: 'left' };
              const isSel = sel === b.key;
              const txt = String(data.slots?.[b.key] || '').replace(/\*/g, '');
              return (
                <div key={b.key}
                  onMouseDown={(e) => startDrag(b.key, e)}
                  onTouchStart={(e) => startDrag(b.key, e)}
                  style={{
                    position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`,
                    width: `${m.w * 100}%`, cursor: 'grab',
                    textAlign: m.align || 'left',
                    outline: isSel ? '2px solid #0078ff' : '1px dashed rgba(255,255,255,0.55)',
                    outlineOffset: 2, borderRadius: 4, zIndex: isSel ? 6 : 5,
                  }}>
                  <ProxyText blockKey={b.key} catKey={catKey} text={txt}
                    accent={data.accent} px={pxFor(b.key)} align={m.align || 'left'} />
                </div>
              );
            })}
          </div>

          {/* Größen-Slider + Reset für den aktiven Block */}
          {sel && pos[sel] && (
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <span style={{ minWidth: 90 }}>Größe „{data.bloecke.find(b => b.key === sel)?.label}"</span>
                <input type="range" min="0.5" max="1.6" step="0.02" value={pos[sel].scale}
                  onChange={e => setPos(prev => ({ ...prev, [sel]: { ...prev[sel], scale: Number(e.target.value) } }))}
                  style={{ flex: 1 }} />
                <span style={{ minWidth: 44, textAlign: 'right', color: '#5a5955', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(pos[sel].scale * 100)}%
                </span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }}
                  onClick={() => resetBlock(sel)} title="Diesen Block auf die Vorlagen-Position zurücksetzen">
                  ↺ Vorlage
                </button>
              </label>
              <p style={{ fontSize: 12, color: '#5a5955', marginTop: 10 }}>
                Block anklicken und ziehen zum Verschieben; blaue Linien zeigen Zentrum/Drittel/Ränder.
                {data.format === 'story' && ' Die schraffierten Zonen (oben/unten) sind für Meta-Overlays reserviert — Text bleibt außerhalb.'}
                {' '}Die exakte Darstellung entsteht beim Anwenden serverseitig.
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// Grobe CSS-Nachbildung der Server-Blockstile — nur zur Positionierung, nicht
// pixelgenau (der Server rendert die Wahrheit).
function ProxyText({ blockKey, catKey, text, accent, px, align }) {
  const common = {
    fontWeight: 900, lineHeight: 1.05, textTransform: 'uppercase',
    fontSize: `${Math.max(6, px)}px`, wordBreak: 'break-word', display: 'inline-block',
    maxWidth: '100%',
  };
  if (catKey?.startsWith('layout:') && blockKey === 'hook') {
    // Marken-Balken je Zeile
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, maxWidth: '100%' }}>
        {String(text).split('\n').filter(Boolean).map((l, i) => (
          <span key={i} style={{ ...common, textTransform: 'none', background: accent, color: '#fff',
            padding: '3px 8px', borderRadius: 5, marginLeft: i * 8 }}>{l}</span>
        ))}
      </span>
    );
  }
  if (blockKey === 'pill') {
    return <span style={{ display: 'inline-block', border: '2px solid #fff', color: '#fff', borderRadius: 40,
      padding: '2px 10px', fontSize: `${Math.max(6, px)}px`, fontWeight: 800, whiteSpace: 'nowrap' }}>{text}</span>;
  }
  if (blockKey === 'stelle' && catKey === 'layout:A') {
    return <span style={{ ...common, color: accent, textShadow: `0 0 6px ${accent}` }}>{text}</span>;
  }
  if (blockKey === 'stelle' || blockKey === 'textblock') {
    return <span style={{ ...common, color: '#fff', textAlign: align }}>{text}</span>;
  }
  // strikt hook
  return <span style={{ ...common, color: accent, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>{text}</span>;
}
