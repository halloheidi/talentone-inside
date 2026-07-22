import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import WoraufAchtenBox from './WoraufAchtenBox.jsx';
import { normalizeBewerbung } from '../lib/perspectiveParser.js';
import { effektiveVorqualFelder } from '../lib/vorqual.js';

/* Vordefinierte interne Spalten (schlanke Ansicht — wenn vorqualifizierung aus) */
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

const EINGESTELLT_OPTIONS = [
  { value: 'offen', label: 'Offen' },
  { value: 'ja',    label: 'Ja' },
  { value: 'nein',  label: 'Nein' },
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

/* ─── Debounced Input ─── */
function DebouncedInput({ value, onSave, type = 'text', placeholder, rows }) {
  const [local, setLocal] = useState(value ?? '');
  const timerRef = useRef(null);
  const lastSavedRef = useRef(value ?? '');
  useEffect(() => { setLocal(value ?? ''); lastSavedRef.current = value ?? ''; }, [value]);
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
    return <textarea className="cell-input" rows={rows} value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
  }
  return <input className="cell-input" type={type} value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
}

function AmpelSelector({ value, onChange }) {
  const opts = [
    { v: 'gruen', emoji: '🟢', title: 'Grün: passt — Kontakt aufnehmen' },
    { v: 'gelb',  emoji: '🟡', title: 'Gelb: Kleinigkeit — anrufen' },
    { v: 'rot',   emoji: '🔴', title: 'Rot: passt nicht' },
  ];
  return (
    <div className="ampel-selector">
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          className={`ampel-dot ${value === o.v ? 'is-on' : ''}`}
          title={o.title}
          onClick={(e) => { e.stopPropagation(); onChange(value === o.v ? null : o.v); }}
        >{o.emoji}</button>
      ))}
    </div>
  );
}

function StarRating({ value, onChange }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={`star ${n <= (value || 0) ? 'is-on' : ''}`} onClick={() => onChange(value === n ? null : n)}>★</button>
      ))}
    </div>
  );
}

