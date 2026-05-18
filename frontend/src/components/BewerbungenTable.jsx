import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { normalizeBewerbung } from '../lib/perspectiveParser.js';

/* Vordefinierte interne Spalten */
const INTERNE_SPALTEN_DEFS = {
  status:        { label: 'Status', width: 130 },
  bewertung:     { label: 'Bewertung', width: 110 },
  gehaltswunsch: { label: 'Gehaltswunsch', width: 130 },
  verfuegbarkeit:{ label: 'Verfügbarkeit', width: 130 },
  anrufversuche: { label: 'Anrufversuche', width: 420 },
  naechste_aktion: { label: 'Nächste Aktion', width: 180 },
  notizen:       { label: 'Notizen', width: 240 },
};

const STATUS_OPTIONS = [
  { value: 'neu', label: 'Neu' },
  { value: 'kontaktiert', label: 'Kontaktiert' },
  { value: 'interessiert', label: 'Interessiert' },
  { value: 'abgesagt', label: 'Abgesagt' },
  { value: 'weitergeleitet', label: 'Weitergeleitet' },
];

const ANRUF_ERGEBNIS_OPTIONS = [
  { value: '', label: '—' },
  { value: 'erreicht', label: '✓ Erreicht' },
  { value: 'nicht_erreicht', label: '✗ Nicht erreicht' },
  { value: 'mailbox', label: '📞 Mailbox' },
];

const FEEDBACK_LABELS = {
  neu: 'Neu',
  interessant: 'Interessant',
  vorstellungsgespraech: 'Vorstellungsgespräch',
  eingestellt: 'Eingestellt',
  abgesagt: 'Abgesagt',
};

/* ─── Debounced field — saves wert nach 600ms Idle ─── */
function DebouncedInput({ value, onSave, type = 'text', placeholder, rows }) {
  const [local, setLocal] = useState(value ?? '');
  const timerRef = useRef(null);
  const lastSavedRef = useRef(value ?? '');

  useEffect(() => {
    setLocal(value ?? '');
    lastSavedRef.current = value ?? '';
  }, [value]);

  function onChange(e) {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (v === lastSavedRef.current) return;
      lastSavedRef.current = v;
      onSave(v);
    }, 600);
  }

  function flushOnBlur() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (local !== lastSavedRef.current) {
      lastSavedRef.current = local;
      onSave(local);
    }
  }

  if (rows) {
    return (
      <textarea
        className="cell-input"
        rows={rows}
        value={local}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={flushOnBlur}
      />
    );
  }
  return (
    <input
      className="cell-input"
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={onChange}
      onBlur={flushOnBlur}
    />
  );
}

/* Sterne 1-5 */
function StarRating({ value, onChange }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`star ${n <= (value || 0) ? 'is-on' : ''}`}
          onClick={() => onChange(value === n ? null : n)}
          title={`${n} Stern${n === 1 ? '' : 'e'}`}
        >★</button>
      ))}
    </div>
  );
}

