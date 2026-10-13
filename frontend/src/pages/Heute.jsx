import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';
import { getStartView, setStartView } from '../lib/startview.js';

const SEV_COLOR = { kritisch: '#b42318', heute: '#b54708', hinweis: '#5a5955' };
const SEV_BG = { kritisch: '#fef3f2', heute: '#fffaeb', hinweis: '#fafaf8' };

function ItemLink({ link, children }) {
  if (!link) return <span>{children}</span>;
  if (/^https?:\/\//.test(link)) return <a href={link} target="_blank" rel="noreferrer">{children}</a>;
  return <Link to={link}>{children}</Link>;
}

function Row({ item, hidden, onToggleHide }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px',
      borderLeft: `3px solid ${SEV_COLOR[item.severity] || '#ccc'}`,
      background: hidden ? '#f4f4f2' : (SEV_BG[item.severity] || '#fff'),
      borderRadius: 8, marginBottom: 6, opacity: hidden ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a' }}>
          <ItemLink link={item.link}>{item.title}</ItemLink>
        </div>
        {item.meta && <div style={{ fontSize: 12.5, color: '#5a5955', marginTop: 2 }}>{item.meta}</div>}
      </div>
      <label style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input type="checkbox" checked={hidden} onChange={() => onToggleHide(item.key)} />
        erledigt
      </label>
    </div>
  );
}

