import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { normalizeBewerbung } from '../lib/perspectiveParser.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const STATUS_OPTIONS = [
  { value: 'neu',                    label: 'Neu' },
  { value: 'interessant',            label: 'Interessant' },
  { value: 'vorstellungsgespraech',  label: 'Vorstellungsgespräch' },
  { value: 'eingestellt',            label: 'Eingestellt' },
  { value: 'ungeeignet',             label: 'Ungeeignet' },
  { value: 'absage',                 label: 'Absage' },
];

// Stati, die einen Bewerber als "erledigt/abgeschlossen" markieren
const STATUS_ABGESCHLOSSEN = new Set(['ungeeignet', 'absage']);

const AMPEL_INFO = {
  gruen: { emoji: '🟢', label: 'Grün', desc: 'Dieser Kandidat passt — jetzt Kontakt aufnehmen!' },
  gelb:  { emoji: '🟡', label: 'Gelb', desc: 'Auf jeden Fall anrufen! Nur eine Kleinigkeit passt noch nicht ganz — im Gespräch klären.' },
  rot:   { emoji: '🔴', label: 'Rot',  desc: 'Passt leider nicht — keine Kontaktaufnahme nötig.' },
};
const AMPEL_SORT_ORDER = { gruen: 0, gelb: 1, rot: 2 };

const BRAND = {
  talentone: {
    name: 'TalentOne', primary: '#0a0a0a', accent: '#d4ff00', accentInk: '#0a0a0a',
    website: 'https://talent-one.de', footer: 'Made with ♥ by TalentOne',
  },
  nowagwirth: {
    name: 'Nowag & Wirth', primary: '#0a0a0a', accent: '#980000', accentInk: '#ffffff',
    website: 'https://nowagwirth.com', footer: 'Made with ♥ by Nowag & Wirth',
  },
};

/* ─── Debounced Text/Textarea ─── */
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