/* Anrufversuche-Zelle (3 Slots) */
function AnrufversucheCell({ value, onChange }) {
  const arr = Array.isArray(value) ? value : [];
  function patch(i, patchObj) {
    const next = [...arr];
    next[i] = { ...(next[i] || {}), ...patchObj };
    onChange(next);
  }
  return (
    <div className="anruf-cell">
      {[0, 1, 2].map(i => {
        const a = arr[i] || {};
        return (
          <div key={i} className="anruf-row">
            <span className="anruf-num">#{i + 1}</span>
            <input
              type="date"
              className="cell-input cell-date"
              value={a.datum ? String(a.datum).slice(0, 10) : ''}
              onChange={e => patch(i, { datum: e.target.value || null })}
            />
            <select
              className="cell-input"
              value={a.ergebnis || ''}
              onChange={e => patch(i, { ergebnis: e.target.value || null })}
            >
              {ANRUF_ERGEBNIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <DebouncedInput
              value={a.notiz || ''}
              placeholder="Notiz"
              onSave={v => patch(i, { notiz: v })}
            />
          </div>
        );
      })}
    </div>
  );
}

/* CSV-Export */
function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function BewerbungenTable({ job, internalSpalten: internalSpaltenProp, onChangeInternalSpalten }) {
  // Anruf-Spalte nur sichtbar wenn telefonische Vorqualifizierung aktiv
  const internalSpalten = useMemo(() => {
    if (job?.vorqualifizierung) return internalSpaltenProp;
    return internalSpaltenProp.filter(k => k !== 'anrufversuche');
  }, [internalSpaltenProp, job?.vorqualifizierung]);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ bewerbungen: [], notizen: {}, feedback: {}, werte: {} });
  const [spalten, setSpalten] = useState([]);
  const [showConfig, setShowConfig] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        api(`/bewerbungen/job/${job.id}`),
        api(`/bewerbungen/job/${job.id}/spalten`),
      ]);
      setData(d);
      setSpalten(s.spalten || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [job.id]);

  /* Normalisierte Bewerbungen (Perspective-roh wird sauber gerendert) */
  const normalized = useMemo(() => {
    const map = new Map();
    for (const b of data.bewerbungen) map.set(b.id, normalizeBewerbung(b));
    return map;
  }, [data.bewerbungen]);

  /* Dynamische Funnel-Fragen-Spalten — alle unique frage_text aus normalisierten Antworten */
  const frageSpalten = useMemo(() => {
    const seen = new Map();
    for (const b of data.bewerbungen) {
      const norm = normalized.get(b.id);
      for (const a of norm?.antworten || []) {
        const key = (a?.frage_text || '').trim();
        if (key && !seen.has(key)) seen.set(key, key);
      }
    }
    return Array.from(seen.keys());
  }, [data.bewerbungen, normalized]);

  function antwortFor(bewerbung, frage) {
    const norm = normalized.get(bewerbung.id);
    return norm?.antworten.find(a => (a?.frage_text || '').trim() === frage)?.antwort ?? '';
  }

  /* Inline-Update der Notizen */
  async function updateNotiz(bewId, patch) {
    setData(prev => ({
      ...prev,
      notizen: { ...prev.notizen, [bewId]: { ...(prev.notizen[bewId] || {}), ...patch } },
    }));
    try {
      const res = await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: patch });
      setData(prev => ({ ...prev, notizen: { ...prev.notizen, [bewId]: res.notiz } }));
    } catch (err) {
      console.error('[notiz-save]', err.message);
    }
  }

  async function updateCustomCol(bewId, spalteId, wert) {
    setData(prev => ({
      ...prev,
      werte: { ...prev.werte, [bewId]: { ...(prev.werte[bewId] || {}), [spalteId]: wert } },
    }));
    try {
      await api(`/bewerbungen/${bewId}/spalten/${spalteId}`, { method: 'PUT', body: { wert } });
    } catch (err) {
      console.error('[wert-save]', err.message);
    }
  }

  /* Eigene Spalten verwalten */
  const [neueSpalteName, setNeueSpalteName] = useState('');
  const [neueSpalteTyp, setNeueSpalteTyp] = useState('text');
  async function addSpalte() {
    if (!neueSpalteName.trim()) return;
    try {
      const res = await api(`/bewerbungen/job/${job.id}/spalten`, {
        method: 'POST',
        body: { name: neueSpalteName, typ: neueSpalteTyp },
      });
      setSpalten(prev => [...prev, res.spalte]);
      setNeueSpalteName('');
    } catch (err) { alert(err.message); }
  }
  async function removeSpalte(spalteId) {
    if (!confirm('Eigene Spalte wirklich löschen?')) return;
    try {
      await api(`/bewerbungen/spalten/${spalteId}`, { method: 'DELETE' });
      setSpalten(prev => prev.filter(s => s.id !== spalteId));
    } catch (err) { alert(err.message); }
  }

  function toggleInternal(key) {
    const active = internalSpalten.includes(key);
    const next = active ? internalSpalten.filter(s => s !== key) : [...internalSpalten, key];
    onChangeInternalSpalten(next);
  }

  function exportCsv() {
    const rows = data.bewerbungen.map(b => {
      const n = data.notizen[b.id] || {};
      const fb = data.feedback[b.id] || {};
      const row = {
        Datum: new Date(b.created_at).toLocaleString('de-DE'),
        Name: b.name || '',
        EMail: b.email || '',
        Telefon: b.telefon || '',
        Quelle: b.quelle === 'perspective' ? 'Perspective' : 'TalentOne',
        KO: b.ko_kriterium ? 'Ja' : '',
      };
      for (const f of frageSpalten) row[f] = antwortFor(b, f);
      if (internalSpalten.includes('status')) row['Status'] = n.status || 'neu';
      if (internalSpalten.includes('bewertung')) row['Bewertung'] = n.bewertung || '';
      if (internalSpalten.includes('gehaltswunsch')) row['Gehaltswunsch'] = n.gehaltswunsch || '';
      if (internalSpalten.includes('verfuegbarkeit')) row['Verfügbarkeit'] = n.verfuegbarkeit || '';
      if (internalSpalten.includes('naechste_aktion')) row['Nächste Aktion'] = n.naechste_aktion || '';
      if (internalSpalten.includes('notizen')) row['Notizen'] = n.notizen || '';
      if (internalSpalten.includes('anrufversuche')) {
        const arr = Array.isArray(n.anrufversuche) ? n.anrufversuche : [];
        row['Anrufversuche'] = arr.map((a, i) => `#${i+1} ${a.datum || ''} ${a.ergebnis || ''} ${a.notiz || ''}`).join(' | ');
      }
      for (const s of spalten) row[s.name] = (data.werte[b.id]?.[s.id]) ?? '';
      if (fb.status) row['Kundenfeedback'] = FEEDBACK_LABELS[fb.status] || fb.status;
      return row;
    });
    downloadCsv(`bewerbungen-${(job.stelle || 'job').replace(/\s+/g, '_')}.csv`, rows);
  }

  if (loading) return <div className="motiv-sub">Lade Bewerbungen…</div>;

  const bewerbungen = data.bewerbungen;

  return (
    <div className="bewerbungen-wrap">
      <div className="bewerbungen-toolbar">
        <strong>{bewerbungen.length} Bewerbungen</strong>
        <button className="btn-ghost btn-sm" onClick={() => setShowConfig(v => !v)}>
          {showConfig ? '✕ Konfiguration schließen' : '⚙ Interne Spalten konfigurieren'}
        </button>
        <button className="btn-ghost btn-sm" onClick={exportCsv} disabled={bewerbungen.length === 0}>
          ⬇ CSV-Export
        </button>
      </div>

      {showConfig && (
        <div className="bewerbungen-config">
          <div className="config-section">
            <strong>Vordefinierte Spalten</strong>
            <div className="checkbox-grid">
              {Object.entries(INTERNE_SPALTEN_DEFS).map(([key, def]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={internalSpalten.includes(key)}
                    onChange={() => toggleInternal(key)}
                  />
                  <span>{def.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="config-section">
            <strong>Eigene Spalten</strong>
            {spalten.length === 0 && <p className="pane-hint">Noch keine eigenen Spalten.</p>}
            {spalten.map(s => (
              <div key={s.id} className="custom-col-row">
                <span>{s.name} <em className="muted">({s.typ})</em></span>
                <button className="btn-ghost btn-sm btn-danger" onClick={() => removeSpalte(s.id)}>×</button>
              </div>
            ))}
            <div className="custom-col-add">
              <input
                type="text"
                placeholder="Neuer Spaltenname"
                value={neueSpalteName}
                onChange={e => setNeueSpalteName(e.target.value)}
              />
              <select value={neueSpalteTyp} onChange={e => setNeueSpalteTyp(e.target.value)}>
                <option value="text">Text</option>
                <option value="datum">Datum</option>
              </select>
              <button className="btn-ghost btn-sm" onClick={addSpalte}>+ Hinzufügen</button>
            </div>
          </div>
        </div>
      )}

      {bewerbungen.length === 0
        ? <div className="motiv-sub" style={{ marginTop: 16 }}>Noch keine Bewerbungen.</div>
        : (
          <div className="bewerbungen-table-scroll">
            <table className="bewerbungen-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Name</th>
                  <th>E-Mail</th>
                  <th>Telefon</th>
                  <th>Quelle</th>
                  <th>KO</th>
                  {frageSpalten.map(f => <th key={`q-${f}`} className="th-frage">{f}</th>)}
                  {internalSpalten.map(key => INTERNE_SPALTEN_DEFS[key] && (
                    <th key={`i-${key}`} style={{ minWidth: INTERNE_SPALTEN_DEFS[key].width }}>
                      {INTERNE_SPALTEN_DEFS[key].label}
                    </th>
                  ))}
                  {spalten.map(s => <th key={`c-${s.id}`}>{s.name}</th>)}
                  <th>Kundenfeedback</th>
                </tr>
              </thead>
              <tbody>
                {bewerbungen.map(b => {
                  const n = data.notizen[b.id] || {};
                  const fb = data.feedback[b.id] || {};
                  const norm = normalized.get(b.id) || { name: b.name, email: b.email, telefon: b.telefon };
                  return (
                    <tr key={b.id} className={b.ko_kriterium ? 'is-ko' : ''}>
                      <td className="td-date">{new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="td-name"><strong>{norm.name || '—'}</strong></td>
                      <td>{norm.email ? <a href={`mailto:${norm.email}`}>{norm.email}</a> : '—'}</td>
                      <td>{norm.telefon ? <a href={`tel:${norm.telefon}`}>{norm.telefon}</a> : '—'}</td>
                      <td><span className={`quelle-badge quelle-${b.quelle || 'funnel'}`}>{b.quelle === 'perspective' ? 'Perspective' : 'TalentOne'}</span></td>
                      <td>{b.ko_kriterium ? <span className="ko-badge">KO</span> : ''}</td>

                      {frageSpalten.map(f => (
                        <td key={`q-${b.id}-${f}`} className="td-antwort">{antwortFor(b, f) || <span className="muted">—</span>}</td>
                      ))}

                      {internalSpalten.map(key => {
                        if (!INTERNE_SPALTEN_DEFS[key]) return null;
                        if (key === 'status') return (
                          <td key={`i-${b.id}-${key}`}>
                            <select className="cell-input" value={n.status || 'neu'} onChange={e => updateNotiz(b.id, { status: e.target.value })}>
                              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                        );
                        if (key === 'bewertung') return (
                          <td key={`i-${b.id}-${key}`}>
                            <StarRating value={n.bewertung || 0} onChange={v => updateNotiz(b.id, { bewertung: v })} />
                          </td>
                        );
                        if (key === 'anrufversuche') return (
                          <td key={`i-${b.id}-${key}`} className="td-anrufe">
                            <AnrufversucheCell value={n.anrufversuche} onChange={arr => updateNotiz(b.id, { anrufversuche: arr })} />
                          </td>
                        );
                        const isLong = key === 'notizen';
                        return (
                          <td key={`i-${b.id}-${key}`}>
                            <DebouncedInput
                              value={n[key] || ''}
                              onSave={v => updateNotiz(b.id, { [key]: v })}
                              rows={isLong ? 2 : undefined}
                            />
                          </td>
                        );
                      })}

                      {spalten.map(s => (
                        <td key={`c-${b.id}-${s.id}`}>
                          {s.typ === 'dropdown' && Array.isArray(s.optionen) ? (
                            <select className="cell-input" value={data.werte[b.id]?.[s.id] || ''} onChange={e => updateCustomCol(b.id, s.id, e.target.value)}>
                              <option value="">—</option>
                              {s.optionen.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : s.typ === 'datum' ? (
                            <input type="date" className="cell-input cell-date" value={(data.werte[b.id]?.[s.id] || '').slice(0,10)} onChange={e => updateCustomCol(b.id, s.id, e.target.value)} />
                          ) : (
                            <DebouncedInput value={data.werte[b.id]?.[s.id] || ''} onSave={v => updateCustomCol(b.id, s.id, v)} />
                          )}
                        </td>
                      ))}

                      <td>
                        {fb.status ? (
                          <div className="kundenfeedback-cell">
                            <span className="kundenfeedback-badge">{FEEDBACK_LABELS[fb.status] || fb.status}</span>
                            {fb.vorstellungsgespraech_am && (
                              <span className="kundenfeedback-meta">VG: {new Date(fb.vorstellungsgespraech_am).toLocaleString('de-DE')}</span>
                            )}
                            {fb.notizen && <span className="kundenfeedback-meta" title={fb.notizen}>📝 {fb.notizen.slice(0, 30)}{fb.notizen.length > 30 ? '…' : ''}</span>}
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}
