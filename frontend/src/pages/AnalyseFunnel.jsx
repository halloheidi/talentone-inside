import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const RANGES = [
  { key: 'heute', label: 'Heute' },
  { key: '7d',    label: '7 Tage' },
  { key: '30d',   label: '30 Tage' },
  { key: 'custom', label: 'Custom' },
];

const FUNNEL_STAGES = [
  { key: 'besucher',           label: 'Besucher' },
  { key: 'formular_gestartet', label: 'Formular gestartet' },
  { key: 'formular_abgeschickt', label: 'Formular abgeschickt' },
  { key: 'score_gesehen',      label: 'Score gesehen' },
  { key: 'email_lead',         label: 'E-Mail (Lead)' },
  { key: 'volle_vorschau',     label: 'Volle Vorschau' },
  { key: 'termin_cta',         label: 'Termin-CTA geklickt' },
  { key: 'termin_gebucht',     label: 'Termin gebucht' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AnalyseFunnel() {
  const [range, setRange] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function buildQuery() {
    const params = new URLSearchParams({ range });
    if (range === 'custom') {
      if (customFrom) params.set('from', new Date(customFrom).toISOString());
      if (customTo)   params.set('to', new Date(customTo).toISOString());
    }
    return params.toString();
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery();
      const [s, l] = await Promise.all([
        api(`/analyse-funnel/stats?${q}`),
        api(`/analyse-funnel/sessions?${q}&limit=200`),
      ]);
      setStats(s);
      setSessions(l.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (range !== 'custom') load();
    // eslint-disable-next-line
  }, [range]);

  // Top-bar Werte
  const cards = useMemo(() => {
    if (!stats) return [];
    const s = stats.stages;
    const conv = s.besucher > 0 ? ((s.email_lead / s.besucher) * 100).toFixed(1) + '%' : '—';
    return [
      { label: 'Besucher',           value: s.besucher,           color: '#0a0a0a' },
      { label: 'Vorschauen',         value: s.teaser_gesehen,     color: '#5a5955' },
      { label: 'Leads (E-Mail)',     value: s.email_lead,         color: '#15803d' },
      { label: 'Leads mit Telefon',  value: s.lead_mit_telefon,   color: '#b91c1c', highlight: true },
      { label: 'Termin-Klicks',      value: s.termin_cta,         color: '#0a0a0a' },
      { label: 'Termine gebucht',    value: s.termin_gebucht,     color: '#15803d' },
      { label: 'Gesamt-Conversion',  value: conv,                 color: '#0a0a0a' },
    ];
  }, [stats]);

  // Funnel-Bars
  const funnelBars = useMemo(() => {
    if (!stats) return [];
    const s = stats.stages;
    const top = s.besucher || 1;
    return FUNNEL_STAGES.map((stage, i) => {
      const val = s[stage.key] || 0;
      const pct = top > 0 ? Math.round((val / top) * 100) : 0;
      const prevVal = i > 0 ? (s[FUNNEL_STAGES[i - 1].key] || 0) : top;
      const dropoff = prevVal > 0 && i > 0 ? Math.round(((prevVal - val) / prevVal) * 100) : 0;
      return { ...stage, val, pct, dropoff };
    });
  }, [stats]);

  return (
    <div className="analyse-funnel">
      <style>{`
        .analyse-funnel { max-width: 1240px; margin: 0 auto; padding: 24px 32px; }
        .afn-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        .afn-head h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
        .afn-range { display: flex; gap: 4px; background: var(--bg-2,#f0efed); padding: 4px; border-radius: 100px; }
        .afn-range-btn { padding: 8px 16px; border: none; background: transparent; border-radius: 100px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--ink-2,#5a5955); }
        .afn-range-btn.is-active { background: var(--ink-1,#0a0a0a); color: var(--accent,#e8ff3d); }
        .afn-custom { display: flex; gap: 8px; align-items: center; font-size: 13px; }
        .afn-custom input { padding: 6px 10px; border: 1px solid var(--bg-3,#e2e0dc); border-radius: 6px; font-size: 13px; font-family: inherit; }
        .afn-custom button { padding: 7px 14px; background: var(--ink-1,#0a0a0a); color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .afn-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 32px; }
        .afn-card { padding: 16px 18px; background: #fff; border: 1px solid var(--bg-3,#e2e0dc); border-radius: 12px; }
        .afn-card.is-highlight { border: 2px solid #b91c1c; background: linear-gradient(180deg,#fff5f5,#fff); }
        .afn-card-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3,#999790); margin-bottom: 6px; }
        .afn-card-value { font-size: 28px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
        .afn-section { background: #fff; border: 1px solid var(--bg-3,#e2e0dc); border-radius: 14px; padding: 24px 26px; margin-bottom: 24px; }
        .afn-section h2 { font-size: 16px; font-weight: 700; margin-bottom: 14px; }
        .funnel-bar { display: grid; grid-template-columns: 200px 1fr 110px; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--bg-2,#f0efed); }
        .funnel-bar:last-child { border-bottom: none; }
        .funnel-bar-label { font-size: 13.5px; color: var(--ink-1,#0a0a0a); font-weight: 600; }
        .funnel-bar-track { background: var(--bg-2,#f0efed); border-radius: 6px; height: 28px; overflow: hidden; position: relative; }
        .funnel-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent,#e8ff3d), #c8df00); border-radius: 6px; transition: width 0.4s ease; }
        .funnel-bar-val { font-size: 13px; color: var(--ink-2,#5a5955); text-align: right; font-variant-numeric: tabular-nums; }
        .funnel-bar-val strong { color: var(--ink-1,#0a0a0a); font-weight: 700; }
        .funnel-bar-val .drop { color: #b91c1c; font-size: 11px; margin-left: 4px; }
        .sess-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sess-table th { text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3,#999790); border-bottom: 1px solid var(--bg-3,#e2e0dc); }
        .sess-table td { padding: 10px 10px; border-bottom: 1px solid var(--bg-2,#f0efed); vertical-align: middle; }
        .sess-thumb { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--bg-2,#f0efed); }
        .sess-thumb-empty { width: 44px; height: 44px; border-radius: 6px; background: var(--bg-2,#f0efed); display: flex; align-items: center; justify-content: center; color: var(--ink-3,#999790); font-size: 14px; }
        .sess-pill { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 700; }
        .sess-pill-lead { background: #dcfce7; color: #15803d; }
        .sess-pill-anon { background: #f0efed; color: #5a5955; }
        .sess-pill-hot { background: #fef3c7; color: #92400e; margin-left: 4px; }
        .sess-stage { font-size: 11.5px; color: var(--ink-2,#5a5955); }
        .sess-empty { text-align: center; padding: 32px 0; color: var(--ink-3,#999790); }
      `}</style>

      <div className="afn-head">
        <h1>📊 Analyse-Funnel</h1>
        <div className="afn-range" role="tablist">
          {RANGES.map(r => (
            <button
              key={r.key}
              className={`afn-range-btn ${range === r.key ? 'is-active' : ''}`}
              onClick={() => setRange(r.key)}
            >{r.label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="afn-custom">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span>bis</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
            <button onClick={load} disabled={!customFrom}>Anwenden</button>
          </div>
        )}
      </div>

      {error && <div className="afn-section" style={{ color: '#b91c1c' }}>Fehler: {error}</div>}
      {loading && !stats && <div className="afn-section">Lade…</div>}

      {stats && (
        <>
          {/* Stat-Cards */}
          <div className="afn-cards">
            {cards.map(c => (
              <div key={c.label} className={`afn-card ${c.highlight ? 'is-highlight' : ''}`}>
                <div className="afn-card-label">{c.label}</div>
                <div className="afn-card-value" style={{ color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Funnel-Bars */}
          <div className="afn-section">
            <h2>Conversion-Trichter</h2>
            {funnelBars.map((b, i) => (
              <div key={b.key} className="funnel-bar">
                <div className="funnel-bar-label">{b.label}</div>
                <div className="funnel-bar-track">
                  <div className="funnel-bar-fill" style={{ width: b.pct + '%' }} />
                </div>
                <div className="funnel-bar-val">
                  <strong>{b.val}</strong> · {b.pct}%
                  {i > 0 && b.dropoff > 0 && <span className="drop">−{b.dropoff}%</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Session-Liste */}
          <div className="afn-section">
            <h2>Sessions ({sessions.length})</h2>
            {sessions.length === 0 ? (
              <div className="sess-empty">Keine Sessions im gewählten Zeitfenster.</div>
            ) : (
              <table className="sess-table">
                <thead>
                  <tr>
                    <th>Creative</th>
                    <th>Zeit</th>
                    <th>Stelle / Region</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.session_id}>
                      <td>
                        {s.creative_url
                          ? <img src={s.creative_url} alt="" className="sess-thumb" loading="lazy" />
                          : <div className="sess-thumb-empty">—</div>}
                      </td>
                      <td>{fmtDate(s.created_at)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.stelle || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3,#999790)' }}>{s.region || '—'}</div>
                      </td>
                      <td>
                        {s.hat_email
                          ? <>
                              <span className="sess-pill sess-pill-lead">Lead</span>
                              {s.hat_telefon && <span className="sess-pill sess-pill-hot">📞 Tel</span>}
                              {s.analyse?.email && <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 3 }}>{s.analyse.email}</div>}
                            </>
                          : <span className="sess-pill sess-pill-anon">Anonym</span>}
                      </td>
                      <td>{s.score ?? '—'}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-3,#999790)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.quelle || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
