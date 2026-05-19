import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { normalizeBewerbung } from '../lib/perspectiveParser.js';

const STATUS_OPTIONS = [
  { value: 'neu', label: 'Neu' },
  { value: 'kontaktiert', label: 'Kontaktiert' },
  { value: 'interessiert', label: 'Interessiert' },
  { value: 'abgesagt', label: 'Abgesagt' },
  { value: 'weitergeleitet', label: 'Weitergeleitet' },
];

const FEEDBACK_LABELS = {
  neu: 'Neu',
  interessant: 'Interessant',
  vorstellungsgespraech: 'Vorstellungsgespräch',
  eingestellt: 'Eingestellt',
  abgesagt: 'Abgesagt',
};

function DebouncedInput({ value, onSave, rows, placeholder }) {
  const [local, setLocal] = useState(value ?? '');
  const timerRef = useRef(null);
  const lastRef = useRef(value ?? '');
  useEffect(() => { setLocal(value ?? ''); lastRef.current = value ?? ''; }, [value]);
  function onChange(e) {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { if (v !== lastRef.current) { lastRef.current = v; onSave(v); } }, 600);
  }
  function flushOnBlur() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (local !== lastRef.current) { lastRef.current = local; onSave(local); }
  }
  if (rows) return <textarea className="cell-input" rows={rows} value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
  return <input className="cell-input" type="text" value={local} placeholder={placeholder} onChange={onChange} onBlur={flushOnBlur} />;
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

