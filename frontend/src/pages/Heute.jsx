import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';
import { getStartView, setStartView } from '../lib/startview.js';

const TILE_DEFS = [
  { id: 'kritisch', title: '🔴 Kritisch' },
  { id: 'close', title: '✅ Close-Tasks' },
  { id: 'todos', title: '📝 Meine To-dos' },
  { id: 'kampagnen', title: '📋 Kampagnen' },
  { id: 'bewerber', title: '👥 Bewerber' },
  { id: 'mails', title: '📧 Wichtige Mails' },
  { id: 'instantly', title: '✉️ Instantly' },
];
const DEFAULT_ORDER = TILE_DEFS.map(t => t.id);
const TOP_N = 8;
const SEV_DOT = { kritisch: '🔴', heute: '🟠', hinweis: '🟡' };
const heuteStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const CSS = `
.heute-root { display:flex; flex-direction:column; gap:10px; }
.heute-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:#0a0a0a; color:#fff; border-radius:10px; padding:8px 14px; flex:0 0 auto; }
.heute-bar a { color:#fff; }
.heute-chip { background:#ffffff1a; border:1px solid #ffffff33; color:#fff; border-radius:100px; padding:3px 10px; font-size:12px; cursor:pointer; }
.heute-chip:hover { background:#ffffff33; }
.heute-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; flex:1 1 auto; min-height:0; }
.heute-tile { display:flex; flex-direction:column; min-height:0; background:#fff; border:1px solid #ececea; border-radius:12px; overflow:hidden; transition:box-shadow .2s; }
.heute-tile.flash { box-shadow:0 0 0 3px #b4231866; }
.heute-tile.drag-over { outline:2px dashed #b54708; outline-offset:-2px; }
.heute-tile-head { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid #f0efed; cursor:grab; user-select:none; flex:0 0 auto; }
.heute-tile-head h3 { font-size:13.5px; font-weight:700; margin:0; }
.heute-badge { font-size:11px; color:#9a9994; font-weight:500; margin-left:auto; white-space:nowrap; }
.heute-tile-body { flex:1 1 auto; overflow-y:auto; min-height:0; padding:5px 7px; }
.heute-tile-foot { border-top:1px solid #f0efed; padding:6px 12px; font-size:12px; flex:0 0 auto; }
.heute-row { display:flex; align-items:center; gap:7px; padding:4px 6px; border-radius:6px; font-size:12.5px; line-height:1.3; }
.heute-row:hover { background:#fafaf8; }
.heute-row a { color:#0a0a0a; text-decoration:none; }
.heute-row a:hover { text-decoration:underline; }
.heute-row-x { border:none; background:none; cursor:pointer; color:#bbb; font-size:13px; padding:0 2px; }
.heute-row-x:hover { color:#b42318; }
.heute-empty { font-size:12.5px; color:#9a9994; font-style:italic; padding:6px; }
.heute-pop { position:absolute; right:0; top:34px; background:#fff; color:#0a0a0a; border:1px solid #ececea; border-radius:10px; box-shadow:0 8px 28px #0003; padding:12px 14px; width:320px; z-index:40; max-height:70vh; overflow:auto; }
@media (max-width: 980px) {
  .heute-root { height:auto !important; overflow:visible !important; }
  .heute-grid { grid-template-columns:1fr !important; grid-template-rows:none !important; height:auto; }
  .heute-tile { max-height:62vh; }
}`;

