import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

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
    name: 'TalentOne',
    primary: '#0a0a0a',
    accent: '#d4ff00',
    website: 'https://talent-one.de',
    footer: 'Made with ♥ by TalentOne',
  },
  nowagwirth: {
    name: 'Nowag & Wirth',
    primary: '#1a3a6c',
    accent: '#ffd966',
    website: 'https://nowagwirth.de',
    footer: 'Made with ♥ by Nowag & Wirth',
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

function BewerberCard({ bewerbung: b, feedback, token, onFeedbackChange }) {
  const fb = feedback || {};
  const antworten = Array.isArray(b.antworten) ? b.antworten.filter(a => a && (a.antwort ?? '') !== '') : [];

  async function patch(body) {
    onFeedbackChange(b.id, { ...fb, ...body });
    try {
      const res = await fetch(`${API_BASE}/public/bewerbungen/${token}/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        onFeedbackChange(b.id, data.feedback);
      }
    } catch (err) { console.error(err); }
  }

  return (
    <details className={`pub-bew-card ${b.ko_kriterium ? 'is-ko' : ''}`}>
      <summary className="pub-bew-summary">
        <strong>{b.name || '(ohne Namen)'}</strong>
        <span className="pub-bew-contact">
          {b.email || b.telefon || '—'}
        </span>
        {b.ko_kriterium && <span className="pub-ko-badge">KO</span>}
        {fb.status && fb.status !== 'neu' && (
          <span className={`pub-status-badge pub-status-${fb.status}`}>
            {STATUS_OPTIONS.find(o => o.value === fb.status)?.label || fb.status}
          </span>
        )}
        <span className="pub-bew-date">{new Date(b.created_at).toLocaleDateString('de-DE')}</span>
      </summary>

      <div className="pub-bew-body">
        <div className="pub-bew-contact-grid">
          {b.email && <><dt>E-Mail</dt><dd><a href={`mailto:${b.email}`}>{b.email}</a></dd></>}
          {b.telefon && <><dt>Telefon</dt><dd><a href={`tel:${b.telefon}`}>{b.telefon}</a></dd></>}
          <dt>Eingegangen</dt><dd>{new Date(b.created_at).toLocaleString('de-DE')}</dd>
        </div>

        {antworten.length > 0 && (
          <div className="pub-bew-section">
            <h3>Antworten aus dem Bewerbungs-Funnel</h3>
            <ul className="pub-bew-antworten">
              {antworten.map((a, i) => (
                <li key={i}>
                  <div className="pub-frage">{a.frage_text || '—'}</div>
                  <div className="pub-antwort">→ {a.antwort}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pub-bew-section">
          <h3>Ihre Einschätzung</h3>
          <div className="pub-feedback-grid">
            <label>
              <span>Status</span>
              <select value={fb.status || 'neu'} onChange={e => patch({ status: e.target.value })}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label>
              <span>Vorstellungsgespräch am</span>
              <input
                type="datetime-local"
                value={fb.vorstellungsgespraech_am ? new Date(fb.vorstellungsgespraech_am).toISOString().slice(0,16) : ''}
                onChange={e => patch({ vorstellungsgespraech_am: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </label>
            <label className="pub-full">
              <span>Notizen</span>
              <DebouncedInput
                rows={3}
                value={fb.notizen || ''}
                placeholder="Eigene Anmerkungen…"
                onSave={v => patch({ notizen: v })}
              />
            </label>
          </div>
        </div>
      </div>
    </details>
  );
}

export default function PublicBewerbungen() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('alle'); // alle | qualifiziert
  const [sortAsc, setSortAsc] = useState(false);

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
          <button className="pub-sort" onClick={() => setSortAsc(v => !v)}>
            Datum {sortAsc ? '↑' : '↓'}
          </button>
        </div>

        {bewerbungen.length === 0 ? (
          <div className="pub-empty">Noch keine Bewerbungen.</div>
        ) : (
          <div className="pub-list">
            {bewerbungen.map(b => (
              <BewerberCard
                key={b.id}
                bewerbung={b}
                feedback={data.feedback[b.id]}
                token={token}
                onFeedbackChange={updateFeedback}
              />
            ))}
          </div>
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
