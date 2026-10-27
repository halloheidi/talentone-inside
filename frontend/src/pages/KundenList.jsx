import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import QuickCreateModal from '../components/QuickCreateModal.jsx';
import NaechsterSchrittStapel from '../components/NaechsterSchrittBadge.jsx';
import AvvAnfrageModal from '../components/AvvAnfrageModal.jsx';
import ProjektStatusSelect, { STATUS_META } from '../components/ProjektStatusSelect.jsx';

const VIEW_KEY = 'kundenList.view';     // 'kanban' | 'liste'
const MODE_KEY = 'kundenList.mode';     // 'kunden' | 'projekte'
const FILTER_KEY = 'kundenList.listFilter';

const GRUPPEN = [
  { key: 'vorbereitung', label: 'Vorbereitung', farbe: '#991b1b', bg: '#fef2f2' },
  { key: 'live',         label: 'Live',         farbe: '#166534', bg: '#f0fdf4' },
  { key: 'pausiert',     label: 'Pausiert',     farbe: '#92400e', bg: '#fffbeb' },
  { key: 'abgeschlossen',label: 'Abgeschlossen',farbe: '#065f46', bg: '#ecfdf5' },
];
const LEITSTATUS = { vorbereitung: 'vorbereitung', live: 'live', pausiert: 'pausiert', abgeschlossen: 'abgeschlossen' };
function gruppeVonStatus(s) {
  if (s === 'live') return 'live';
  if (['feedbackschleife', 'hold', 'pausiert'].includes(s)) return 'pausiert';
  if (s === 'abgeschlossen') return 'abgeschlossen';
  return 'vorbereitung';
}

function truncate(s, n = 80) { if (!s) return ''; return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; }

