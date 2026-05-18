import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { normalizeBewerbung } from '../lib/perspectiveParser.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const STATUS_OPTIONS = [
  { value: 'neu', label: 'Neu' },
  { value: 'interessant', label: 'Interessant' },
  { value: 'vorstellungsgespraech', label: 'Vorstellungsgespräch' },
  { value: 'eingestellt', label: 'Eingestellt' },
  { value: 'abgesagt', label: 'Abgesagt' },
];

const BRAND = {
  talentone: {
    name: 'TalentOne', primary: '#0a0a0a', accent: '#d4ff00',
    website: 'https://talent-one.de', footer: 'Made with ♥ by TalentOne',
  },
  nowagwirth: {
    name: 'Nowag & Wirth', primary: '#1a3a6c', accent: '#ffd966',
    website: 'https://nowagwirth.de', footer: 'Made with ♥ by Nowag & Wirth',
  },
};

function DebouncedInput({ value, onSave, type = 'text', rows, placeholder }) {
  const [local, setLocal] = useState(value ?? '');
  const timerRef = useRef(null);
  const lastRef = useRef(value ?? '');
  useEffect(() => { setLocal(value ?? ''); lastRef.current = value ?? ''; }, [value]);
  function onChange(e) {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (v === lastRef.current) return;
      lastRef.current = v; onSave(v);
    }, 600);
  }
  function flushOnBlur() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (local !== lastRef.current) { lastRef.current = local; onSave(local); }
  }
  if (rows) return <textarea rows={rows} value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
  return <input type={type} value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
}

function AddSpalteForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  function submit() {
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
    setOpen(false);
  }
  if (!open) {
    return (
      <button type="button" className="pub-add-col-btn" onClick={() => setOpen(true)}>
        + Eigene Spalte
      </button>
    );
  }
  return (
    <div className="pub-add-col-form">
      <input
        autoFocus
        type="text"
        placeholder="z.B. Gehaltswunsch, Wechselmotivation"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setName(''); setOpen(false); } }}
      />
      <button type="button" onClick={submit}>Hinzufügen</button>
      <button type="button" className="pub-cancel" onClick={() => { setName(''); setOpen(false); }}>×</button>
    </div>
  );
}

function EditableFeedbackBlock({ fb, onPatch }) {
  return (
    <div className="pub-feedback-grid">
      <label>
        <span>Status</span>
        <select value={fb.status || 'neu'} onChange={e => onPatch({ status: e.target.value })}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label>
        <span>Vorstellungsgespräch am</span>
        <input
          type="datetime-local"
          value={fb.vorstellungsgespraech_am ? new Date(fb.vorstellungsgespraech_am).toISOString().slice(0,16) : ''}
          onChange={e => onPatch({ vorstellungsgespraech_am: e.target.value ? new Date(e.target.value).toISOString() : null })}
        />
      </label>
      <label className="pub-full">
        <span>Notizen</span>
        <DebouncedInput
          rows={3}
          value={fb.notizen || ''}
          placeholder="Eigene Anmerkungen…"
          onSave={v => onPatch({ notizen: v })}
        />
      </label>
    </div>
  );
}