/* ─── Inline Status-Dropdown (für Tabelle) ─── */
function StatusSelect({ value, onChange }) {
  return (
    <select
      className={`pub-status-select pub-status-${value || 'neu'}`}
      value={value || 'neu'}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
    >
      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ─── Custom-Field Cell (Type-aware Editor) ─── */
function CustomFieldCell({ spalte, wert, onChange, fullWidth }) {
  if (spalte.typ === 'dropdown' && Array.isArray(spalte.optionen) && spalte.optionen.length > 0) {
    return (
      <select className="pub-custom-input" value={wert || ''} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {spalte.optionen.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (spalte.typ === 'datum') {
    return (
      <input
        type="date"
        className="pub-custom-input"
        value={(wert || '').slice(0, 10)}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
  return (
    <DebouncedInput value={wert || ''} onSave={onChange} placeholder={fullWidth ? `${spalte.name}…` : ''} />
  );
}

/* ─── Spalten-Manager Modal ─── */
function SpaltenManagerModal({ open, onClose, spalten, onAdd, onRemove }) {
  const [name, setName] = useState('');
  const [typ, setTyp] = useState('text');
  const [optionenText, setOptionenText] = useState('');

  function submit() {
    if (!name.trim()) return;
    const optionen = typ === 'dropdown'
      ? optionenText.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    onAdd({ name: name.trim(), typ, optionen });
    setName(''); setTyp('text'); setOptionenText('');
  }
  if (!open) return null;
  return (
    <div className="pub-modal-backdrop" onClick={onClose}>
      <div className="pub-modal" onClick={e => e.stopPropagation()}>
        <header className="pub-modal-head">
          <h2>Eigene Spalten</h2>
          <button className="pub-modal-close" onClick={onClose}>×</button>
        </header>
        <div className="pub-modal-body">
          <p className="pub-modal-hint">
            Fügen Sie eigene Felder hinzu, die für Ihre Bewerber relevant sind — z.B. Gehaltswunsch,
            Wechselmotivation, Erfahrung, Alter, Erreichbarkeit, Interview-Notiz. Werte werden pro Bewerber gespeichert.
          </p>

          {spalten.length > 0 && (
            <div className="pub-spalten-list">
              {spalten.map(s => (
                <div key={s.id} className="pub-spalten-list-row">
                  <span><strong>{s.name}</strong> <em className="pub-muted">({s.typ})</em></span>
                  <button className="pub-spalten-remove" onClick={() => onRemove(s.id)}>Entfernen</button>
                </div>
              ))}
            </div>
          )}

          <div className="pub-spalten-add">
            <h3>Neue Spalte hinzufügen</h3>
            <div className="pub-spalten-add-grid">
              <label>
                <span>Name</span>
                <input type="text" placeholder="z.B. Gehaltswunsch" value={name} onChange={e => setName(e.target.value)} />
              </label>
              <label>
                <span>Typ</span>
                <select value={typ} onChange={e => setTyp(e.target.value)}>
                  <option value="text">Text</option>
                  <option value="dropdown">Auswahl</option>
                  <option value="datum">Datum</option>
                </select>
              </label>
              {typ === 'dropdown' && (
                <label className="pub-full">
                  <span>Optionen (Komma-getrennt)</span>
                  <input type="text" placeholder="z.B. Ja, Nein, Vielleicht" value={optionenText} onChange={e => setOptionenText(e.target.value)} />
                </label>
              )}
              <div className="pub-spalten-add-actions">
                <button type="button" className="pub-modal-primary" onClick={submit} disabled={!name.trim()}>+ Hinzufügen</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Recruiter-Sync Anzeige (read-only für Kunden) ─── */
const RECRUITER_STATUS_LABELS = {
  neu: 'Neu', kontaktiert: 'Kontaktiert', interessiert: 'Interessiert',
  abgesagt: 'Abgesagt', weitergeleitet: 'Weitergeleitet',
};
function RecruiterSyncSection({ sync, brandName }) {
  if (!sync) return null;
  const vqWerte = sync.vorqualifizierung_werte && typeof sync.vorqualifizierung_werte === 'object'
    ? Object.entries(sync.vorqualifizierung_werte).filter(([, v]) => v != null && String(v).trim() !== '')
    : [];
  const hasData = sync.recruiter_status || sync.vg_vereinbart_am || (sync.eingestellt && sync.eingestellt !== 'offen')
    || sync.kunde_kontaktiert || sync.vorqual_gehaltswunsch || sync.vorqual_verfuegbarkeit
    || sync.vorqual_notiz || vqWerte.length > 0;
  if (!hasData) return null;
  return (
    <section className="pub-recruiter-sync">
      <h3>Vom {brandName || 'Recruiter'}</h3>
      <dl className="pub-slideover-dl">
        {sync.recruiter_status && <><dt>Status</dt><dd>{RECRUITER_STATUS_LABELS[sync.recruiter_status] || sync.recruiter_status}</dd></>}
        {sync.kunde_kontaktiert && <><dt>Sie kontaktiert</dt><dd>{new Date(sync.kunde_kontaktiert).toLocaleDateString('de-DE')}</dd></>}
        {sync.vg_vereinbart_am && <><dt>VG vereinbart</dt><dd>{new Date(sync.vg_vereinbart_am).toLocaleString('de-DE')}</dd></>}
        {sync.eingestellt && sync.eingestellt !== 'offen' && <><dt>Eingestellt</dt><dd>{sync.eingestellt === 'ja' ? '✓ Ja' : '✗ Nein'}</dd></>}
        {sync.vorqual_gehaltswunsch && <><dt>Gehaltswunsch</dt><dd>{sync.vorqual_gehaltswunsch}</dd></>}
        {sync.vorqual_verfuegbarkeit && <><dt>Verfügbarkeit</dt><dd>{sync.vorqual_verfuegbarkeit}</dd></>}
        {vqWerte.map(([k, v]) => (
          <FragmentRow key={k} label={k} value={String(v)} />
        ))}
      </dl>
      {sync.vorqual_notiz && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#78350f', marginBottom: 4 }}>Notiz aus dem Vorqualifizierungs-Gespräch</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{sync.vorqual_notiz}</div>
        </div>
      )}
    </section>
  );
}
function FragmentRow({ label, value }) {
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}

/* ─── Slide-Over für Bewerber-Detail ─── */
function BewerberSlideOver({ bewerbung, normalized, feedback, spalten, werte, recruiterSync, brandName, onPatchFeedback, onSetWert, onClose }) {
  if (!bewerbung) return null;
  const norm = normalized || {};
  const fb = feedback || {};
  return (
    <div className="pub-slideover-backdrop" onClick={onClose}>
      <aside className="pub-slideover" onClick={e => e.stopPropagation()}>
        <header className="pub-slideover-head">
          <div>
            <h2>{norm.name || '(ohne Namen)'}</h2>
            <p className="pub-slideover-meta">
              {new Date(bewerbung.created_at).toLocaleString('de-DE')}
              {bewerbung.ko_kriterium && <> · <span className="pub-ko-badge">KO</span></>}
              {fb.status && fb.status !== 'neu' && (
                <> · <span className={`pub-status-badge pub-status-${fb.status}`}>{STATUS_OPTIONS.find(o => o.value === fb.status)?.label}</span></>
              )}
            </p>
          </div>
          <button className="pub-slideover-close" onClick={onClose}>×</button>
        </header>

        <div className="pub-slideover-body">
          {/* Kontakt */}
          <section>
            <h3>Kontakt</h3>
            <dl className="pub-slideover-dl">
              <dt>Name</dt><dd>{norm.name || '—'}</dd>
              <dt>E-Mail</dt><dd>{norm.email ? <a href={`mailto:${norm.email}`}>{norm.email}</a> : '—'}</dd>
              <dt>Telefon</dt><dd>{norm.telefon ? <a href={`tel:${norm.telefon}`}>{norm.telefon}</a> : '—'}</dd>
            </dl>
          </section>

          {/* Vom Recruiter (sync) */}
          <RecruiterSyncSection sync={recruiterSync} brandName={brandName} />

          {/* Funnel-Antworten */}
          {norm.antworten?.length > 0 && (
            <section>
              <h3>Antworten aus dem Bewerbungs-Funnel</h3>
              <ul className="pub-slideover-antworten">
                {norm.antworten.map((a, i) => (
                  <li key={i}>
                    <div className="pub-slideover-frage">{a.frage_text}</div>
                    <div className="pub-slideover-antwort">→ {a.antwort}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Ihre Einschätzung — Status / VG / Notizen */}
          <section>
            <h3>Ihre Einschätzung</h3>
            <div className="pub-slideover-form">
              <label>
                <span>Status</span>
                <select value={fb.status || 'neu'} onChange={e => onPatchFeedback({ status: e.target.value })}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label>
                <span>Vorstellungsgespräch am</span>
                <input
                  type="datetime-local"
                  value={fb.vorstellungsgespraech_am ? new Date(fb.vorstellungsgespraech_am).toISOString().slice(0,16) : ''}
                  onChange={e => onPatchFeedback({ vorstellungsgespraech_am: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />
              </label>
              <label className="pub-full">
                <span>Notizen</span>
                <DebouncedInput rows={4} value={fb.notizen || ''} placeholder="Eigene Anmerkungen…" onSave={v => onPatchFeedback({ notizen: v })} />
              </label>
            </div>
          </section>

          {/* Eigene Felder */}
          {spalten?.length > 0 && (
            <section>
              <h3>Ihre eigenen Felder</h3>
              <div className="pub-slideover-customs">
                {spalten.map(s => (
                  <label key={s.id} className="pub-full">
                    <span>{s.name}</span>
                    <CustomFieldCell
                      spalte={s}
                      wert={werte?.[s.id] || ''}
                      onChange={v => onSetWert(s.id, v)}
                      fullWidth
                    />
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function PublicBewerbungen() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  // Default: nur aktive Bewerber (ohne Ungeeignet/Absage)
  const [aktivFilter, setAktivFilter] = useState('aktive'); // 'alle' | 'aktive' | 'erledigte'
  const [ampelFilter, setAmpelFilter] = useState('alle');   // 'alle' | 'gruen' | 'gelb' | 'rot'
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [erklaerungOffen, setErklaerungOffen] = useState(true);

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

  /* ─── Custom Spalten ─── */
  async function addSpalte({ name, typ, optionen }) {
    try {
      const res = await fetch(`${API_BASE}/public/bewerbungen/${token}/spalten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, typ, optionen }),
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

  /* ─── Daten-Derivate ─── */
  const normalized = useMemo(() => {
    if (!data) return new Map();
    const m = new Map();
    for (const b of data.bewerbungen) m.set(b.id, normalizeBewerbung(b));
    return m;
  }, [data]);

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

  function ampelFor(bewId) {
    return data?.recruiter_sync?.[bewId]?.ampel || null;
  }

  const counts = useMemo(() => {
    if (!data) return { alle: 0, aktive: 0, erledigte: 0 };
    let aktive = 0, erledigte = 0;
    for (const b of data.bewerbungen) {
      const st = data.feedback[b.id]?.status;
      if (STATUS_ABGESCHLOSSEN.has(st)) erledigte++;
      else aktive++;
    }
    return { alle: data.bewerbungen.length, aktive, erledigte };
  }, [data]);

  const bewerbungen = useMemo(() => {
    if (!data) return [];
    let list = data.bewerbungen.slice();

    // Aktiv-/Erledigt-Filter
    if (aktivFilter === 'aktive') {
      list = list.filter(b => !STATUS_ABGESCHLOSSEN.has(data.feedback[b.id]?.status));
    } else if (aktivFilter === 'erledigte') {
      list = list.filter(b => STATUS_ABGESCHLOSSEN.has(data.feedback[b.id]?.status));
    }

    // Ampel-Filter
    if (ampelFilter !== 'alle') {
      list = list.filter(b => ampelFor(b.id) === ampelFilter);
    }

    // Sort: Ampel-Reihenfolge gewinnt (Grün → Gelb → Rot → leer), dann Datum
    list.sort((a, b) => {
      const aa = AMPEL_SORT_ORDER[ampelFor(a.id)] ?? 99;
      const bb = AMPEL_SORT_ORDER[ampelFor(b.id)] ?? 99;
      if (aa !== bb) return aa - bb;
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortAsc ? da - db : db - da;
    });
    return list;
  }, [data, aktivFilter, ampelFilter, sortAsc]);

  if (loading) return <div className="pub-shell"><div className="pub-loading">Lade…</div></div>;
  if (error) return <div className="pub-shell"><div className="pub-error">{error}</div></div>;
  if (!data) return null;

  const selected = selectedId ? data.bewerbungen.find(b => b.id === selectedId) : null;

  return (
    <div className="pub-shell" style={{ '--pub-primary': brand.primary, '--pub-accent': brand.accent, '--pub-accent-ink': brand.accentInk }}>
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
        {/* Ampel-Erklärungsbox */}
        <details className="pub-ampel-info" open={erklaerungOffen} onToggle={e => setErklaerungOffen(e.target.open)}>
          <summary>
            <span>🚦 So lesen Sie die Ampel-Bewertung des {brand.name}-Teams</span>
          </summary>
          <div className="pub-ampel-info-grid">
            {Object.entries(AMPEL_INFO).map(([key, info]) => (
              <div key={key} className={`pub-ampel-info-card pub-ampel-card-${key}`}>
                <div className="pub-ampel-info-head">{info.emoji} {info.label}</div>
                <div className="pub-ampel-info-desc">{info.desc}</div>
              </div>
            ))}
          </div>
        </details>

        <div className="pub-toolbar">
          <div className="pub-filter-group">
            <button className={`pub-filter ${aktivFilter === 'aktive' ? 'is-active' : ''}`} onClick={() => setAktivFilter('aktive')}>Nur aktive ({counts.aktive})</button>
            <button className={`pub-filter ${aktivFilter === 'alle' ? 'is-active' : ''}`} onClick={() => setAktivFilter('alle')}>Alle ({counts.alle})</button>
            <button className={`pub-filter ${aktivFilter === 'erledigte' ? 'is-active' : ''}`} onClick={() => setAktivFilter('erledigte')}>Erledigte ({counts.erledigte})</button>
          </div>
          <div className="pub-ampel-filter">
            <button className={`pub-ampel-fbtn ${ampelFilter === 'alle' ? 'is-active' : ''}`} onClick={() => setAmpelFilter('alle')}>Alle Ampeln</button>
            <button className={`pub-ampel-fbtn ${ampelFilter === 'gruen' ? 'is-active' : ''}`} onClick={() => setAmpelFilter('gruen')} title="Nur Grün">🟢</button>
            <button className={`pub-ampel-fbtn ${ampelFilter === 'gelb' ? 'is-active' : ''}`} onClick={() => setAmpelFilter('gelb')} title="Nur Gelb">🟡</button>
            <button className={`pub-ampel-fbtn ${ampelFilter === 'rot' ? 'is-active' : ''}`} onClick={() => setAmpelFilter('rot')} title="Nur Rot">🔴</button>
          </div>
          <div className="pub-toolbar-right">
            <button className="pub-add-col-btn" onClick={() => setManagerOpen(true)}>⚙ Spalten anpassen</button>
            <button className="pub-sort" onClick={() => setSortAsc(v => !v)}>Datum {sortAsc ? '↑' : '↓'}</button>
          </div>
        </div>

        {bewerbungen.length === 0 ? (
          <div className="pub-empty">Noch keine Bewerbungen.</div>
        ) : (
          <>
            {/* Desktop: Tabelle */}
            <div className="pub-table-scroll">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Datum</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>E-Mail</th>
                    <th>Telefon</th>
                    <th>KO</th>
                    {frageSpalten.map(f => <th key={f}>{f}</th>)}
                    {(data.spalten || []).map(s => <th key={s.id} className="pub-th-custom">{s.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {bewerbungen.map(b => {
                    const norm = normalized.get(b.id) || {};
                    const fb = data.feedback[b.id] || {};
                    const ampel = ampelFor(b.id);
                    const isAbgeschlossen = STATUS_ABGESCHLOSSEN.has(fb.status);
                    const rowCls = [
                      'pub-tr',
                      b.ko_kriterium && 'is-ko',
                      selectedId === b.id && 'is-selected',
                      isAbgeschlossen && 'is-abgeschlossen',
                      ampel && `pub-row-ampel-${ampel}`,
                    ].filter(Boolean).join(' ');
                    return (
                      <tr key={b.id} className={rowCls} onClick={() => setSelectedId(b.id)}>
                        <td className="pub-td-ampel">
                          {ampel ? (
                            <span className={`pub-ampel-dot pub-ampel-dot-${ampel}`} title={AMPEL_INFO[ampel].label}>{AMPEL_INFO[ampel].emoji}</span>
                          ) : <span className="pub-muted">·</span>}
                        </td>
                        <td className="pub-td-date">{new Date(b.created_at).toLocaleDateString('de-DE')}</td>
                        <td><strong>{norm.name || '—'}</strong></td>
                        <td className="pub-td-status">
                          <StatusSelect value={fb.status} onChange={v => patchFeedback(b.id, { status: v })} />
                        </td>
                        <td>{norm.email ? <a href={`mailto:${norm.email}`} onClick={e => e.stopPropagation()}>{norm.email}</a> : '—'}</td>
                        <td>{norm.telefon ? <a href={`tel:${norm.telefon}`} onClick={e => e.stopPropagation()}>{norm.telefon}</a> : '—'}</td>
                        <td>{b.ko_kriterium ? <span className="pub-ko-badge">KO</span> : ''}</td>
                        {frageSpalten.map(f => <td key={f} className="pub-td-antwort">{antwortFor(b.id, f) || <span className="pub-muted">—</span>}</td>)}
                        {(data.spalten || []).map(s => (
                          <td key={s.id} className="pub-td-custom" onClick={e => e.stopPropagation()}>
                            <CustomFieldCell
                              spalte={s}
                              wert={data.werte?.[b.id]?.[s.id] || ''}
                              onChange={v => setSpalteWert(b.id, s.id, v)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: Karten */}
            <div className="pub-cards">
              {bewerbungen.map(b => {
                const norm = normalized.get(b.id) || {};
                const fb = data.feedback[b.id] || {};
                const ampel = ampelFor(b.id);
                const isAbgeschlossen = STATUS_ABGESCHLOSSEN.has(fb.status);
                const mcardCls = [
                  'pub-mcard',
                  b.ko_kriterium && 'is-ko',
                  isAbgeschlossen && 'is-abgeschlossen',
                  ampel && `pub-row-ampel-${ampel}`,
                ].filter(Boolean).join(' ');
                return (
                  <div key={b.id} className={mcardCls} onClick={() => setSelectedId(b.id)}>
                    {ampel && <div className="pub-mcard-ampel">{AMPEL_INFO[ampel].emoji} {AMPEL_INFO[ampel].label}</div>}
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
                      {norm.email && <><dt>E-Mail</dt><dd><a href={`mailto:${norm.email}`} onClick={e => e.stopPropagation()}>{norm.email}</a></dd></>}
                      {norm.telefon && <><dt>Telefon</dt><dd><a href={`tel:${norm.telefon}`} onClick={e => e.stopPropagation()}>{norm.telefon}</a></dd></>}
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
                    <button className="pub-mcard-toggle" onClick={e => { e.stopPropagation(); setSelectedId(b.id); }}>
                      Details bearbeiten ▸
                    </button>
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

      <BewerberSlideOver
        bewerbung={selected}
        normalized={selected ? normalized.get(selected.id) : null}
        feedback={selected ? data.feedback[selected.id] : null}
        spalten={data.spalten || []}
        werte={selected ? data.werte?.[selected.id] : null}
        recruiterSync={selected ? data.recruiter_sync?.[selected.id] : null}
        brandName={brand.name}
        onPatchFeedback={body => selected && patchFeedback(selected.id, body)}
        onSetWert={(spalteId, v) => selected && setSpalteWert(selected.id, spalteId, v)}
        onClose={() => setSelectedId(null)}
      />

      <SpaltenManagerModal
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        spalten={data.spalten || []}
        onAdd={addSpalte}
        onRemove={removeSpalte}
      />
    </div>
  );
}
