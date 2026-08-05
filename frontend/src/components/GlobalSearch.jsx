// Globale Suche / Command-Palette (Cmd+K / Ctrl+K).
// Öffnet ein zentriertes Overlay, sucht live (debounced, ab 2 Zeichen) über
// Kunden, Projekte und Jobs und navigiert per Pfeiltasten/Enter oder Klick.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const TYP_LABEL = { kunde: 'Kunde', projekt: 'Projekt', stelle: 'Stelle' };

export default function GlobalSearch() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ kunden: [], projekte: [], jobs: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // Cmd+K / Ctrl+K global — öffnet/schließt.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    // Öffnen von außen (Sidebar-Trigger)
    const onOpen = () => setOpen(true);
    window.addEventListener('open-global-search', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-global-search', onOpen); };
  }, []);

  // Beim Öffnen: fokussieren + zurücksetzen.
  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 20); }
    else { setQ(''); setRes({ kunden: [], projekte: [], jobs: [] }); setActive(0); }
  }, [open]);

  // Debounced Suche.
  useEffect(() => {
    clearTimeout(timerRef.current);
    const s = q.trim();
    const eff = s.replace(/^archiv:/i, '').trim();
    if (eff.length < 2) { setRes({ kunden: [], projekte: [], jobs: [] }); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api(`/suche?q=${encodeURIComponent(s)}`);
        setRes({ kunden: r.kunden || [], projekte: r.projekte || [], jobs: r.jobs || [] });
        setActive(0);
      } catch { setRes({ kunden: [], projekte: [], jobs: [] }); }
      finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  // Flache Trefferliste (für Tastatur-Navigation) + Ziel-Routen.
  const items = useMemo(() => {
    const out = [];
    for (const k of res.kunden) out.push({
      typ: 'kunde', id: k.id, label: k.firmenname || k.email || '—',
      sub: [k.ansprechpartner, k.email].filter(Boolean).join(' · '),
      badge: k.archiviert ? 'archiviert' : (k.agentur === 'nowagwirth' ? 'N&W' : k.agentur === 'talentone' ? 'TalentOne' : null),
      to: `/kunden/${k.id}`, logo: k.logo_url,
    });
    for (const p of res.projekte) out.push({
      typ: 'projekt', id: p.id, label: p.projekt || p.kunde || 'Projekt',
      sub: p.kunde || '', badge: p.status || null,
      to: p.kunde_id ? `/kunden/${p.kunde_id}` : '/projekte',
    });
    for (const j of res.jobs) out.push({
      typ: 'stelle', id: j.id, label: j.stelle || 'Stelle',
      sub: j.region || '', badge: null,
      to: j.kunde_id ? `/kunden/${j.kunde_id}/jobs/${j.id}/stelle` : '/kunden',
    });
    return out;
  }, [res]);

  const go = useCallback((item) => {
    if (!item) return;
    setOpen(false);
    nav(item.to);
  }, [nav]);

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
  }

  if (!open) return null;

  const gruppen = [
    { typ: 'kunde', titel: 'Kunden', list: res.kunden },
    { typ: 'projekt', titel: 'Projekte', list: res.projekte },
    { typ: 'stelle', titel: 'Stellen', list: res.jobs },
  ];
  let flatIdx = -1;

  return (
    <div onMouseDown={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{ width: 'min(640px, 92vw)', background: 'var(--bg, #fff)', color: 'var(--ink, #111)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden', border: '1px solid var(--line, #e5e5e5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line, #eee)' }}>
          <span style={{ fontSize: 18, opacity: 0.6 }}>🔍</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Kunden, Projekte, Stellen suchen…  (archiv: für archivierte Kunden)"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, background: 'transparent', color: 'inherit' }} />
          <kbd style={{ fontSize: 11, color: 'var(--ink-3, #888)', border: '1px solid var(--line,#ddd)', borderRadius: 5, padding: '2px 6px' }}>Esc</kbd>
        </div>

        <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {q.trim().replace(/^archiv:/i, '').trim().length < 2 ? (
            <div style={{ padding: '22px 16px', color: 'var(--ink-3, #888)', fontSize: 14 }}>Mindestens 2 Zeichen eingeben…</div>
          ) : loading && items.length === 0 ? (
            <div style={{ padding: '22px 16px', color: 'var(--ink-3, #888)', fontSize: 14 }}>Suche…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '22px 16px', color: 'var(--ink-3, #888)', fontSize: 14 }}>Keine Treffer.</div>
          ) : (
            gruppen.filter(g => g.list.length).map(g => (
              <div key={g.typ}>
                <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3, #999)' }}>{g.titel}</div>
                {g.list.map(row => {
                  flatIdx++;
                  const idx = flatIdx;
                  const item = items[idx];
                  const isActive = idx === active;
                  return (
                    <div key={g.typ + item.id} onMouseEnter={() => setActive(idx)} onClick={() => go(item)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', background: isActive ? 'var(--gray-50, #f3f3f1)' : 'transparent' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3,#999)', minWidth: 54 }}>{TYP_LABEL[item.typ]}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: 12, color: 'var(--ink-3,#888)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</div>}
                      </div>
                      {item.badge && <span style={{ fontSize: 11, color: 'var(--ink-3,#888)', border: '1px solid var(--line,#e5e5e5)', borderRadius: 100, padding: '1px 8px', whiteSpace: 'nowrap' }}>{item.badge}</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 16px', borderTop: '1px solid var(--line,#eee)', fontSize: 11, color: 'var(--ink-3,#999)' }}>
          <span>↑↓ Navigieren</span><span>↵ Öffnen</span><span>Esc Schließen</span>
        </div>
      </div>
    </div>
  );
}