/* ─── Anrufversuche-Block (3 Zeilen, für Slide-Over) ─── */
function AnrufversucheBlock({ value, onChange }) {
  const arr = Array.isArray(value) ? value : [];
  function patch(i, p) {
    const next = [...arr];
    next[i] = { ...(next[i] || {}), ...p };
    onChange(next);
  }
  return (
    <div className="anrufversuche-block">
      {[0, 1, 2].map(i => {
        const a = arr[i] || {};
        return (
          <div key={i} className="anrufversuch-row">
            <span className="anruf-num">#{i + 1}</span>
            <input type="date" className="cell-input cell-date" value={a.datum ? String(a.datum).slice(0, 10) : ''} onChange={e => patch(i, { datum: e.target.value || null })} />
            <select className="cell-input" value={a.ergebnis || ''} onChange={e => patch(i, { ergebnis: e.target.value || null })}>
              {ANRUF_ERGEBNIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <DebouncedInput value={a.notiz || ''} placeholder="Notiz" onSave={v => patch(i, { notiz: v })} />
          </div>
        );
      })}
    </div>
  );
}

/* ─── Vorqualifizierungs-Feld (typabhängig) ─── */
function VorqualField({ feld, value, onChange }) {
  if (feld.typ === 'dropdown' && Array.isArray(feld.optionen)) {
    return (
      <select className="cell-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {feld.optionen.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (feld.typ === 'datum') {
    return (
      <input type="date" className="cell-input cell-date" value={(value || '').slice(0, 10)} onChange={e => onChange(e.target.value)} />
    );
  }
  return <DebouncedInput value={value || ''} onSave={onChange} />;
}

/* ─── CSV Export ─── */
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

/* ═════════════════════ Slide-Over für Telefonisten ═════════════════════ */
function TelefonistenSlideOver({ bewerbung, norm, notiz, feedback, vorqualFelder, wichtigeKriterien = [], kundenname, kundeJobs = [], currentJobId, onReassign, onPatch, onPatchAnrufversuche, onClose }) {
  if (!bewerbung) return null;
  const n = notiz || {};
  const fb = feedback || {};
  const antworten = norm?.antworten || [];

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <aside className="slideover slideover-telefonist" onClick={e => e.stopPropagation()}>
        <header className="slideover-head">
          <div>
            <h2>{norm?.name || '(ohne Namen)'}</h2>
            {bewerbung.stelle_gewaehlt && (
              <p className="slideover-stelle" style={{
                display: 'inline-block', margin: '4px 0 2px', padding: '2px 10px',
                borderRadius: 100, background: 'rgba(0,0,0,0.06)', fontSize: 13,
                fontWeight: 600, color: '#1a1a1a',
              }}>
                💼 {bewerbung.stelle_gewaehlt}
              </p>
            )}
            <p className="muted">
              {new Date(bewerbung.created_at).toLocaleString('de-DE')} · {bewerbung.quelle === 'perspective' ? 'Perspective' : 'TalentOne'}
              {bewerbung.ko_kriterium && <> · <span className="ko-badge">KO</span></>}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </header>

        <div className="slideover-body">
          {/* Worauf achten — direkt sichtbar, damit der Caller es im Gespräch hat */}
          <WoraufAchtenBox kriterien={wichtigeKriterien} />

          {/* Kontakt + Tel-Button */}
          <section>
            <h3>Kontakt</h3>
            <dl className="slideover-dl">
              <dt>Name</dt><dd>{norm?.name || <span className="muted">—</span>}</dd>
              <dt>E-Mail</dt><dd>{norm?.email ? <a href={`mailto:${norm.email}`}>{norm.email}</a> : <span className="muted">—</span>}</dd>
              <dt>Telefon</dt>
              <dd>
                {norm?.telefon ? (
                  <a className="tel-button" href={`tel:${norm.telefon}`}>📞 {norm.telefon}</a>
                ) : <span className="muted">—</span>}
              </dd>
            </dl>
          </section>

          {/* Stelle zuordnen (bei Multi-Stellen-Funnel) */}
          {kundeJobs.length > 1 && (
            <section>
              <h3>Stelle{bewerbung?.zuordnung_unklar && <span className="avv-warn" style={{ marginLeft: 8 }}>⚠️ unklar</span>}</h3>
              <select className="cell-input" defaultValue=""
                onChange={e => { if (e.target.value) onReassign?.(e.target.value); }}>
                <option value="">→ anderer Stelle zuordnen…</option>
                {kundeJobs.filter(j => j.id !== currentJobId).map(j => (
                  <option key={j.id} value={j.id}>{j.stelle || '(ohne Titel)'}</option>
                ))}
              </select>
            </section>
          )}

          {/* Anrufversuche */}
          <section className="slideover-anrufversuche">
            <h3>Anrufversuche</h3>
            <AnrufversucheBlock value={n.anrufversuche} onChange={onPatchAnrufversuche} />
          </section>

          {/* Vorqualifizierungs-Felder */}
          {vorqualFelder.length > 0 && (
            <section>
              <h3>Vorqualifizierung</h3>
              <div className="slideover-form">
                {vorqualFelder.map((feld, idx) => (
                  <label key={`${feld.name}-${idx}`} className={feld.typ === 'dropdown' ? 'slideover-half' : 'slideover-full'}>
                    <span>{feld.name}</span>
                    <VorqualField
                      feld={feld}
                      value={(n.vorqualifizierung_werte || {})[feld.name] || ''}
                      onChange={v => {
                        const next = { ...(n.vorqualifizierung_werte || {}), [feld.name]: v };
                        onPatch({ vorqualifizierung_werte: next });
                      }}
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Notiz + Bewertung */}
          <section>
            <h3>Notiz &amp; Bewertung</h3>
            <div className="slideover-form">
              <label className="slideover-half">
                <span>Bewertung</span>
                <StarRating value={n.bewertung || 0} onChange={v => onPatch({ bewertung: v })} />
              </label>
              <label className="slideover-full">
                <span>Notiz</span>
                <DebouncedInput rows={4} value={n.notizen || ''} onSave={v => onPatch({ notizen: v })} />
              </label>
            </div>
          </section>

          {/* Status + VG + Eingestellt + Kontaktiert */}
          <section>
            <h3>Status &amp; Termin</h3>
            <div className="slideover-form">
              <label className="slideover-full">
                <span>Ampel (für den Kunden sichtbar)</span>
                <AmpelSelector value={n.ampel} onChange={v => onPatch({ ampel: v })} />
              </label>
              <label className="slideover-half">
                <span>Status</span>
                <select className="cell-input" value={n.status || 'neu'} onChange={e => onPatch({ status: e.target.value })}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="slideover-half">
                <span>Eingestellt</span>
                <select className="cell-input" value={n.eingestellt || 'offen'} onChange={e => onPatch({ eingestellt: e.target.value })}>
                  {EINGESTELLT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="slideover-half">
                <span>N&amp;W kontaktiert am</span>
                <input type="date" className="cell-input cell-date" value={(n.nw_kontaktiert || '').slice(0,10)} onChange={e => onPatch({ nw_kontaktiert: e.target.value || null })} />
              </label>
              <label className="slideover-half">
                <span>{kundenname || 'Kunde'} kontaktiert am</span>
                <input type="date" className="cell-input cell-date" value={(n.kunde_kontaktiert || '').slice(0,10)} onChange={e => onPatch({ kunde_kontaktiert: e.target.value || null })} />
              </label>
              <label className="slideover-half">
                <span>Vorstellungsgespräch vereinbart</span>
                <input type="datetime-local" className="cell-input" value={n.vg_vereinbart_am ? new Date(n.vg_vereinbart_am).toISOString().slice(0,16) : ''} onChange={e => onPatch({ vg_vereinbart_am: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </label>
              <label className="slideover-half">
                <span>Gehaltswunsch</span>
                <DebouncedInput value={n.gehaltswunsch || ''} onSave={v => onPatch({ gehaltswunsch: v })} />
              </label>
              <label className="slideover-half">
                <span>Verfügbarkeit</span>
                <DebouncedInput value={n.verfuegbarkeit || ''} onSave={v => onPatch({ verfuegbarkeit: v })} />
              </label>
            </div>
          </section>

          {/* Funnel-Antworten (Referenz) */}
          {antworten.length > 0 && (
            <section>
              <details className="slideover-details">
                <summary><h3>Funnel-Antworten ({antworten.length})</h3></summary>
                <ul className="slideover-antworten">
                  {antworten.map((a, i) => (
                    <li key={i}>
                      <div className="slideover-frage">{a.frage_text}</div>
                      <div className="slideover-antwort">→ {a.antwort}</div>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {fb.status && (
            <section>
              <h3>Kundenfeedback <span className="kundenfeedback-badge">{FEEDBACK_LABELS[fb.status] || fb.status}</span></h3>
              {fb.notizen && <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0' }}>{fb.notizen}</p>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ═════════════════════ HAUPTKOMPONENTE ═════════════════════ */

export default function BewerbungenTable({ job, kunde, internalSpalten: internalSpaltenProp, onChangeInternalSpalten }) {
  const telefonistenMode = !!job?.vorqualifizierung;
  // Fallback aufs Standard-Set, falls Vorqualifizierung aktiv, aber (noch) kein Feld-Set
  // konfiguriert ist — verhindert ein leeres/ausgegrautes Vorqual-Grid.
  const vorqualFelder = useMemo(
    () => effektiveVorqualFelder(job),
    [job?.vorqualifizierung_felder, job?.vorqualifizierung]
  );

  // Anruf-Spalten nur sichtbar wenn vorqualifizierung aktiv (für schlanke Ansicht)
  const internalSpalten = useMemo(() => {
    if (telefonistenMode) return internalSpaltenProp;
    return (internalSpaltenProp || []).filter(k => k !== 'anrufversuche');
  }, [internalSpaltenProp, telefonistenMode]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ bewerbungen: [], notizen: {}, feedback: {}, werte: {} });
  const [spalten, setSpalten] = useState([]);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('alle'); // alle | offen | erledigt
  const [kundeJobs, setKundeJobs] = useState([]); // alle Stellen des Kunden (für Umzuordnung)

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

  useEffect(() => {
    const kid = kunde?.id || job?.kunde_id;
    if (!kid) return;
    api(`/jobs?kunde_id=${kid}`).then(r => setKundeJobs(r.jobs || [])).catch(() => setKundeJobs([]));
  }, [kunde?.id, job?.kunde_id]);

  async function reassign(bewId, zielJobId) {
    if (!zielJobId || zielJobId === job.id) return;
    try {
      await api(`/bewerbungen/${bewId}/zuordnen`, { method: 'PATCH', body: { job_id: zielJobId } });
      setSelectedId(null);
      loadAll();
    } catch (e) { alert(e.message); }
  }

  /* Normalisierte Bewerbungen */
  const normalized = useMemo(() => {
    const map = new Map();
    for (const b of data.bewerbungen) map.set(b.id, normalizeBewerbung(b));
    return map;
  }, [data.bewerbungen]);

  /* Funnel-Frage-Spalten */
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

  /* Inline-Updates */
  async function updateNotiz(bewId, patch) {
    setData(prev => ({
      ...prev,
      notizen: { ...prev.notizen, [bewId]: { ...(prev.notizen[bewId] || {}), ...patch } },
    }));
    try {
      const res = await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: patch });
      setData(prev => ({ ...prev, notizen: { ...prev.notizen, [bewId]: res.notiz } }));
    } catch (err) { console.error('[notiz-save]', err.message); }
  }

  async function updateCustomCol(bewId, spalteId, wert) {
    setData(prev => ({
      ...prev,
      werte: { ...prev.werte, [bewId]: { ...(prev.werte[bewId] || {}), [spalteId]: wert } },
    }));
    try {
      await api(`/bewerbungen/${bewId}/spalten/${spalteId}`, { method: 'PUT', body: { wert } });
    } catch (err) { console.error('[wert-save]', err.message); }
  }

  /* Eigene Spalten */
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
    const active = internalSpaltenProp.includes(key);
    const next = active ? internalSpaltenProp.filter(s => s !== key) : [...internalSpaltenProp, key];
    onChangeInternalSpalten(next);
  }

  /* Filter */
  const filteredBewerbungen = useMemo(() => {
    let list = data.bewerbungen;
    if (filter === 'offen')    list = list.filter(b => !data.notizen[b.id]?.erledigt);
    if (filter === 'erledigt') list = list.filter(b =>  !!data.notizen[b.id]?.erledigt);
    return list;
  }, [data, filter]);

  /* CSV-Export */
  function exportCsv() {
    const rows = filteredBewerbungen.map(b => {
      const n = data.notizen[b.id] || {};
      const fb = data.feedback[b.id] || {};
      const norm = normalized.get(b.id) || {};
      const ampelLabel = n.ampel === 'gruen' ? '🟢 Grün' : n.ampel === 'gelb' ? '🟡 Gelb' : n.ampel === 'rot' ? '🔴 Rot' : '';
      const row = {
        Erledigt: n.erledigt ? '✓' : '',
        Ampel: telefonistenMode ? ampelLabel : '',
        Datum: new Date(b.created_at).toLocaleString('de-DE'),
        Name: norm.name || '',
        Status: STATUS_OPTIONS.find(o => o.value === (n.status || 'neu'))?.label || '',
      };
      if (telefonistenMode) {
        row['NW kontaktiert'] = n.nw_kontaktiert || '';
        row[`${kunde?.firmenname || 'Kunde'} kontaktiert`] = n.kunde_kontaktiert || '';
      }
      row.Telefon = norm.telefon || '';
      row.EMail = norm.email || '';
      row.Quelle = b.quelle === 'perspective' ? 'Perspective' : 'TalentOne';
      row.KO = b.ko_kriterium ? 'Ja' : '';
      for (const f of frageSpalten) row[f] = antwortFor(b, f);
      if (telefonistenMode) {
        for (const f of vorqualFelder) {
          row[`VQ: ${f.name}`] = (n.vorqualifizierung_werte || {})[f.name] || '';
        }
        row.Notiz = n.notizen || '';
        row.Bewertung = n.bewertung || '';
        row.VG = n.vg_vereinbart_am ? new Date(n.vg_vereinbart_am).toLocaleString('de-DE') : '';
        row.Eingestellt = EINGESTELLT_OPTIONS.find(o => o.value === (n.eingestellt || 'offen'))?.label || '';
      } else {
        for (const s of spalten) row[s.name] = (data.werte[b.id]?.[s.id]) ?? '';
        if (internalSpalten.includes('bewertung')) row.Bewertung = n.bewertung || '';
        if (internalSpalten.includes('notizen')) row.Notizen = n.notizen || '';
      }
      if (fb.status) row['Kundenfeedback'] = FEEDBACK_LABELS[fb.status] || fb.status;
      return row;
    });
    downloadCsv(`bewerbungen-${(job.stelle || 'job').replace(/\s+/g, '_')}.csv`, rows);
  }

  if (loading) return <div className="motiv-sub">Lade Bewerbungen…</div>;

  const selected = selectedId ? data.bewerbungen.find(b => b.id === selectedId) : null;
  const offen = data.bewerbungen.filter(b => !data.notizen[b.id]?.erledigt).length;
  const erledigt = data.bewerbungen.length - offen;

  return (
    <div className="bewerbungen-wrap">
      <div className="bewerbungen-toolbar">
        <strong>{data.bewerbungen.length} Bewerbungen</strong>
        {telefonistenMode && (
          <div className="bew-filter-group">
            <button className={`bew-filter ${filter === 'alle' ? 'is-active' : ''}`} onClick={() => setFilter('alle')}>Alle ({data.bewerbungen.length})</button>
            <button className={`bew-filter ${filter === 'offen' ? 'is-active' : ''}`} onClick={() => setFilter('offen')}>Offen ({offen})</button>
            <button className={`bew-filter ${filter === 'erledigt' ? 'is-active' : ''}`} onClick={() => setFilter('erledigt')}>Erledigt ({erledigt})</button>
          </div>
        )}
        <button className="btn-ghost btn-sm" onClick={() => setShowConfig(v => !v)}>
          {showConfig ? '✕ Konfiguration' : '⚙ Spalten konfigurieren'}
        </button>
        <button className="btn-ghost btn-sm" onClick={exportCsv} disabled={filteredBewerbungen.length === 0}>⬇ CSV-Export</button>
      </div>

      {showConfig && !telefonistenMode && (
        <div className="bewerbungen-config">
          <div className="config-section">
            <strong>Vordefinierte Spalten</strong>
            <div className="checkbox-grid">
              {Object.entries(INTERNE_SPALTEN_DEFS).filter(([key]) => key !== 'anrufversuche' || telefonistenMode).map(([key, def]) => (
                <label key={key} className="checkbox-row">
                  <input type="checkbox" checked={(internalSpaltenProp || []).includes(key)} onChange={() => toggleInternal(key)} />
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
              <input type="text" placeholder="Neuer Spaltenname" value={neueSpalteName} onChange={e => setNeueSpalteName(e.target.value)} />
              <select value={neueSpalteTyp} onChange={e => setNeueSpalteTyp(e.target.value)}>
                <option value="text">Text</option>
                <option value="datum">Datum</option>
              </select>
              <button className="btn-ghost btn-sm" onClick={addSpalte}>+ Hinzufügen</button>
            </div>
          </div>
        </div>
      )}

      {showConfig && telefonistenMode && (
        <div className="bewerbungen-config">
          <p className="pane-hint">
            Vorqualifizierungs-Felder werden im Stelle-Tab verwaltet. Hier können Sie zusätzlich
            eigene Tabellen-Spalten anlegen.
          </p>
          <div className="config-section">
            <strong>Eigene Spalten</strong>
            {spalten.map(s => (
              <div key={s.id} className="custom-col-row">
                <span>{s.name} <em className="muted">({s.typ})</em></span>
                <button className="btn-ghost btn-sm btn-danger" onClick={() => removeSpalte(s.id)}>×</button>
              </div>
            ))}
            <div className="custom-col-add">
              <input type="text" placeholder="Neuer Spaltenname" value={neueSpalteName} onChange={e => setNeueSpalteName(e.target.value)} />
              <select value={neueSpalteTyp} onChange={e => setNeueSpalteTyp(e.target.value)}>
                <option value="text">Text</option>
                <option value="datum">Datum</option>
              </select>
              <button className="btn-ghost btn-sm" onClick={addSpalte}>+ Hinzufügen</button>
            </div>
          </div>
        </div>
      )}

      {filteredBewerbungen.length === 0 ? (
        <div className="motiv-sub" style={{ marginTop: 16 }}>
          {data.bewerbungen.length === 0 ? 'Noch keine Bewerbungen.' : 'Keine Bewerbungen passen zum Filter.'}
        </div>
      ) : (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead>
              <tr>
                {telefonistenMode && <th style={{ width: 40 }}></th>}
                {telefonistenMode && <th style={{ width: 110 }}>Ampel</th>}
                <th>Datum</th>
                <th>Name</th>
                {telefonistenMode && <th>Status</th>}
                {telefonistenMode && <>
                  <th>N&amp;W kontaktiert am</th>
                  <th>{kunde?.firmenname || 'Kunde'} kontaktiert am</th>
                </>}
                <th>Telefon</th>
                <th>E-Mail</th>
                {!telefonistenMode && <th>Quelle</th>}
                {!telefonistenMode && <th>KO</th>}
                {frageSpalten.map(f => <th key={`q-${f}`} className="th-frage">{f}</th>)}
                {telefonistenMode && vorqualFelder.map((f, i) => (
                  <th key={`vq-${i}`} className="th-vorqual">{f.name}</th>
                ))}
                {!telefonistenMode && internalSpalten.map(key => INTERNE_SPALTEN_DEFS[key] && (
                  <th key={`i-${key}`} style={{ minWidth: INTERNE_SPALTEN_DEFS[key].width }}>
                    {INTERNE_SPALTEN_DEFS[key].label}
                  </th>
                ))}
                {telefonistenMode && <>
                  <th>Notiz / Bewertung</th>
                  <th>VG vereinbart</th>
                  <th>Eingestellt</th>
                </>}
                {spalten.map(s => <th key={`c-${s.id}`}>{s.name}</th>)}
                <th>Kundenfeedback</th>
              </tr>
            </thead>
            <tbody>
              {filteredBewerbungen.map(b => {
                const n = data.notizen[b.id] || {};
                const fb = data.feedback[b.id] || {};
                const norm = normalized.get(b.id) || {};
                const rowClass = [
                  b.ko_kriterium && 'is-ko',
                  n.erledigt && 'is-erledigt',
                  selectedId === b.id && 'is-selected',
                ].filter(Boolean).join(' ');
                return (
                  <tr key={b.id} className={rowClass} onClick={() => telefonistenMode && setSelectedId(b.id)} style={telefonistenMode ? { cursor: 'pointer' } : {}}>
                    {telefonistenMode && (
                      <td onClick={e => e.stopPropagation()} className="td-erledigt">
                        <input type="checkbox" checked={!!n.erledigt} onChange={e => updateNotiz(b.id, { erledigt: e.target.checked })} />
                      </td>
                    )}
                    {telefonistenMode && (
                      <td onClick={e => e.stopPropagation()}>
                        <AmpelSelector value={n.ampel} onChange={v => updateNotiz(b.id, { ampel: v })} />
                      </td>
                    )}
                    <td className="td-date">{new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="td-name">
                      <strong>{norm.name || '—'}</strong>
                      {b.zuordnung_unklar && kundeJobs.length > 1 && (
                        <div onClick={e => e.stopPropagation()} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="avv-warn" title="Konnte keiner Stelle eindeutig zugeordnet werden">⚠️ Stelle unklar</span>
                          <select className="cell-input" style={{ maxWidth: 200 }} defaultValue=""
                            onChange={e => { if (e.target.value) reassign(b.id, e.target.value); }}>
                            <option value="">→ anderer Stelle zuordnen…</option>
                            {kundeJobs.filter(j => j.id !== job.id).map(j => (
                              <option key={j.id} value={j.id}>{j.stelle || '(ohne Titel)'}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                    {telefonistenMode && (
                      <td onClick={e => e.stopPropagation()}>
                        <select className={`cell-input status-cell-${n.status || 'neu'}`} value={n.status || 'neu'} onChange={e => updateNotiz(b.id, { status: e.target.value })}>
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    )}
                    {telefonistenMode && (
                      <>
                        <td onClick={e => e.stopPropagation()}>
                          <input type="date" className="cell-input cell-date" value={(n.nw_kontaktiert || '').slice(0,10)} onChange={e => updateNotiz(b.id, { nw_kontaktiert: e.target.value || null })} />
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <input type="date" className="cell-input cell-date" value={(n.kunde_kontaktiert || '').slice(0,10)} onChange={e => updateNotiz(b.id, { kunde_kontaktiert: e.target.value || null })} />
                        </td>
                      </>
                    )}
                    <td>{norm.telefon ? <a href={`tel:${norm.telefon}`} onClick={e => e.stopPropagation()}>{norm.telefon}</a> : '—'}</td>
                    <td>{norm.email ? <a href={`mailto:${norm.email}`} onClick={e => e.stopPropagation()}>{norm.email}</a> : '—'}</td>
                    {!telefonistenMode && <td><span className={`quelle-badge quelle-${b.quelle || 'funnel'}`}>{b.quelle === 'perspective' ? 'Perspective' : 'TalentOne'}</span></td>}
                    {!telefonistenMode && <td>{b.ko_kriterium ? <span className="ko-badge">KO</span> : ''}</td>}
                    {frageSpalten.map(f => (
                      <td key={`q-${b.id}-${f}`} className="td-antwort">{antwortFor(b, f) || <span className="muted">—</span>}</td>
                    ))}
                    {telefonistenMode && vorqualFelder.map((f, i) => (
                      <td key={`vq-${b.id}-${i}`} onClick={e => e.stopPropagation()}>
                        <VorqualField
                          feld={f}
                          value={(n.vorqualifizierung_werte || {})[f.name] || ''}
                          onChange={v => {
                            const next = { ...(n.vorqualifizierung_werte || {}), [f.name]: v };
                            updateNotiz(b.id, { vorqualifizierung_werte: next });
                          }}
                        />
                      </td>
                    ))}
                    {!telefonistenMode && internalSpalten.map(key => {
                      if (!INTERNE_SPALTEN_DEFS[key]) return null;
                      if (key === 'status') return (
                        <td key={`i-${b.id}-${key}`}>
                          <select className="cell-input" value={n.status || 'neu'} onChange={e => updateNotiz(b.id, { status: e.target.value })}>
                            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      );
                      if (key === 'bewertung') return (
                        <td key={`i-${b.id}-${key}`}><StarRating value={n.bewertung || 0} onChange={v => updateNotiz(b.id, { bewertung: v })} /></td>
                      );
                      const isLong = key === 'notizen';
                      return (
                        <td key={`i-${b.id}-${key}`}><DebouncedInput value={n[key] || ''} onSave={v => updateNotiz(b.id, { [key]: v })} rows={isLong ? 2 : undefined} /></td>
                      );
                    })}
                    {telefonistenMode && (
                      <>
                        <td onClick={e => e.stopPropagation()} style={{ minWidth: 180 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <StarRating value={n.bewertung || 0} onChange={v => updateNotiz(b.id, { bewertung: v })} />
                            <DebouncedInput value={n.notizen || ''} onSave={v => updateNotiz(b.id, { notizen: v })} rows={2} />
                          </div>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <input type="datetime-local" className="cell-input" value={n.vg_vereinbart_am ? new Date(n.vg_vereinbart_am).toISOString().slice(0,16) : ''} onChange={e => updateNotiz(b.id, { vg_vereinbart_am: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <select className={`cell-input eingestellt-${n.eingestellt || 'offen'}`} value={n.eingestellt || 'offen'} onChange={e => updateNotiz(b.id, { eingestellt: e.target.value })}>
                            {EINGESTELLT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                      </>
                    )}
                    {spalten.map(s => (
                      <td key={`c-${b.id}-${s.id}`} onClick={e => e.stopPropagation()}>
                        {s.typ === 'datum'
                          ? <input type="date" className="cell-input cell-date" value={(data.werte[b.id]?.[s.id] || '').slice(0,10)} onChange={e => updateCustomCol(b.id, s.id, e.target.value)} />
                          : <DebouncedInput value={data.werte[b.id]?.[s.id] || ''} onSave={v => updateCustomCol(b.id, s.id, v)} />}
                      </td>
                    ))}
                    <td>
                      {fb.status ? (
                        <span className="kundenfeedback-badge">{FEEDBACK_LABELS[fb.status] || fb.status}</span>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {telefonistenMode && selected && (
        <TelefonistenSlideOver
          bewerbung={selected}
          norm={normalized.get(selected.id)}
          notiz={data.notizen[selected.id]}
          feedback={data.feedback[selected.id]}
          vorqualFelder={vorqualFelder}
          wichtigeKriterien={Array.isArray(job?.wichtige_kriterien) ? job.wichtige_kriterien : []}
          kundenname={kunde?.firmenname}
          kundeJobs={kundeJobs}
          currentJobId={job.id}
          onReassign={(zielJobId) => reassign(selected.id, zielJobId)}
          onPatch={patch => updateNotiz(selected.id, patch)}
          onPatchAnrufversuche={arr => updateNotiz(selected.id, { anrufversuche: arr })}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