function Section({ title, items, erledigt, showHidden, onToggleHide }) {
  const sichtbar = items.filter(i => showHidden || !erledigt.has(i.key));
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>{title} <span style={{ color: '#9a9994', fontWeight: 500 }}>({sichtbar.length})</span></h2>
      {sichtbar.length === 0
        ? <div style={{ fontSize: 13, color: '#9a9994', fontStyle: 'italic', padding: '4px 2px' }}>Nichts offen.</div>
        : sichtbar.map(i => <Row key={i.key} item={i} hidden={erledigt.has(i.key)} onToggleHide={onToggleHide} />)}
    </section>
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
  const [neuTodo, setNeuTodo] = useState('');
  const [neuFaellig, setNeuFaellig] = useState('');
  const [keys, setKeys] = useState(null);
  const [startIsHeute, setStartIsHeute] = useState(getStartView() === '/heute');

  const applyData = useCallback((d) => {
    setData(d);
    setErledigt(new Set(d.erledigt_keys || []));
    setTodos(d.todos || []);
  }, []);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const d = await api(`/heute${refresh ? '?refresh=1' : ''}`);
      applyData(d);
    } catch (e) { setError(e.message || 'Laden fehlgeschlagen.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [applyData]);

  useEffect(() => { load(false); api('/heute/keys').then(r => setKeys(r.keys)).catch(() => {}); }, [load]);

  async function toggleHide(key) {
    const isHidden = erledigt.has(key);
    const next = new Set(erledigt);
    isHidden ? next.delete(key) : next.add(key);
    setErledigt(next);
    try {
      if (isHidden) await api(`/heute/erledigt?item_key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      else await api('/heute/erledigt', { method: 'POST', body: { item_key: key } });
    } catch { load(false); }
  }

  async function completeClose(id, complete) {
    try {
      await api(`/heute/close-task/${id}/complete`, { method: 'POST', body: { complete } });
      setData(d => ({ ...d, close: { ...d.close, tasks: d.close.tasks.map(t => t.id === id ? { ...t, _done: complete } : t) } }));
    } catch (e) { alert(e.message || 'Close-Aktion fehlgeschlagen.'); }
  }

  async function addTodo() {
    const text = neuTodo.trim(); if (!text) return;
    try {
      const { todo } = await api('/heute/todos', { method: 'POST', body: { text, faellig: neuFaellig || null } });
      setTodos(t => [...t, todo]); setNeuTodo(''); setNeuFaellig('');
    } catch (e) { alert(e.message); }
  }
  async function toggleTodo(todo) {
    try {
      const { todo: upd } = await api(`/heute/todos/${todo.id}`, { method: 'PATCH', body: { erledigt: !todo.erledigt } });
      setTodos(t => t.map(x => x.id === todo.id ? upd : x));
    } catch (e) { alert(e.message); }
  }
  async function deleteTodo(id) {
    try { await api(`/heute/todos/${id}`, { method: 'DELETE' }); setTodos(t => t.filter(x => x.id !== id)); }
    catch (e) { alert(e.message); }
  }

  async function saveKey(name, wert) {
    try { const r = await api(`/heute/keys/${name}`, { method: 'PUT', body: { wert } }); setKeys(k => ({ ...k, [name]: { ...k[name], ...r.status } })); }
    catch (e) { alert(e.message); }
  }
  async function removeKey(name) {
    try { const r = await api(`/heute/keys/${name}`, { method: 'DELETE' }); setKeys(k => ({ ...k, [name]: { ...k[name], ...r.status } })); }
    catch (e) { alert(e.message); }
  }

  function toggleStart() {
    const next = !startIsHeute;
    setStartIsHeute(next);
    setStartView(next ? '/heute' : '/kunden');
  }

  if (loading) return <PageContainer wide><div className="full-loading">Lade Tagesliste…</div></PageContainer>;

  return (
    <PageContainer wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📅 Heute</h1>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#5a5955', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={startIsHeute} onChange={toggleStart} /> Als Startseite nach Login
          </label>
          <label style={{ fontSize: 12, color: '#5a5955', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> Erledigte zeigen
          </label>
          {data?.cached && <span style={{ fontSize: 11, color: '#9a9994' }}>Stand vor {data.cache_alter_sekunden}s</span>}
          <button className="btn-primary" disabled={refreshing} onClick={() => load(true)}>{refreshing ? 'Aktualisiere…' : '↻ Aktualisieren'}</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {data?.briefing && (
        <div style={{ background: '#0a0a0a', color: '#fff', borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a9994', marginBottom: 6 }}>🤖 Tagesbriefing</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{data.briefing.text}</div>
          {Array.isArray(data.briefing.top3) && data.briefing.top3.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
              {data.briefing.top3.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
            </ul>
          )}
        </div>
      )}

      {data?.counts && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {[['kritisch', '🔴 Kritisch'], ['heute', '📋 Heute fällig'], ['hinweise', '👥 Hinweise'], ['close', '✅ Close'], ['instantly', '✉️ Instantly']].map(([k, label]) => (
            <span key={k} style={{ fontSize: 12.5, background: '#fff', border: '1px solid #ececea', borderRadius: 100, padding: '5px 12px' }}>
              {label}: <strong>{data.counts[k] ?? 0}</strong>
            </span>
          ))}
        </div>
      )}

      <Section title="🔴 Kritisch" items={data?.sections?.kritisch || []} erledigt={erledigt} showHidden={showHidden} onToggleHide={toggleHide} />
      <Section title="📋 Kampagnen heute" items={data?.sections?.kampagnen || []} erledigt={erledigt} showHidden={showHidden} onToggleHide={toggleHide} />
      <Section title="👥 Bewerber-Aktionen" items={data?.sections?.bewerber || []} erledigt={erledigt} showHidden={showHidden} onToggleHide={toggleHide} />

      {/* ✅ Close-Tasks */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>✅ Close-Tasks</h2>
        {!data?.close?.configured
          ? <div style={{ fontSize: 13, color: '#9a9994' }}>Close nicht konfiguriert — API-Key unten eintragen.</div>
          : data.close.error ? <div className="alert alert-error">{data.close.error}</div>
          : data.close.hinweis ? <div style={{ fontSize: 13, color: '#9a9994' }}>{data.close.hinweis}</div>
          : (data.close.tasks || []).length === 0 ? <div style={{ fontSize: 13, color: '#9a9994', fontStyle: 'italic' }}>Keine offenen Tasks heute.</div>
          : data.close.tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: t._done ? '#f0fdf4' : (t.overdue ? '#fef3f2' : '#fff'), border: '1px solid #ececea', borderRadius: 8, marginBottom: 6, opacity: t._done ? 0.6 : 1 }}>
              <input type="checkbox" checked={!!t._done} onChange={() => completeClose(t.id, !t._done)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: t._done ? 'line-through' : 'none' }}>
                  {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.lead_name || t.text}</a> : (t.lead_name || t.text)}
                </div>
                <div style={{ fontSize: 12.5, color: '#5a5955' }}>{t.text}{t.date ? ` · fällig ${t.date}` : ''}{t.overdue ? ' · überfällig' : ''}</div>
              </div>
              {t._done && <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => completeClose(t.id, false)}>↩ Undo</button>}
            </div>
          ))}
      </section>

      {/* ✉️ Instantly */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>
          ✉️ Instantly-Kampagnen {data?.instantly?.unibox_url && <a style={{ fontSize: 12, fontWeight: 500 }} href={data.instantly.unibox_url} target="_blank" rel="noreferrer">→ Unibox</a>}
        </h2>
        {!data?.instantly?.configured
          ? <div style={{ fontSize: 13, color: '#9a9994' }}>Instantly nicht konfiguriert — API-Key unten eintragen.</div>
          : data.instantly.error ? <div className="alert alert-error">{data.instantly.error}</div>
          : (data.instantly.kampagnen || []).length === 0 ? <div style={{ fontSize: 13, color: '#9a9994', fontStyle: 'italic' }}>Keine aktiven Kampagnen.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#9a9994', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '4px 8px' }}>Kampagne</th><th style={{ padding: '4px 8px' }}>Heute gesendet</th>
                  <th style={{ padding: '4px 8px' }}>Replies</th><th style={{ padding: '4px 8px' }}>Bounce-Rate</th>
                </tr></thead>
                <tbody>
                  {data.instantly.kampagnen.map(c => (
                    <tr key={c.id} style={{ borderTop: '1px solid #ececea' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: '6px 8px' }}>{c.sent_today == null ? '—' : c.sent_today}</td>
                      <td style={{ padding: '6px 8px' }}>{c.replies_total ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: c.bounce_warn ? '#b42318' : '#0a0a0a', fontWeight: c.bounce_warn ? 700 : 400 }}>
                        {c.bounce_rate != null ? `${c.bounce_rate}%` : '—'}{c.bounce_warn ? ' ⚠️' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {/* 📝 Mini-To-dos */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>📝 Meine To-dos</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input value={neuTodo} onChange={e => setNeuTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTodo()}
            placeholder="Neue Notiz / Aufgabe…" style={{ flex: 1, minWidth: 200, padding: '8px 10px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13 }} />
          <input type="date" value={neuFaellig} onChange={e => setNeuFaellig(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13 }} />
          <button className="btn-primary" onClick={addTodo}>+ Hinzufügen</button>
        </div>
        {todos.length === 0 ? <div style={{ fontSize: 13, color: '#9a9994', fontStyle: 'italic' }}>Keine To-dos.</div>
          : todos.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#fff', border: '1px solid #ececea', borderRadius: 8, marginBottom: 5, opacity: t.erledigt ? 0.55 : 1 }}>
              <input type="checkbox" checked={t.erledigt} onChange={() => toggleTodo(t)} />
              <span style={{ flex: 1, fontSize: 13.5, textDecoration: t.erledigt ? 'line-through' : 'none' }}>{t.text}</span>
              {t.faellig && <span style={{ fontSize: 12, color: '#b54708' }}>bis {t.faellig}</span>}
              <button onClick={() => deleteTodo(t.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b42318', fontSize: 14 }}>✕</button>
            </div>
          ))}
      </section>

      {/* ⚙️ API-Keys */}
      {keys && (
        <section style={{ marginBottom: 20, borderTop: '1px solid #ececea', paddingTop: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: '#5a5955' }}>⚙️ API-Keys (Close / Instantly)</h2>
          {Object.entries(keys).map(([name, st]) => <KeyField key={name} name={name} status={st} onSave={saveKey} onRemove={removeKey} />)}
        </section>
      )}
    </PageContainer>
  );
}

function KeyField({ name, status, onSave, onRemove }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, minWidth: 160 }}>{status.label}</span>
      <span style={{ fontSize: 12, color: status.gesetzt ? '#027a48' : '#b42318', minWidth: 170 }}>
        {status.gesetzt ? `✓ gesetzt (${status.hinweis}, ${status.quelle})` : '— nicht gesetzt'}
      </span>
      <input type="password" value={val} onChange={e => setVal(e.target.value)} placeholder="Neuen Key eintragen…"
        style={{ flex: 1, minWidth: 180, padding: '7px 9px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13 }} />
      <button className="btn-primary" disabled={!val.trim()} onClick={() => { onSave(name, val.trim()); setVal(''); }}>Speichern</button>
      {status.quelle === 'settings' && <button className="btn-secondary" onClick={() => onRemove(name)}>Entfernen</button>}
    </div>
  );
}