export default function PublicBewerbungen() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('alle');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`${API_BASE}/public/bewerbungen/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error || 'Fehler'); }))
      .then(d => { if (!cancel) setData(d); })
      .catch(err => { if (!cancel) setError(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [token]);

  const brand = BRAND[data?.kunde?.agentur] || BRAND.talentone;

  function updateFeedback(bewId, fb) {
    setData(prev => ({ ...prev, feedback: { ...prev.feedback, [bewId]: fb } }));
  }

  async function patchFeedback(bewId, body) {
    const current = data.feedback[bewId] || {};
    updateFeedback(bewId, { ...current, ...body });
    try {
      const res = await fetch(`${API_BASE}/public/bewerbungen/${token}/${bewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const j = await res.json();
        updateFeedback(bewId, j.feedback);
      }
    } catch (err) { console.error(err); }
  }

  /* ─── Custom Spalten (vom Kunden verwaltet) ─── */
  async function addSpalte(name) {
    if (!name?.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/public/bewerbungen/${token}/spalten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Spalte konnte nicht angelegt werden.');
      const j = await res.json();
      setData(prev => ({ ...prev, spalten: [...(prev.spalten || []), j.spalte] }));
    } catch (err) { alert(err.message); }
  }
  async function removeSpalte(spalteId) {
    if (!confirm('Spalte wirklich entfernen? Alle Werte gehen verloren.')) return;
    try {
      await fetch(`${API_BASE}/public/bewerbungen/${token}/spalten/${spalteId}`, { method: 'DELETE' });
      setData(prev => ({
        ...prev,
        spalten: (prev.spalten || []).filter(s => s.id !== spalteId),
      }));
    } catch (err) { console.error(err); }
  }
  async function setSpalteWert(bewId, spalteId, wert) {
    setData(prev => {
      const next = { ...(prev.werte || {}) };
      next[bewId] = { ...(next[bewId] || {}), [spalteId]: wert };
      return { ...prev, werte: next };
    });
    try {
      await fetch(`${API_BASE}/public/bewerbungen/${token}/${bewId}/spalten/${spalteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wert }),
      });
    } catch (err) { console.error(err); }
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Normalisierte Bewerbungen
  const normalized = useMemo(() => {
    if (!data) return new Map();
    const m = new Map();
    for (const b of data.bewerbungen) m.set(b.id, normalizeBewerbung(b));
    return m;
  }, [data]);

  // Dynamische Frage-Spalten
  const frageSpalten = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    for (const b of data.bewerbungen) {
      const norm = normalized.get(b.id);
      for (const a of norm?.antworten || []) {
        const key = (a.frage_text || '').trim();
        if (key) seen.add(key);
      }
    }
    return Array.from(seen);
  }, [data, normalized]);

  function antwortFor(bewId, frage) {
    const norm = normalized.get(bewId);
    return norm?.antworten.find(a => (a.frage_text || '').trim() === frage)?.antwort || '';
  }

  const bewerbungen = useMemo(() => {
    if (!data) return [];
    let list = data.bewerbungen.slice();
    if (filter === 'qualifiziert') list = list.filter(b => !b.ko_kriterium);
    list.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortAsc ? da - db : db - da;
    });
    return list;
  }, [data, filter, sortAsc]);

  if (loading) return <div className="pub-shell"><div className="pub-loading">Lade…</div></div>;
  if (error) return <div className="pub-shell"><div className="pub-error">{error}</div></div>;
  if (!data) return null;

  return (
    <div className="pub-shell" style={{ '--pub-primary': brand.primary, '--pub-accent': brand.accent }}>
      <header className="pub-header" style={{ background: brand.primary }}>
        <div className="pub-header-inner">
          <div>
            <div className="pub-brand">{brand.name}</div>
            <h1 className="pub-h1">{data.kunde?.firmenname || 'Bewerbungen'}</h1>
            <p className="pub-sub">{data.job?.stelle}{data.job?.region ? ` · ${data.job.region}` : ''}</p>
          </div>
          <div className="pub-count">
            <strong>{bewerbungen.length}</strong>
            <span>Bewerbungen</span>
          </div>
        </div>
      </header>

      <main className="pub-main">
        <div className="pub-toolbar">
          <div className="pub-filter-group">
            <button className={`pub-filter ${filter === 'alle' ? 'is-active' : ''}`} onClick={() => setFilter('alle')}>Alle</button>
            <button className={`pub-filter ${filter === 'qualifiziert' ? 'is-active' : ''}`} onClick={() => setFilter('qualifiziert')}>Nur qualifizierte</button>
          </div>
          <div className="pub-toolbar-right">
            <AddSpalteForm onAdd={addSpalte} />
            <button className="pub-sort" onClick={() => setSortAsc(v => !v)}>Datum {sortAsc ? '↑' : '↓'}</button>
          </div>
        </div>
        {(data.spalten || []).length > 0 && (
          <div className="pub-spalten-bar">
            <span className="pub-spalten-label">Ihre eigenen Spalten:</span>
            {(data.spalten || []).map(s => (
              <span key={s.id} className="pub-spalten-chip">
                {s.name}
                <button type="button" onClick={() => removeSpalte(s.id)} title="Entfernen">×</button>
              </span>
            ))}
          </div>
        )}

        {bewerbungen.length === 0 ? (
          <div className="pub-empty">Noch keine Bewerbungen.</div>
        ) : (
          <>
            {/* Desktop: Tabelle */}
            <div className="pub-table-scroll">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Datum</th>
                    <th>Name</th>
                    <th>E-Mail</th>
                    <th>Telefon</th>
                    <th>KO</th>
                    {frageSpalten.map(f => <th key={f}>{f}</th>)}
                    {(data.spalten || []).map(s => (
                      <th key={s.id} className="pub-th-custom">{s.name}</th>
                    ))}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bewerbungen.map(b => {
                    const norm = normalized.get(b.id) || {};
                    const fb = data.feedback[b.id] || {};
                    const expanded = expandedIds.has(b.id);
                    return (
                      <Fragment key={b.id}>
                        <tr className={`pub-tr ${b.ko_kriterium ? 'is-ko' : ''} ${expanded ? 'is-expanded' : ''}`} onClick={() => toggleExpand(b.id)}>
                          <td className="pub-td-toggle">{expanded ? '▾' : '▸'}</td>
                          <td className="pub-td-date">{new Date(b.created_at).toLocaleDateString('de-DE')}</td>
                          <td><strong>{norm.name || '—'}</strong></td>
                          <td>{norm.email ? <a href={`mailto:${norm.email}`} onClick={e => e.stopPropagation()}>{norm.email}</a> : '—'}</td>
                          <td>{norm.telefon ? <a href={`tel:${norm.telefon}`} onClick={e => e.stopPropagation()}>{norm.telefon}</a> : '—'}</td>
                          <td>{b.ko_kriterium ? <span className="pub-ko-badge">KO</span> : ''}</td>
                          {frageSpalten.map(f => <td key={f} className="pub-td-antwort">{antwortFor(b.id, f) || <span className="pub-muted">—</span>}</td>)}
                          {(data.spalten || []).map(s => (
                            <td key={s.id} className="pub-td-custom" onClick={e => e.stopPropagation()}>
                              <DebouncedInput
                                value={data.werte?.[b.id]?.[s.id] || ''}
                                onSave={v => setSpalteWert(b.id, s.id, v)}
                              />
                            </td>
                          ))}
                          <td>
                            {fb.status && fb.status !== 'neu' && (
                              <span className={`pub-status-badge pub-status-${fb.status}`}>{STATUS_OPTIONS.find(o => o.value === fb.status)?.label}</span>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="pub-tr-expand">
                            <td colSpan={7 + frageSpalten.length + (data.spalten?.length || 0)} onClick={e => e.stopPropagation()}>
                              <div className="pub-expand-inner">
                                <h4>Ihre Einschätzung</h4>
                                <EditableFeedbackBlock fb={fb} onPatch={body => patchFeedback(b.id, body)} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: Karten mit allen Infos */}
            <div className="pub-cards">
              {bewerbungen.map(b => {
                const norm = normalized.get(b.id) || {};
                const fb = data.feedback[b.id] || {};
                const expanded = expandedIds.has(b.id);
                return (
                  <div key={b.id} className={`pub-mcard ${b.ko_kriterium ? 'is-ko' : ''}`}>
                    <div className="pub-mcard-head">
                      <div>
                        <div className="pub-mcard-date">{new Date(b.created_at).toLocaleDateString('de-DE')}</div>
                        <strong className="pub-mcard-name">{norm.name || '—'}</strong>
                      </div>
                      <div className="pub-mcard-badges">
                        {b.ko_kriterium && <span className="pub-ko-badge">KO</span>}
                        {fb.status && fb.status !== 'neu' && (
                          <span className={`pub-status-badge pub-status-${fb.status}`}>{STATUS_OPTIONS.find(o => o.value === fb.status)?.label}</span>
                        )}
                      </div>
                    </div>
                    <dl className="pub-mcard-contact">
                      {norm.email && <><dt>E-Mail</dt><dd><a href={`mailto:${norm.email}`}>{norm.email}</a></dd></>}
                      {norm.telefon && <><dt>Telefon</dt><dd><a href={`tel:${norm.telefon}`}>{norm.telefon}</a></dd></>}
                    </dl>
                    {norm.antworten?.length > 0 && (
                      <ul className="pub-mcard-antworten">
                        {norm.antworten.map((a, i) => (
                          <li key={i}>
                            <div className="pub-frage">{a.frage_text}</div>
                            <div className="pub-antwort">→ {a.antwort}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(data.spalten || []).length > 0 && (
                      <div className="pub-mcard-customs">
                        {(data.spalten || []).map(s => (
                          <label key={s.id} className="pub-mcard-custom">
                            <span>{s.name}</span>
                            <DebouncedInput
                              value={data.werte?.[b.id]?.[s.id] || ''}
                              onSave={v => setSpalteWert(b.id, s.id, v)}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <button className="pub-mcard-toggle" onClick={() => toggleExpand(b.id)}>
                      {expanded ? '✕ Schließen' : 'Status & Notizen bearbeiten ▸'}
                    </button>
                    {expanded && (
                      <div className="pub-mcard-feedback">
                        <EditableFeedbackBlock fb={fb} onPatch={body => patchFeedback(b.id, body)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <footer className="pub-footer">
        <span>{brand.footer}</span>
        <span> · </span>
        <a href={brand.website} target="_blank" rel="noreferrer">{brand.website.replace(/^https?:\/\//, '')}</a>
      </footer>
    </div>
  );
}