function WerbekostenChip({ value }) {
  const v = value || null;
  if (!v) return <span style={{ color: 'var(--ink-4, #999)' }}>—</span>;
  const label = v === 'Kunde' ? 'K' : v === 'N&W' ? 'N&W' : v;
  const isKunde = v === 'Kunde';
  return (
    <span title={`Werbekosten: ${v}`} style={{ display: 'inline-flex', alignItems: 'center', background: isKunde ? '#dbeafe' : '#ede9fe', color: isKunde ? '#1e40af' : '#5b21b6', border: `1px solid ${isKunde ? '#bfdbfe' : '#ddd6fe'}`, padding: '1px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700 }}>{label}</span>
  );
}

function KommentarPopover({ info }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = info?.kommentar_count || 0;
  const letzte = info?.letzte || [];
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!count) return <span style={{ color: 'var(--ink-4, #999)' }}>—</span>;
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }} title={`${count} Kommentar${count === 1 ? '' : 'e'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>💬 {count}</button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, width: 280, background: '#fff', border: '1px solid var(--line, #e2e0dc)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12, textAlign: 'left' }}>
          {letzte.length === 0 ? <div style={{ fontSize: 12, color: 'var(--ink-3, #666)' }}>Keine Vorschau.</div>
            : letzte.slice(0, 3).map((k, i) => (
              <div key={i} style={{ padding: '6px 0', borderTop: i > 0 ? '1px solid var(--bg-2, #f0f0ee)' : 'none' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3, #666)' }}><strong>{k.autor || 'Unbekannt'}</strong>{k.created_at ? ` · ${new Date(k.created_at).toLocaleDateString('de-DE')}` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-1, #333)', marginTop: 2 }}>{truncate(k.text)}</div>
              </div>
            ))}
        </div>
      )}
    </span>
  );
}

function KundeLogo({ k, size = 40 }) {
  return (
    <div className={`kunde-card-logo ${k.logo_url ? 'has-image' : ''}`} style={{ width: size, height: size, borderRadius: 8, fontSize: size * 0.4, flexShrink: 0 }}>
      {k.logo_url ? <img src={k.logo_url} alt="" /> : <span>{(k.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

// Projekt-Chip in der Kundenkarte: Name · Status-Dropdown · Mini-Laufzeit · ⚠
function ProjektChip({ projekt, onUpdated }) {
  const hinweise = projekt.hinweise || [];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', borderTop: '1px solid var(--bg-2, #f0f0ee)' }}
      onClick={e => e.stopPropagation()}>
      <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projekt.projekt || '—'}</span>
      <ProjektStatusSelect projekt={projekt} onUpdated={onUpdated} compact />
      {projekt.laufzeit_kurz && <span style={{ fontSize: 11, color: 'var(--ink-3)', background: '#f3f4f6', padding: '1px 6px', borderRadius: 6 }}>{projekt.laufzeit_kurz}</span>}
      {hinweise.length > 0 && <span title={hinweise.join(' · ')} style={{ cursor: 'help' }}>⚠</span>}
    </div>
  );
}

function KundenKanban({ kunden, schritteMap, onProjektUpdated }) {
  const byGruppe = useMemo(() => {
    const g = { vorbereitung: [], live: [], pausiert: [], abgeschlossen: [] };
    for (const k of kunden) (g[k.status_gruppe] || g.vorbereitung).push(k);
    return g;
  }, [kunden]);
  const [collapsed, setCollapsed] = useState({ abgeschlossen: true });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))', gap: 12, overflowX: 'auto' }}>
      {GRUPPEN.map(col => {
        const items = byGruppe[col.key] || [];
        const zu = collapsed[col.key];
        return (
          <div key={col.key} style={{ minWidth: 240 }}>
            <div onClick={() => setCollapsed(c => ({ ...c, [col.key]: !c[col.key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: col.bg, borderRadius: 8, cursor: 'pointer', position: 'sticky', top: 0 }}>
              <strong style={{ color: col.farbe, fontSize: 13 }}>{col.label}</strong>
              <span style={{ fontSize: 12, color: col.farbe, opacity: 0.8 }}>{items.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: col.farbe }}>{zu ? '▸' : '▾'}</span>
            </div>
            {!zu && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {items.map(k => (
                  <Link key={k.id} to={`/kunden/${k.id}`} style={{ textDecoration: 'none', color: 'inherit', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'block' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <KundeLogo k={k} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.firmenname || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>👥 {k.bewerbungen_7t} / 7T · {k.bewerbungen_gesamt} gesamt</div>
                      </div>
                    </div>
                    {schritteMap[k.id]?.length > 0 && <div style={{ marginTop: 6 }}><NaechsterSchrittStapel items={schritteMap[k.id]} kundeId={k.id} max={2} /></div>}
                    {k.projekte?.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {k.projekte.map(p => <ProjektChip key={p.id} projekt={p} onUpdated={onProjektUpdated} />)}
                      </div>
                    )}
                  </Link>
                ))}
                {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: 8 }}>—</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProjektKanban({ projekte, onReload }) {
  const [collapsed, setCollapsed] = useState({ abgeschlossen: true });
  const [dragId, setDragId] = useState(null);
  const byGruppe = useMemo(() => {
    const g = { vorbereitung: [], live: [], pausiert: [], abgeschlossen: [] };
    for (const p of projekte) (g[gruppeVonStatus(p.status)] || g.vorbereitung).push(p);
    return g;
  }, [projekte]);

  async function drop(col) {
    const id = dragId; setDragId(null);
    if (!id) return;
    const p = projekte.find(x => x.id === id);
    if (!p || gruppeVonStatus(p.status) === col) return;
    try { await api(`/projekte/${id}`, { method: 'PATCH', body: { status: LEITSTATUS[col] } }); onReload?.(); }
    catch (e) { alert(e.message); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))', gap: 12, overflowX: 'auto' }}>
      {GRUPPEN.map(col => {
        const items = byGruppe[col.key] || [];
        const zu = collapsed[col.key];
        return (
          <div key={col.key} style={{ minWidth: 240 }}
            onDragOver={e => { e.preventDefault(); }} onDrop={() => drop(col.key)}>
            <div onClick={() => setCollapsed(c => ({ ...c, [col.key]: !c[col.key] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: col.bg, borderRadius: 8, cursor: 'pointer' }}>
              <strong style={{ color: col.farbe, fontSize: 13 }}>{col.label}</strong>
              <span style={{ fontSize: 12, color: col.farbe, opacity: 0.8 }}>{items.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: col.farbe }}>{zu ? '▸' : '▾'}</span>
            </div>
            {!zu && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, minHeight: 40 }}>
                {items.map(p => {
                  const meta = STATUS_META[p.status] || {};
                  return (
                    <div key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}
                      style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 10, cursor: 'grab', opacity: dragId === p.id ? 0.5 : 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.projekt || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{p.kunde || '—'}</div>
                      <div style={{ marginTop: 6 }}>
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: meta.bg || '#e5e7eb', color: meta.color || '#374151' }}>{meta.emoji || '·'} {meta.label || p.status}</span>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: 8, border: '1px dashed var(--line)', borderRadius: 8, textAlign: 'center' }}>hierher ziehen</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function KundenList() {
  const [kanbanKunden, setKanbanKunden] = useState([]);
  const [projekte, setProjekte] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [avvKunde, setAvvKunde] = useState(null);
  const [search, setSearch] = useState('');
  const [agenturFilter, setAgenturFilter] = useState('');
  const [altbestand, setAltbestand] = useState(false);
  const [schritteMap, setSchritteMap] = useState({});
  const [projektMap, setProjektMap] = useState({});
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'kanban'; } catch { return 'kanban'; } });
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(MODE_KEY) || 'kunden'; } catch { return 'kunden'; } });
  const [listFilter, setListFilter] = useState(() => { try { return localStorage.getItem(FILTER_KEY) || 'alle'; } catch { return 'alle'; } });

  const setViewP = v => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch {} };
  const setModeP = m => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch {} };
  const setFilterP = f => { setListFilter(f); try { localStorage.setItem(FILTER_KEY, f); } catch {} };

  function load() {
    setLoading(true);
    const q = altbestand ? '?include_archived=1' : '';
    Promise.all([
      api(`/kunden/kanban${q}`).then(r => r.kunden || []).catch(() => []),
      api('/projekte').then(r => r.projekte || []).catch(() => []),
    ]).then(([kk, pp]) => {
      setKanbanKunden(kk);
      setProjekte(pp);
      const ids = kk.map(k => k.id).join(',');
      if (ids) {
        api(`/kunden/naechste-schritte?ids=${ids}`).then(r => setSchritteMap(r.schritte || {})).catch(() => setSchritteMap({}));
        api(`/kunden/projekt-uebersicht?ids=${ids}`).then(r => setProjektMap(r || {})).catch(() => setProjektMap({}));
      }
    }).catch(err => setError(err.message)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [altbestand]);

  const gefilterteKunden = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kanbanKunden.filter(k => {
      if (agenturFilter && k.agentur !== agenturFilter) return false;
      if (listFilter !== 'alle' && k.status_gruppe !== listFilter) return false;
      if (!q) return true;
      return [k.firmenname].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [kanbanKunden, search, agenturFilter, listFilter]);

  const gefilterteProjekte = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projekte.filter(p => {
      if (!altbestand && !p.kunde_id) return false;   // Alt-Projekte nur im Altbestand
      if (agenturFilter && p.agentur !== agenturFilter) return false;
      if (!q) return true;
      return [p.projekt, p.kunde].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [projekte, search, agenturFilter, altbestand]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Kunden</h1>
          <p className="page-sub">Kanban &amp; Liste — nach Kunde oder Projekt.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="proj-view-toggle">
            <button className={`pub-filter ${mode === 'kunden' ? 'is-active' : ''}`} onClick={() => setModeP('kunden')}>Kunden</button>
            <button className={`pub-filter ${mode === 'projekte' ? 'is-active' : ''}`} onClick={() => setModeP('projekte')}>Projekte</button>
          </div>
          <div className="proj-view-toggle">
            <button className={`pub-filter ${view === 'kanban' ? 'is-active' : ''}`} onClick={() => setViewP('kanban')}>Kanban</button>
            <button className={`pub-filter ${view === 'liste' ? 'is-active' : ''}`} onClick={() => setViewP('liste')}>Liste</button>
          </div>
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Icon name="plus" /> Neuer Kunde</button>
        </div>
      </div>

      <section className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="filter-group" style={{ flex: 1, minWidth: 220 }}>
          <label>Suche</label>
          <input type="text" placeholder="Firma / Projekt…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-group">
          <label>Agentur</label>
          <select value={agenturFilter} onChange={e => setAgenturFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowagwirth">Nowag &amp; Wirth</option>
          </select>
        </div>
        <div className="filter-group" style={{ alignSelf: 'flex-end' }}>
          <button className={`pub-filter ${altbestand ? 'is-active' : ''}`} onClick={() => setAltbestand(v => !v)} title="Archivierte Kunden + Alt-Projekte ohne Kunde">📦 Altbestand</button>
        </div>
      </section>

      {view === 'liste' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {['alle', ...GRUPPEN.map(g => g.key)].map(f => (
            <button key={f} className={`pub-filter ${listFilter === f ? 'is-active' : ''}`} onClick={() => setFilterP(f)}>
              {f === 'alle' ? 'Alle' : GRUPPEN.find(g => g.key === f)?.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card empty">Lade…</div>}

      {!loading && view === 'kanban' && mode === 'kunden' && (
        <KundenKanban kunden={gefilterteKunden} schritteMap={schritteMap} onProjektUpdated={() => load()} />
      )}
      {!loading && view === 'kanban' && mode === 'projekte' && (
        <>
          <div className="alert" style={{ background: '#eef3ff', color: '#1b3f80', marginBottom: 10, fontSize: 13 }}>
            Ziehen ändert den Leitstatus der Zielspalte. Feinstatus &amp; Details weiter unter <Link to="/projekte">Projekte-Board</Link>.
          </div>
          <ProjektKanban projekte={gefilterteProjekte} onReload={() => load()} />
        </>
      )}

      {!loading && view === 'liste' && (
        <div style={{ width: '100%' }}>
          <table className="bewerbungen-table" style={{ width: '100%', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th>Firma</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 120 }}>Laufzeit</th>
                <th style={{ width: 70 }}>Werbek.</th>
                <th>Nächster Schritt</th>
                <th style={{ width: 64 }}>Komm.</th>
              </tr>
            </thead>
            <tbody>
              {gefilterteKunden.map(k => {
                const aktiv = (k.projekte || [])[0];
                const g = GRUPPEN.find(x => x.key === k.status_gruppe);
                const feinstatus = aktiv ? (STATUS_META[aktiv.status]?.label || aktiv.status) : '—';
                return (
                  <tr key={k.id} style={{ cursor: 'pointer' }} onClick={() => window.location.assign(`/kunden/${k.id}`)}>
                    <td><KundeLogo k={k} size={32} /></td>
                    <td><strong>{k.firmenname || '—'}</strong></td>
                    <td><span title={`Feinstatus: ${feinstatus}`} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: g?.bg, color: g?.farbe }}>{g?.label}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{aktiv?.laufzeit_kurz || '—'}{aktiv?.hinweise?.length ? ' ⚠' : ''}</td>
                    <td><WerbekostenChip value={projektMap[k.id]?.werbekosten} /></td>
                    <td onClick={e => e.stopPropagation()}><NaechsterSchrittStapel items={schritteMap[k.id]} kundeId={k.id} max={3} /></td>
                    <td onClick={e => e.stopPropagation()}><KommentarPopover info={projektMap[k.id]} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {gefilterteKunden.length === 0 && <div className="card empty"><p>Keine Treffer.</p></div>}
        </div>
      )}

      <QuickCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
      <AvvAnfrageModal open={!!avvKunde} kunde={avvKunde} onClose={() => setAvvKunde(null)} />
    </div>
  );
}