function AgeBadge({ days }) {
  if (days == null) return null;
  return <span style={{ fontSize: 11, color: '#9a9994', whiteSpace: 'nowrap' }}>{days <= 0 ? 'heute' : `${days}T`}</span>;
}
function ItemLink({ link, children }) {
  if (!link) return <span>{children}</span>;
  if (/^https?:\/\//.test(link)) return <a href={link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{children}</a>;
  return <Link to={link} onClick={e => e.stopPropagation()}>{children}</Link>;
}

function Row({ item, onHide }) {
  return (
    <div className="heute-row">
      <span aria-hidden>{SEV_DOT[item.severity] || '•'}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <ItemLink link={item.link}>{item.title}</ItemLink>
        {item.meta && <span style={{ color: '#9a9994' }}> — {item.meta}</span>}
      </span>
      <AgeBadge days={item.age_days} />
      {onHide && <button className="heute-row-x" title="Erledigt heute ausblenden" onClick={() => onHide(item.key)}>✓</button>}
    </div>
  );
}

export default function Heute() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erledigt, setErledigt] = useState(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [todos, setTodos] = useState([]);
  const [keys, setKeys] = useState(null);
  const [order, setOrder] = useState(DEFAULT_ORDER);
  const [hidden, setHidden] = useState([]);
  const [startIsHeute, setStartIsHeute] = useState(getStartView() === '/heute');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [flash, setFlash] = useState(null);
  const [mailsData, setMailsData] = useState(null);
  const rootRef = useRef(null);
  const tileRefs = useRef({});
  const dragId = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const applyData = useCallback((d) => {
    setData(d); setErledigt(new Set(d.erledigt_keys || [])); setTodos(d.todos || []);
  }, []);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true); setError('');
    try { applyData(await api(`/heute${refresh ? '?refresh=1' : ''}`)); }
    catch (e) { setError(e.message || 'Laden fehlgeschlagen.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [applyData]);

  const loadMails = useCallback((refresh = false) => {
    api(`/gmail/wichtige${refresh ? '?refresh=1' : ''}`).then(setMailsData).catch(e => setMailsData({ error: e.message, mails: [], konten: 0 }));
  }, []);

  useEffect(() => {
    load(false);
    loadMails();
    api('/heute/keys').then(r => setKeys(r.keys)).catch(() => {});
    api('/heute/prefs').then(r => {
      const lay = r.layout || {};
      if (Array.isArray(lay.order)) {
        const known = lay.order.filter(id => DEFAULT_ORDER.includes(id));
        setOrder([...known, ...DEFAULT_ORDER.filter(id => !known.includes(id))]);
      }
      if (Array.isArray(lay.hidden)) setHidden(lay.hidden.filter(id => DEFAULT_ORDER.includes(id)));
    }).catch(() => {});
  }, [load, loadMails]);

  // Feste Höhe (Desktop): Viewport minus Position der Wurzel. Mobile: CSS überschreibt.
  useLayoutEffect(() => {
    function fit() {
      const el = rootRef.current; if (!el) return;
      if (window.innerWidth <= 980) { el.style.height = 'auto'; el.style.overflow = 'visible'; return; }
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(420, window.innerHeight - top - 16)}px`;
      el.style.overflow = 'hidden';
    }
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [loading, order, hidden]);

  async function persistLayout(nextOrder, nextHidden) {
    try { await api('/heute/prefs', { method: 'PUT', body: { layout: { order: nextOrder, hidden: nextHidden } } }); } catch { /* best effort */ }
  }
  function toggleTile(id) {
    const next = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
    setHidden(next); persistLayout(order, next);
  }
  function onDrop(targetId) {
    const src = dragId.current; dragId.current = null; setDragOver(null);
    if (!src || src === targetId) return;
    const next = order.filter(x => x !== src);
    next.splice(next.indexOf(targetId), 0, src);
    setOrder(next); persistLayout(next, hidden);
  }

  async function hideRow(key) {
    const next = new Set(erledigt); next.add(key); setErledigt(next);
    try { await api('/heute/erledigt', { method: 'POST', body: { item_key: key } }); } catch { load(false); }
  }
  async function completeClose(id, complete) {
    try {
      await api(`/heute/close-task/${id}/complete`, { method: 'POST', body: { complete } });
      setData(d => ({ ...d, close: { ...d.close, tasks: d.close.tasks.map(t => t.id === id ? { ...t, _done: complete } : t) } }));
    } catch (e) { alert(e.message || 'Close-Aktion fehlgeschlagen.'); }
  }
  async function addTodo(text, faellig) {
    text = (text || '').trim(); if (!text) return;
    try { const { todo } = await api('/heute/todos', { method: 'POST', body: { text, faellig: faellig || null } }); setTodos(t => [...t, todo]); }
    catch (e) { alert(e.message); }
  }
  async function toggleTodo(todo) {
    try { const { todo: upd } = await api(`/heute/todos/${todo.id}`, { method: 'PATCH', body: { erledigt: !todo.erledigt } }); setTodos(t => t.map(x => x.id === todo.id ? upd : x)); }
    catch (e) { alert(e.message); }
  }
  async function deleteTodo(id) {
    try { await api(`/heute/todos/${id}`, { method: 'DELETE' }); setTodos(t => t.filter(x => x.id !== id)); }
    catch (e) { alert(e.message); }
  }
  async function saveKey(name, wert) { try { const r = await api(`/heute/keys/${name}`, { method: 'PUT', body: { wert } }); setKeys(k => ({ ...k, [name]: { ...k[name], ...r.status } })); } catch (e) { alert(e.message); } }
  async function removeKey(name) { try { const r = await api(`/heute/keys/${name}`, { method: 'DELETE' }); setKeys(k => ({ ...k, [name]: { ...k[name], ...r.status } })); } catch (e) { alert(e.message); } }
  function toggleStart() { const next = !startIsHeute; setStartIsHeute(next); setStartView(next ? '/heute' : '/kunden'); }

  function jumpToChip(text) {
    const hay = (text || '').toLowerCase();
    let target = 'kritisch';
    for (const sec of ['kritisch', 'kampagnen', 'bewerber']) {
      if ((data?.sections?.[sec] || []).some(i => hay.includes(i.title.toLowerCase().slice(0, 14)) || i.title.toLowerCase().includes(hay.slice(0, 14)))) { target = sec; break; }
    }
    const el = tileRefs.current[target];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); setFlash(target); setTimeout(() => setFlash(null), 1400); }
  }

  if (loading) return <PageContainer wide><div className="full-loading">Lade Tagesliste…</div></PageContainer>;

  const todayStr = heuteStr();
  const overdueTodos = todos.filter(t => !t.erledigt && t.faellig && t.faellig < todayStr).map(t => ({
    key: `todo-overdue:${t.id}`, severity: 'kritisch', title: `To-do überfällig: ${t.text}`, meta: `fällig ${t.faellig}`, link: null, age_days: null,
  }));
  const visible = (hidden.length || order.length) ? order.filter(id => !hidden.includes(id)) : DEFAULT_ORDER;
  const rows = Math.max(1, Math.ceil(visible.length / 3));

  const sichtbar = (arr) => (arr || []).filter(i => showHidden || !erledigt.has(i.key));

  function renderTileBody(id) {
    const s = data.sections || {};
    if (id === 'kritisch') {
      const items = [...overdueTodos, ...sichtbar(s.kritisch)];
      return items.length ? items.map(i => <Row key={i.key} item={i} onHide={i.key.startsWith('todo-') ? null : hideRow} />) : <div className="heute-empty">Nichts brennt. 🎉</div>;
    }
    if (id === 'kampagnen' || id === 'bewerber') {
      const all = sichtbar(s[id]); const top = all.slice(0, TOP_N);
      return top.length ? top.map(i => <Row key={i.key} item={i} onHide={hideRow} />) : <div className="heute-empty">Nichts offen.</div>;
    }
    if (id === 'close') {
      const c = data.close || {};
      if (!c.configured) return <div className="heute-empty">Nicht konfiguriert — Key unter ⚙︎.</div>;
      if (c.error) return <div className="heute-empty" style={{ color: '#b42318' }}>{c.error}</div>;
      if (c.hinweis) return <div className="heute-empty">{c.hinweis}</div>;
      const tasks = c.tasks || [];
      if (!tasks.length) return <div className="heute-empty">Keine fälligen Tasks heute.</div>;
      return tasks.map(t => (
        <div key={t.id} className="heute-row" style={{ opacity: t._done ? 0.5 : 1 }}>
          <input type="checkbox" checked={!!t._done} onChange={() => completeClose(t.id, !t._done)} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t._done ? 'line-through' : 'none' }}>
            {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.lead_name || t.text}</a> : (t.lead_name || t.text)}
            <span style={{ color: '#9a9994' }}> — {t.text}</span>
          </span>
          {t.overdue && <span style={{ fontSize: 11, color: '#b42318' }}>überfällig</span>}
          {t._done && <button className="heute-row-x" title="Undo" onClick={() => completeClose(t.id, false)}>↩</button>}
        </div>
      ));
    }
    if (id === 'instantly') {
      const inst = data.instantly || {};
      if (!inst.configured) return <div className="heute-empty">Nicht konfiguriert — Key unter ⚙︎.</div>;
      if (inst.error) return <div className="heute-empty" style={{ color: '#b42318' }}>{inst.error}</div>;
      const ks = inst.kampagnen || [];
      if (!ks.length) return <div className="heute-empty">Keine aktiven Kampagnen.</div>;
      return ks.map(c => (
        <div key={c.id} className="heute-row">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{c.name}</span>
          <span style={{ fontSize: 11, color: '#9a9994' }}>{c.sent_today == null ? '—' : c.sent_today} ges. · {c.replies_total ?? '—'} Repl.</span>
          <span style={{ fontSize: 11, fontWeight: c.bounce_warn ? 700 : 400, color: c.bounce_warn ? '#b42318' : '#9a9994' }}>{c.bounce_rate != null ? `${c.bounce_rate}%` : '—'}{c.bounce_warn ? '⚠️' : ''}</span>
        </div>
      ));
    }
    if (id === 'todos') return <TodosBody todos={todos} showDone={showDone} setShowDone={setShowDone} onAdd={addTodo} onToggle={toggleTodo} onDelete={deleteTodo} />;
    if (id === 'mails') return <MailsBody data={mailsData} onReload={loadMails} />;
    return null;
  }

  function tileBadge(id) {
    const s = data.sections || {};
    if (id === 'kritisch') return `${overdueTodos.length + (s.kritisch || []).length}`;
    if (id === 'close') { const c = data.close || {}; return c.configured ? `${(c.tasks || []).length} heute / ${c.total_offen ?? 0} gesamt` : ''; }
    if (id === 'kampagnen' || id === 'bewerber') { const n = (s[id] || []).length; return n > TOP_N ? `Top ${TOP_N} / ${n}` : `${n}`; }
    if (id === 'instantly') return `${(data.instantly?.kampagnen || []).length}`;
    if (id === 'todos') return `${todos.filter(t => !t.erledigt).length} offen`;
    if (id === 'mails') return !mailsData ? '…' : (mailsData.konten ? `${(mailsData.mails || []).length}` : 'kein Konto');
    return '';
  }
  function tileFooter(id) {
    const map = { kritisch: ['/controlling', 'Cockpit'], close: ['https://app.close.com/', 'Close'], kampagnen: ['/controlling', 'Cockpit'], bewerber: ['/bewerbungen', 'Bewerberliste'], mails: ['/admin/gmail', 'Konten verwalten'], instantly: [data.instantly?.unibox_url || 'https://app.instantly.ai/app/unibox', 'Unibox'] };
    const f = map[id]; if (!f) return null;
    return /^https?:/.test(f[0])
      ? <a href={f[0]} target="_blank" rel="noreferrer">Alle anzeigen → {f[1]}</a>
      : <Link to={f[0]}>Alle anzeigen → {f[1]}</Link>;
  }

  return (
    <PageContainer wide>
      <style>{CSS}</style>
      <div className="heute-root" ref={rootRef}>
        {/* Schmale Briefing-Leiste */}
        <div className="heute-bar">
          <strong style={{ fontSize: 13 }}>📅 Heute</strong>
          <span style={{ fontSize: 12.5, flex: 1, minWidth: 180, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data?.briefing?.text}>
            {data?.briefing?.text || '—'}
          </span>
          {(data?.briefing?.top3 || []).map((t, i) => (
            <button key={i} className="heute-chip" onClick={() => jumpToChip(t)} title={t}>
              {i + 1}. {t.length > 32 ? t.slice(0, 32) + '…' : t}
            </button>
          ))}
          {data?.cached && <span style={{ fontSize: 11, color: '#9a9994' }}>{data.cache_alter_sekunden}s</span>}
          <button className="heute-chip" disabled={refreshing} onClick={() => { load(true); loadMails(true); }}>{refreshing ? '…' : '↻'}</button>
          <div style={{ position: 'relative' }}>
            <button className="heute-chip" onClick={() => setSettingsOpen(o => !o)}>⚙︎</button>
            {settingsOpen && (
              <div className="heute-pop" onMouseLeave={() => setSettingsOpen(false)}>
                <label style={{ display: 'flex', gap: 6, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}><input type="checkbox" checked={startIsHeute} onChange={toggleStart} /> Als Startseite nach Login</label>
                <label style={{ display: 'flex', gap: 6, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> Erledigte Zeilen zeigen</label>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#5a5955', margin: '6px 0' }}>Kacheln</div>
                {TILE_DEFS.map(t => (
                  <label key={t.id} style={{ display: 'flex', gap: 6, fontSize: 13, marginBottom: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!hidden.includes(t.id)} onChange={() => toggleTile(t.id)} /> {t.title}
                  </label>
                ))}
                {keys && <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#5a5955', margin: '10px 0 6px' }}>API-Keys</div>
                  {Object.entries(keys).map(([name, st]) => <KeyField key={name} name={name} status={st} onSave={saveKey} onRemove={removeKey} />)}
                </>}
              </div>
            )}
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* Festes Kachelraster */}
        <div className="heute-grid" style={{ gridTemplateRows: window.innerWidth > 980 ? `repeat(${rows}, minmax(0,1fr))` : 'none' }}>
          {visible.map(id => {
            const def = TILE_DEFS.find(t => t.id === id);
            return (
              <div key={id} ref={el => (tileRefs.current[id] = el)}
                className={`heute-tile ${flash === id ? 'flash' : ''} ${dragOver === id ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); if (dragOver !== id) setDragOver(id); }}
                onDrop={() => onDrop(id)}>
                <div className="heute-tile-head" draggable
                  onDragStart={() => { dragId.current = id; }}
                  onDragEnd={() => { dragId.current = null; setDragOver(null); }}>
                  <span aria-hidden style={{ cursor: 'grab', color: '#ccc' }}>⠿</span>
                  <h3>{def?.title || id}</h3>
                  <span className="heute-badge">{tileBadge(id)}</span>
                </div>
                <div className="heute-tile-body">{renderTileBody(id)}</div>
                {tileFooter(id) && <div className="heute-tile-foot">{tileFooter(id)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}

function TodosBody({ todos, showDone, setShowDone, onAdd, onToggle, onDelete }) {
  const [text, setText] = useState('');
  const [faellig, setFaellig] = useState('');
  const offen = todos.filter(t => !t.erledigt);
  const erledigt = todos.filter(t => t.erledigt);
  const heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const morgen = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
  function submit() { onAdd(text, faellig || null); setText(''); setFaellig(''); }
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Neu… (Enter)" style={{ flex: 1, minWidth: 120, padding: '6px 8px', border: '1px solid #ececea', borderRadius: 7, fontSize: 12.5 }} />
        <input type="date" value={faellig} onChange={e => setFaellig(e.target.value)} style={{ padding: '5px 6px', border: '1px solid #ececea', borderRadius: 7, fontSize: 12 }} />
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} onClick={() => setFaellig(heute)}>heute</button>
        <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} onClick={() => setFaellig(morgen)}>morgen</button>
      </div>
      {offen.length === 0 ? <div className="heute-empty">Keine offenen To-dos.</div> : offen.map(t => (
        <div key={t.id} className="heute-row">
          <input type="checkbox" checked={false} onChange={() => onToggle(t)} />
          <span style={{ flex: 1, minWidth: 0 }}>{t.text}</span>
          {t.faellig && <span style={{ fontSize: 11, color: t.faellig < heute ? '#b42318' : '#b54708' }}>bis {t.faellig}</span>}
          <button className="heute-row-x" onClick={() => onDelete(t.id)}>✕</button>
        </div>
      ))}
      {erledigt.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowDone(!showDone)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#5a5955' }}>
            {showDone ? '▾' : '▸'} Erledigt ({erledigt.length})
          </button>
          {showDone && erledigt.map(t => (
            <div key={t.id} className="heute-row" style={{ opacity: 0.55 }}>
              <input type="checkbox" checked readOnly onChange={() => onToggle(t)} />
              <span style={{ flex: 1, minWidth: 0, textDecoration: 'line-through' }}>{t.text}</span>
              <button className="heute-row-x" onClick={() => onDelete(t.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MailsBody({ data, onReload }) {
  const [showHidden, setShowHidden] = useState(false);
  if (!data) return <div className="heute-empty">Lade Mails…</div>;
  if (data.error) return <div className="heute-empty" style={{ color: '#b42318' }}>{data.error}</div>;
  if (!data.konten) return <div className="heute-empty">Kein Gmail-Konto verbunden — <Link to="/admin/gmail">unter /admin verbinden</Link>.</div>;
  const mails = data.mails || [];
  const ausgeblendet = data.ausgeblendet || [];
  const reload = () => onReload?.(true);

  async function setRegel(muster, regel) {
    try { await api('/gmail/regeln', { method: 'POST', body: { muster, regel } }); reload(); }
    catch (e) { alert(e.message); }
  }
  async function hideMail(message_id) {
    try { await api('/gmail/ausblenden', { method: 'POST', body: { message_id } }); reload(); }
    catch (e) { alert(e.message); }
  }

  let autoLeft = 5; // Auto-Vorschlag nur für die Top-5 CRM-Mails (klasse 'crm')
  return (
    <>
      {mails.length === 0
        ? <div className="heute-empty">Keine beantwortbaren Mails. 🎉</div>
        : mails.map(m => {
            if (m.klasse === 'termin') return <TerminRow key={`${m.konto_email}:${m.id}`} mail={m} onHide={() => hideMail(m.id)} onReload={reload} />;
            const auto = m.klasse === 'crm' && autoLeft-- > 0;
            return <MailRow key={`${m.konto_email}:${m.id}`} mail={m} auto={!!auto} onBlock={() => setRegel(m.fromEmail, 'block')} onHide={() => hideMail(m.id)} />;
          })}

      {ausgeblendet.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px dashed #ececea', paddingTop: 6 }}>
          <button onClick={() => setShowHidden(s => !s)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#9a9994' }}>
            {showHidden ? '▾' : '▸'} 🔇 {ausgeblendet.length} ausgeblendet (Verteiler/automatisch)
          </button>
          {showHidden && ausgeblendet.map(m => (
            <div key={`${m.konto_email}:${m.id}`} className="heute-row" style={{ opacity: 0.7 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <a href={m.link} target="_blank" rel="noreferrer">{m.subject}</a>
                <span style={{ color: '#9a9994' }}> — {m.fromEmail} · {m.grund}</span>
              </span>
              <button className="heute-row-x" title="Absender immer anzeigen" style={{ color: '#027a48', fontSize: 11 }} onClick={() => setRegel(m.fromEmail, 'allow')}>+ immer</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function KontextChip({ kontext, klasse }) {
  if (kontext?.typ === 'kunde') return <span style={{ fontSize: 11, color: '#027a48' }}>🏢 {kontext.firmenname}{kontext.projekt_status ? ` · ${kontext.projekt_status}` : ''}{kontext.naechster_schritt ? ` · ${kontext.naechster_schritt}` : ''}</span>;
  if (kontext?.typ === 'bewerber') return <span style={{ fontSize: 11, color: '#1d4ed8' }}>👤 {kontext.name}{kontext.job_stelle ? ` · ${kontext.job_stelle}` : ''} · {kontext.telefonisten_status}</span>;
  return <span style={{ fontSize: 11, color: '#9a9994' }}>✉︎ persönlich</span>;
}

function MailRow({ mail, auto, onBlock, onHide }) {
  const [vorschlag, setVorschlag] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hinweis, setHinweis] = useState(null);
  const [status, setStatus] = useState(null); // 'gesendet' | 'draft'
  const [countdown, setCountdown] = useState(0);
  const timer = useRef(null);
  const kontoId = mail.konto_email;

  const request = useCallback(async () => {
    setBusy(true); setOpen(true); setHinweis(null);
    try {
      const r = await api('/gmail/vorschlag', { method: 'POST', body: { kontoId, messageId: mail.id } });
      setVorschlag(r.vorschlag || ''); setHinweis(r.hinweis || null);
    } catch (e) { setVorschlag(''); setHinweis(e.message); }
    finally { setBusy(false); }
  }, [kontoId, mail.id]);

  useEffect(() => { if (auto) request(); }, [auto, request]);

  function startSend() {
    setCountdown(10);
    timer.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer.current); timer.current = null;
          api('/gmail/senden', { method: 'POST', body: { kontoId, messageId: mail.id, text: vorschlag } })
            .then(() => { setStatus('gesendet'); setOpen(false); })
            .catch(e => { setHinweis(e.message); });
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }
  function undo() { if (timer.current) { clearInterval(timer.current); timer.current = null; } setCountdown(0); }
  async function draft() {
    setBusy(true);
    try { await api('/gmail/draft', { method: 'POST', body: { kontoId, messageId: mail.id, text: vorschlag } }); setStatus('draft'); setOpen(false); }
    catch (e) { setHinweis(e.message); } finally { setBusy(false); }
  }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return (
    <div style={{ padding: '6px 6px', borderBottom: '1px solid #f4f4f2' }}>
      <div className="heute-row" style={{ padding: 0 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <a href={mail.link} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{mail.subject}</a>
          <span style={{ color: '#9a9994' }}> — {mail.from?.replace(/<[^>]+>/, '').trim() || mail.fromEmail}</span>
        </span>
        <AgeBadge days={mail.ageTage} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 0' }}>
        <KontextChip kontext={mail.kontext} klasse={mail.klasse} />
        <span style={{ flex: 1 }} />
        {status === 'gesendet' ? <span style={{ fontSize: 11, color: '#027a48' }}>✓ gesendet</span>
          : status === 'draft' ? <span style={{ fontSize: 11, color: '#1d4ed8' }}>✓ als Entwurf abgelegt</span>
          : !open ? <>
              <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} onClick={request}>✏︎ Antwort vorschlagen</button>
              {onBlock && <button className="heute-row-x" title="Absender nie anzeigen" style={{ fontSize: 11 }} onClick={onBlock}>🔇</button>}
              {onHide && <button className="heute-row-x" title="Diese Mail ausblenden" onClick={onHide}>✕</button>}
            </>
          : null}
      </div>
      {open && status == null && (
        <div style={{ marginTop: 5 }}>
          {busy && !vorschlag ? <div className="heute-empty">KI formuliert…</div> : (
            <>
              {hinweis && <div style={{ fontSize: 11, color: '#b54708', marginBottom: 3 }}>Hinweis: {hinweis}</div>}
              <textarea value={vorschlag} onChange={e => setVorschlag(e.target.value)} rows={5}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #ececea', borderRadius: 7, fontSize: 12.5, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center' }}>
                {countdown > 0 ? (
                  <>
                    <span style={{ fontSize: 12, color: '#b54708' }}>Senden in {countdown}s…</span>
                    <button className="heute-chip" style={{ background: '#b42318', color: '#fff' }} onClick={undo}>↩ Rückgängig</button>
                  </>
                ) : (
                  <>
                    <button className="heute-chip" style={{ background: '#0a0a0a', color: '#fff' }} disabled={busy || !vorschlag.trim()} onClick={startSend}>Senden</button>
                    <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} disabled={busy || !vorschlag.trim()} onClick={draft}>Als Gmail-Entwurf</button>
                    <button className="heute-chip" style={{ background: 'none', color: '#999', border: 'none' }} onClick={() => setOpen(false)}>✕</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TerminRow({ mail, onHide, onReload }) {
  const [busy, setBusy] = useState(false);
  const [badge, setBadge] = useState(null);
  const [err, setErr] = useState(null);
  const t = mail.termin || {};
  const BADGES = { annehmen: '✓ Zugesagt', vielleicht: '~ Vielleicht', ablehnen: '✗ Abgesagt' };
  async function respond(status) {
    setBusy(true); setErr(null);
    try {
      await api('/gmail/termin/antwort', { method: 'POST', body: { kontoId: mail.konto_email, messageId: mail.id, status } });
      setBadge(BADGES[status]);
      // RSVP erledigt → Mail ausblenden, verschwindet beim nächsten Refresh.
      try { await api('/gmail/ausblenden', { method: 'POST', body: { message_id: mail.id } }); } catch { /* egal */ }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div style={{ padding: '6px 6px', borderBottom: '1px solid #f4f4f2', background: '#fbfbff' }}>
      <div className="heute-row" style={{ padding: 0 }}>
        <span aria-hidden>📅</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <a href={mail.link} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{t.titel || mail.subject}</a>
          {t.start && <span style={{ color: '#1d4ed8' }}> · {t.start}</span>}
          {t.organizer && <span style={{ color: '#9a9994' }}> · {String(t.organizer).replace(/<[^>]+>/, '').trim()}</span>}
        </span>
        {onHide && <button className="heute-row-x" title="Diese Mail ausblenden" onClick={onHide}>✕</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
        {badge ? <span style={{ fontSize: 12, color: '#027a48', fontWeight: 600 }}>{badge} <span style={{ color: '#9a9994', fontWeight: 400 }}>— verschwindet beim nächsten Refresh</span></span>
          : t.iCalUID ? <>
              <button className="heute-chip" style={{ background: '#027a48', color: '#fff' }} disabled={busy} onClick={() => respond('annehmen')}>Annehmen</button>
              <button className="heute-chip" style={{ background: '#b54708', color: '#fff' }} disabled={busy} onClick={() => respond('vielleicht')}>Vielleicht</button>
              <button className="heute-chip" style={{ background: '#b42318', color: '#fff' }} disabled={busy} onClick={() => respond('ablehnen')}>Ablehnen</button>
            </>
          : <span style={{ fontSize: 11, color: '#9a9994' }}>Einladung erkannt (keine RSVP-Kennung)</span>}
      </div>
      {err && <div style={{ fontSize: 11, color: '#b42318', marginTop: 3 }}>{err}</div>}
    </div>
  );
}

function KeyField({ name, status, onSave, onRemove }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12.5 }}>{status.label} — <span style={{ color: status.gesetzt ? '#027a48' : '#b42318' }}>{status.gesetzt ? `✓ ${status.hinweis} (${status.quelle})` : 'nicht gesetzt'}</span></div>
      <div style={{ display: 'flex', gap: 5, marginTop: 3 }}>
        <input type="password" value={val} onChange={e => setVal(e.target.value)} placeholder="Key…" style={{ flex: 1, padding: '5px 7px', border: '1px solid #ececea', borderRadius: 7, fontSize: 12 }} />
        <button className="heute-chip" style={{ background: '#0a0a0a', color: '#fff' }} disabled={!val.trim()} onClick={() => { onSave(name, val.trim()); setVal(''); }}>OK</button>
        {status.quelle === 'settings' && <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} onClick={() => onRemove(name)}>✕</button>}
      </div>
    </div>
  );
}