function csvDownload(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function BewerbungenOverview() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ bewerbungen: [], notizen: {}, feedback: {}, stats: {} });
  const [selectedBewerbung, setSelectedBewerbung] = useState(null);

  // Filter — Telefonisten-Defaults: nur Vorqualifizierung + nur offen
  const [nurVorqual, setNurVorqual] = useState(true);
  const [nurOffen, setNurOffen] = useState(true);
  const [kundeFilter, setKundeFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [quelleFilter, setQuelleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState([]); // multi
  const [agenturFilter, setAgenturFilter] = useState('');
  const [vonFilter, setVonFilter] = useState('');
  const [bisFilter, setBisFilter] = useState('');
  const [ohneKo, setOhneKo] = useState(false);

  // Sort
  const [sortKey, setSortKey] = useState('created_at');
  const [sortAsc, setSortAsc] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (quelleFilter) params.set('quelle', quelleFilter);
      if (ohneKo) params.set('ohne_ko', '1');
      if (vonFilter) params.set('von', new Date(vonFilter).toISOString());
      if (bisFilter) params.set('bis', new Date(bisFilter + 'T23:59:59').toISOString());
      const d = await api(`/bewerbungen?${params.toString()}`);
      setData(d);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [quelleFilter, ohneKo, vonFilter, bisFilter]);

  // Kunden + Jobs aus den Bewerbungen extrahieren (für Dropdowns)
  const kundenMap = useMemo(() => {
    const map = new Map();
    for (const b of data.bewerbungen) {
      const k = b.talentone_jobs?.talentone_kunden;
      if (k && !map.has(k.id)) map.set(k.id, k);
    }
    return Array.from(map.values()).sort((a, b) => (a.firmenname || '').localeCompare(b.firmenname || ''));
  }, [data.bewerbungen]);

  const jobsMap = useMemo(() => {
    const map = new Map();
    for (const b of data.bewerbungen) {
      const j = b.talentone_jobs;
      if (j && !map.has(j.id)) map.set(j.id, j);
    }
    return Array.from(map.values()).sort((a, b) => (a.stelle || '').localeCompare(b.stelle || ''));
  }, [data.bewerbungen]);

  // Counter für die beiden Telefonisten-Toggles (auf Basis-Datenmenge, vor anderen Filtern)
  const counts = useMemo(() => {
    const vorqualAll = data.bewerbungen.filter(b => b.talentone_jobs?.vorqualifizierung).length;
    const vorqualOffen = data.bewerbungen.filter(b =>
      b.talentone_jobs?.vorqualifizierung && !data.notizen[b.id]?.erledigt
    ).length;
    return { vorqualAll, vorqualOffen, alle: data.bewerbungen.length };
  }, [data]);

  // Client-side Filter
  const filtered = useMemo(() => {
    let list = data.bewerbungen;
    if (nurVorqual) list = list.filter(b => b.talentone_jobs?.vorqualifizierung);
    if (nurOffen) list = list.filter(b => !data.notizen[b.id]?.erledigt);
    if (kundeFilter) list = list.filter(b => b.talentone_jobs?.kunde_id === kundeFilter);
    if (jobFilter) list = list.filter(b => b.job_id === jobFilter);
    if (agenturFilter) list = list.filter(b => b.talentone_jobs?.talentone_kunden?.agentur === agenturFilter);
    if (statusFilter.length > 0) {
      list = list.filter(b => statusFilter.includes((data.notizen[b.id]?.status) || 'neu'));
    }
    // Sort
    const dir = sortAsc ? 1 : -1;
    list = list.slice().sort((a, b) => {
      let av, bv;
      if (sortKey === 'created_at') { av = new Date(a.created_at).getTime(); bv = new Date(b.created_at).getTime(); }
      else if (sortKey === 'name') { av = a.name || ''; bv = b.name || ''; }
      else if (sortKey === 'kunde') { av = a.talentone_jobs?.talentone_kunden?.firmenname || ''; bv = b.talentone_jobs?.talentone_kunden?.firmenname || ''; }
      else if (sortKey === 'stelle') { av = a.talentone_jobs?.stelle || ''; bv = b.talentone_jobs?.stelle || ''; }
      else if (sortKey === 'status') { av = data.notizen[a.id]?.status || 'neu'; bv = data.notizen[b.id]?.status || 'neu'; }
      else if (sortKey === 'bewertung') { av = data.notizen[a.id]?.bewertung || 0; bv = data.notizen[b.id]?.bewertung || 0; }
      else { av = ''; bv = ''; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }, [data, nurVorqual, nurOffen, kundeFilter, jobFilter, agenturFilter, statusFilter, sortKey, sortAsc]);

  async function updateNotiz(bewId, patch) {
    setData(prev => ({ ...prev, notizen: { ...prev.notizen, [bewId]: { ...(prev.notizen[bewId] || {}), ...patch } } }));
    try {
      const res = await api(`/bewerbungen/${bewId}/notiz`, { method: 'PATCH', body: patch });
      setData(prev => ({ ...prev, notizen: { ...prev.notizen, [bewId]: res.notiz } }));
    } catch (err) { console.error(err); }
  }

  function toggleStatus(s) {
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function exportCsv() {
    const rows = filtered.map(b => {
      const n = data.notizen[b.id] || {};
      const fb = data.feedback[b.id] || {};
      const anrufe = Array.isArray(n.anrufversuche) ? n.anrufversuche.length : 0;
      const lastAnruf = anrufe > 0 ? n.anrufversuche[anrufe - 1] : null;
      return {
        Datum: new Date(b.created_at).toLocaleString('de-DE'),
        Name: b.name || '', EMail: b.email || '', Telefon: b.telefon || '',
        Kunde: b.talentone_jobs?.talentone_kunden?.firmenname || '',
        Stelle: b.talentone_jobs?.stelle || '',
        Quelle: b.quelle === 'perspective' ? 'Perspective' : 'TalentOne',
        KO: b.ko_kriterium ? 'Ja' : '',
        Status: STATUS_OPTIONS.find(o => o.value === (n.status || 'neu'))?.label || '',
        Bewertung: n.bewertung || '',
        Anrufversuche: anrufe,
        LetzterAnruf: lastAnruf ? `${lastAnruf.datum || ''} ${lastAnruf.ergebnis || ''}` : '',
        NaechsteAktion: n.naechste_aktion || '',
        Kundenfeedback: fb.status ? (FEEDBACK_LABELS[fb.status] || fb.status) : '',
      };
    });
    csvDownload(`bewerbungen-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }

  function SortHeader({ k, label }) {
    return (
      <th onClick={() => { if (sortKey === k) setSortAsc(v => !v); else { setSortKey(k); setSortAsc(false); } }} className="th-sortable">
        {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <div className="bew-overview">
      <header className="bew-overview-head">
        <h1>Bewerbungen</h1>
        <div className="bew-overview-quickfilter">
          <button
            className={`bew-quick-toggle ${nurVorqual ? 'is-on' : ''}`}
            onClick={() => setNurVorqual(v => !v)}
            title="Nur Bewerbungen aus Jobs mit Telefonischer Vorqualifizierung"
          >
            <span className="bew-quick-dot">{nurVorqual ? '✓' : ''}</span>
            Nur Vorqualifizierung
            <span className="bew-quick-count">({counts.vorqualAll})</span>
          </button>
          <button
            className={`bew-quick-toggle ${nurOffen ? 'is-on' : ''}`}
            onClick={() => setNurOffen(v => !v)}
            title="Nur noch nicht als erledigt markierte Bewerber"
          >
            <span className="bew-quick-dot">{nurOffen ? '✓' : ''}</span>
            Nur offen
            <span className="bew-quick-count">({nurVorqual ? counts.vorqualOffen : counts.alle - data.bewerbungen.filter(b => data.notizen[b.id]?.erledigt).length})</span>
          </button>
        </div>
        <button className="btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>⬇ CSV-Export ({filtered.length})</button>
      </header>

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-num">{data.stats.neueHeute ?? 0}</div><div className="stat-label">Neu heute</div></div>
        <div className="stat-card"><div className="stat-num">{data.stats.offen ?? 0}</div><div className="stat-label">Offen (noch nicht kontaktiert)</div></div>
        <div className="stat-card"><div className="stat-num">{data.stats.inBearbeitung ?? 0}</div><div className="stat-label">In Bearbeitung</div></div>
        <div className="stat-card"><div className="stat-num">{data.stats.weitergeleitetWoche ?? 0}</div><div className="stat-label">Weitergeleitet diese Woche</div></div>
      </section>

      <section className="filter-bar">
        <div className="filter-group">
          <label>Kunde</label>
          <select value={kundeFilter} onChange={e => { setKundeFilter(e.target.value); setJobFilter(''); }}>
            <option value="">Alle Kunden</option>
            {kundenMap.map(k => <option key={k.id} value={k.id}>{k.firmenname}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Stelle</label>
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
            <option value="">Alle Stellen</option>
            {jobsMap.filter(j => !kundeFilter || j.kunde_id === kundeFilter).map(j => <option key={j.id} value={j.id}>{j.stelle || '—'}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Quelle</label>
          <select value={quelleFilter} onChange={e => setQuelleFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="funnel">TalentOne</option>
            <option value="perspective">Perspective</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Agentur</label>
          <select value={agenturFilter} onChange={e => setAgenturFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowagwirth">Nowag & Wirth</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Zeitraum</label>
          <div className="filter-dates">
            <input type="date" value={vonFilter} onChange={e => setVonFilter(e.target.value)} />
            <span>–</span>
            <input type="date" value={bisFilter} onChange={e => setBisFilter(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <label>Optionen</label>
          <label className="checkbox-inline">
            <input type="checkbox" checked={ohneKo} onChange={e => setOhneKo(e.target.checked)} />
            <span>Nur ohne KO</span>
          </label>
        </div>
        <div className="filter-group filter-group-full">
          <label>Status</label>
          <div className="filter-chips">
            {STATUS_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                className={`chip chip-${o.value} ${statusFilter.includes(o.value) ? 'is-on' : ''}`}
                onClick={() => toggleStatus(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="motiv-sub">Lade Bewerbungen…</div>
      ) : filtered.length === 0 ? (
        <div className="motiv-sub">Keine Bewerbungen für die aktuellen Filter.</div>
      ) : (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead>
              <tr>
                <SortHeader k="created_at" label="Datum" />
                <SortHeader k="name" label="Bewerber" />
                <SortHeader k="kunde" label="Kunde" />
                <SortHeader k="stelle" label="Stelle" />
                <th>Quelle</th>
                <th>KO</th>
                <SortHeader k="status" label="Status" />
                <th>Anrufe</th>
                <th>Nächste Aktion</th>
                <SortHeader k="bewertung" label="Bewertung" />
                <th>Notizen</th>
                <th>Kundenfeedback</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const norm = normalizeBewerbung(b);
                const n = data.notizen[b.id] || {};
                const fb = data.feedback[b.id] || {};
                const anrufe = Array.isArray(n.anrufversuche) ? n.anrufversuche.filter(a => a.datum || a.ergebnis) : [];
                const lastAnruf = anrufe[anrufe.length - 1];
                const kunde = b.talentone_jobs?.talentone_kunden;
                const job = b.talentone_jobs;
                return (
                  <tr key={b.id} className={b.ko_kriterium ? 'is-ko' : ''}>
                    <td className="td-date">{new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="td-name">
                      <button className="link-button" onClick={() => setSelectedBewerbung(b)}>
                        <strong>{norm.name || '—'}</strong>
                      </button>
                      <div className="td-name-meta">{norm.email || ''}{norm.email && norm.telefon ? ' · ' : ''}{norm.telefon || ''}</div>
                    </td>
                    <td>{kunde ? <Link to={`/kunden/${kunde.id}`}>{kunde.firmenname}</Link> : '—'}</td>
                    <td>{job && kunde ? <Link to={`/kunden/${kunde.id}/jobs/${job.id}/funnel`}>{job.stelle || '—'}</Link> : '—'}</td>
                    <td><span className={`quelle-badge quelle-${b.quelle || 'funnel'}`}>{b.quelle === 'perspective' ? 'Perspective' : 'TalentOne'}</span></td>
                    <td>{b.ko_kriterium ? <span className="ko-badge">KO</span> : ''}</td>
                    <td>
                      <select className="cell-input" value={n.status || 'neu'} onChange={e => updateNotiz(b.id, { status: e.target.value })}>
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="td-anrufe-summary">
                      <strong>{anrufe.length}</strong>
                      {lastAnruf && <span className="muted"> · {lastAnruf.datum ? new Date(lastAnruf.datum).toLocaleDateString('de-DE') : ''}</span>}
                    </td>
                    <td>
                      <DebouncedInput value={n.naechste_aktion || ''} onSave={v => updateNotiz(b.id, { naechste_aktion: v })} />
                    </td>
                    <td>
                      <StarRating value={n.bewertung || 0} onChange={v => updateNotiz(b.id, { bewertung: v })} />
                    </td>
                    <td className="td-notizen-preview" title={n.notizen || ''}>
                      {n.notizen ? <span>{n.notizen.slice(0, 60)}{n.notizen.length > 60 ? '…' : ''}</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      {fb.status ? (
                        <span className={`kundenfeedback-badge kundenfeedback-${fb.status}`}>
                          Kunde: {FEEDBACK_LABELS[fb.status]}
                          {fb.vorstellungsgespraech_am && ` · ${new Date(fb.vorstellungsgespraech_am).toLocaleDateString('de-DE')}`}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedBewerbung && (
        <SlideOver bewerbung={selectedBewerbung} notiz={data.notizen[selectedBewerbung.id]} feedback={data.feedback[selectedBewerbung.id]} onClose={() => setSelectedBewerbung(null)} onUpdate={(patch) => updateNotiz(selectedBewerbung.id, patch)} />
      )}
    </div>
  );
}

function SlideOver({ bewerbung: b, notiz: n, feedback: fb, onClose, onUpdate }) {
  const note = n || {};
  const feedback = fb || {};
  const norm = normalizeBewerbung(b);
  const kunde = b.talentone_jobs?.talentone_kunden;
  const job = b.talentone_jobs;

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <aside className="slideover" onClick={e => e.stopPropagation()}>
        <header className="slideover-head">
          <div>
            <h2>{norm.name || '(ohne Namen)'}</h2>
            <p className="muted">
              {new Date(b.created_at).toLocaleString('de-DE')} ·
              {' '}{b.quelle === 'perspective' ? 'Perspective' : 'TalentOne Funnel'}
              {b.ko_kriterium && <> · <span className="ko-badge">KO</span></>}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </header>

        <div className="slideover-body">
          {/* 1. Kontaktdaten */}
          <section>
            <h3>Kontaktdaten</h3>
            <dl className="slideover-dl">
              <dt>Name</dt><dd>{norm.name || <span className="muted">—</span>}</dd>
              <dt>E-Mail</dt><dd>{norm.email ? <a href={`mailto:${norm.email}`}>{norm.email}</a> : <span className="muted">—</span>}</dd>
              <dt>Telefon</dt><dd>{norm.telefon ? <a href={`tel:${norm.telefon}`}>{norm.telefon}</a> : <span className="muted">—</span>}</dd>
            </dl>
          </section>

          {/* 2. Anrufversuche (prominent — Telefonierer brauchen das zuerst) */}
          <section className="slideover-anrufversuche">
            <h3>Anrufversuche</h3>
            <AnrufversucheBlock value={note.anrufversuche || []} onChange={v => onUpdate({ anrufversuche: v })} />
          </section>

          {/* 3. Status + Bewertung + Nächste Aktion */}
          <section>
            <h3>Status & Bewertung</h3>
            <div className="slideover-form">
              <label><span>Status</span>
                <select className="cell-input" value={note.status || 'neu'} onChange={e => onUpdate({ status: e.target.value })}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label><span>Bewertung</span>
                <StarRating value={note.bewertung || 0} onChange={v => onUpdate({ bewertung: v })} />
              </label>
              <label className="slideover-full"><span>Nächste Aktion</span>
                <DebouncedInput value={note.naechste_aktion || ''} onSave={v => onUpdate({ naechste_aktion: v })} />
              </label>
            </div>
          </section>

          {/* 4. Gehaltswunsch + Verfügbarkeit */}
          <section>
            <h3>Konditionen</h3>
            <div className="slideover-form">
              <label><span>Gehaltswunsch</span>
                <DebouncedInput value={note.gehaltswunsch || ''} onSave={v => onUpdate({ gehaltswunsch: v })} />
              </label>
              <label><span>Verfügbarkeit</span>
                <DebouncedInput value={note.verfuegbarkeit || ''} onSave={v => onUpdate({ verfuegbarkeit: v })} />
              </label>
            </div>
          </section>

          {/* 5. Notizen */}
          <section>
            <h3>Notizen</h3>
            <DebouncedInput rows={5} value={note.notizen || ''} onSave={v => onUpdate({ notizen: v })} />
          </section>

          {/* 6. Funnel-Antworten — aufklappbar */}
          {norm.antworten.length > 0 && (
            <section>
              <details className="slideover-details">
                <summary><h3>Funnel-Antworten ({norm.antworten.length})</h3></summary>
                <ul className="slideover-antworten">
                  {norm.antworten.map((a, i) => (
                    <li key={i}>
                      <div className="slideover-frage">Frage: {a.frage_text}</div>
                      <div className="slideover-antwort">→ Antwort: {a.antwort}</div>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {/* 7. Kundenfeedback */}
          {feedback.status && (
            <section>
              <h3>Kundenfeedback <span className="kundenfeedback-badge">{FEEDBACK_LABELS[feedback.status] || feedback.status}</span></h3>
              <dl className="slideover-dl">
                {feedback.vorstellungsgespraech_am && <><dt>Vorstellungsgespräch</dt><dd>{new Date(feedback.vorstellungsgespraech_am).toLocaleString('de-DE')}</dd></>}
                {feedback.notizen && <><dt>Notizen</dt><dd>{feedback.notizen}</dd></>}
              </dl>
            </section>
          )}

          {/* 8. Link zum Projekt */}
          {job && kunde && (
            <section>
              <h3>Projekt</h3>
              <dl className="slideover-dl">
                <dt>Kunde</dt><dd><Link to={`/kunden/${kunde.id}`} onClick={onClose}>{kunde.firmenname}</Link></dd>
                <dt>Stelle</dt><dd><Link to={`/kunden/${kunde.id}/jobs/${job.id}/funnel`} onClick={onClose}>{job.stelle || '—'}</Link></dd>
              </dl>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function AnrufversucheBlock({ value, onChange }) {
  const arr = Array.isArray(value) ? value : [];
  function patch(i, p) {
    const next = [...arr]; next[i] = { ...(next[i] || {}), ...p };
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
              <option value="">—</option>
              <option value="erreicht">Erreicht</option>
              <option value="nicht_erreicht">Nicht erreicht</option>
              <option value="mailbox">Mailbox</option>
            </select>
            <DebouncedInput value={a.notiz || ''} placeholder="Notiz" onSave={v => patch(i, { notiz: v })} />
          </div>
        );
      })}
    </div>
  );
}
