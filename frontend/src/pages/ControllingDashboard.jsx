import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';

const AMPEL = {
  rot:   { emoji: '🔴', label: 'Kritisch',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  gelb:  { emoji: '🟡', label: 'Achtung',    color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  gruen: { emoji: '🟢', label: 'Läuft',      color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  grau:  { emoji: '⚪', label: 'Nicht live', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
};
const AGENTUR_LABEL = { talentone: 'TalentOne', nowagwirth: 'Nowag & Wirth' };

function Sparkline({ data }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 34 }} title="Bewerbungen letzte 14 Tage">
      {data.map((d, i) => (
        <div key={i}
          title={`${d.date}: ${d.count}`}
          style={{
            width: 5,
            height: `${Math.max(2, (d.count / max) * 34)}px`,
            background: d.count > 0 ? '#0a0a0a' : '#e5e7eb',
            borderRadius: 1,
          }} />
      ))}
    </div>
  );
}

function tageLabel(t) {
  if (t == null) return 'noch nie';
  if (t === 0) return 'heute';
  if (t === 1) return 'gestern';
  return `vor ${t} Tagen`;
}

export default function ControllingDashboard() {
  const [days, setDays] = useState(14);        // 7 | 14 | 30 | 'custom'
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('live'); // live | aktiv | alle
  const [agentur, setAgentur] = useState('alle');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);   // kunde_id
  const [drill, setDrill] = useState({});           // kunde_id -> drilldown
  const [chartKunde, setChartKunde] = useState(''); // '' = gesamt

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (days === 'custom') { if (from) p.set('from', from); if (to) p.set('to', to); }
    else p.set('days', String(days));
    p.set('status', status);
    p.set('agentur', agentur);
    return p.toString();
  }, [days, from, to, status, agentur]);

  useEffect(() => {
    let cancelled = false;
    if (days === 'custom' && !from) return; // erst laden, wenn Startdatum gesetzt
    setLoading(true); setError('');
    api(`/controlling-ops/overview?${query}`)
      .then(res => { if (!cancelled) { setData(res); setExpanded(null); } })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, days, from]);

  const loadDrill = useCallback(async (kundeId) => {
    if (drill[kundeId]) return drill[kundeId];
    try {
      const p = new URLSearchParams();
      if (days === 'custom') { if (from) p.set('from', from); if (to) p.set('to', to); }
      else p.set('days', String(days));
      const res = await api(`/controlling-ops/kunde/${kundeId}?${p.toString()}`);
      setDrill(prev => ({ ...prev, [kundeId]: res }));
      return res;
    } catch { return null; }
  }, [drill, days, from, to]);

  // Drilldown bei Bedarf laden (Zeile aufklappen ODER Chart-Kunde gewählt)
  useEffect(() => { if (expanded) loadDrill(expanded); }, [expanded, loadDrill]);
  useEffect(() => { if (chartKunde) loadDrill(chartKunde); }, [chartKunde, loadDrill]);

  // Reset Drill-Cache bei Filterwechsel (Zeitraum ändert die Zahlen)
  useEffect(() => { setDrill({}); }, [query]);

  const perTagChart = chartKunde
    ? (drill[chartKunde]?.charts?.per_tag || [])
    : (data?.charts?.per_tag || []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>📊 Controlling</h1>
        <p style={{ color: '#5a5955', fontSize: 14, margin: 0 }}>
          Wo brennt es? Bewerbungseingang, Trends und Ampel über alle Projekte im Filter.
        </p>
      </header>

      {/* ── Filter ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Zeitraum</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map(d => (
              <button key={d} type="button" onClick={() => setDays(d)}
                style={segBtn(days === d)}>{d} Tage</button>
            ))}
            <button type="button" onClick={() => setDays('custom')} style={segBtn(days === 'custom')}>Eigener</button>
          </div>
        </div>
        {days === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
            <span style={{ color: '#9a9994' }}>–</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
          </div>
        )}
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
            <option value="live">Nur Live-Projekte</option>
            <option value="aktiv">Alle aktiven</option>
            <option value="alle">Alle inkl. abgeschlossene</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Agentur</label>
          <select value={agentur} onChange={e => setAgentur(e.target.value)} style={inputStyle}>
            <option value="alle">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowagwirth">Nowag & Wirth</option>
          </select>
        </div>
      </div>

      {loading && <div style={{ padding: 30, color: '#9a9994' }}>Lade Controlling-Daten…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* ── Totals ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
            <Stat label="Projekte" value={data.totals.projekte} />
            <Stat label="🔴 Kritisch" value={data.totals.rot} color={AMPEL.rot.color} />
            <Stat label="🟡 Achtung" value={data.totals.gelb} color={AMPEL.gelb.color} />
            <Stat label="🟢 Läuft" value={data.totals.gruen} color={AMPEL.gruen.color} />
            <Stat label="Bewerbungen (Zeitraum)" value={data.totals.bewerbungen} />
          </div>

          {/* ── Ampel-Liste ── */}
          <section style={{ marginBottom: 30 }}>
            <h2 style={h2Style}>Ampel-Übersicht</h2>
            {data.rows.length === 0 && <div style={emptyStyle}>Keine Projekte im aktuellen Filter.</div>}
            <div style={{ display: 'grid', gap: 8 }}>
              {data.rows.map(r => {
                const meta = AMPEL[r.ampel] || AMPEL.grau;
                const isOpen = expanded === r.kunde_id;
                return (
                  <div key={r.projekt_id} style={{
                    border: `1px solid ${meta.border}`, borderLeft: `4px solid ${meta.color}`,
                    borderRadius: 10, background: '#fff', overflow: 'hidden',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', cursor: 'pointer' }}
                      onClick={() => setExpanded(isOpen ? null : r.kunde_id)}>
                      <span style={{ fontSize: 18 }} title={meta.label}>{meta.emoji}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 15 }}>{r.kunde}</strong>
                          <span style={{ color: '#5a5955', fontSize: 13 }}>· {r.stelle}{r.anzahl_stellen > 1 ? ` (+${r.anzahl_stellen - 1})` : ''}</span>
                          {r.agentur && <span style={badge}>{AGENTUR_LABEL[r.agentur] || r.agentur}</span>}
                          {r.funnel_extern === true && <span style={badge}>extern</span>}
                        </div>
                        <div style={{ fontSize: 12, color: meta.color, marginTop: 2 }}>{r.ampel_grund}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 12, color: '#5a5955', whiteSpace: 'nowrap' }}>
                        <div><strong style={{ color: '#0a0a0a', fontSize: 15 }}>{r.bewerbungen_range}</strong> Bew.</div>
                        <div>{r.live_tag != null
                          ? `Tag ${r.live_tag}${r.soll_tage ? `/${r.soll_tage}` : ''}`
                          : 'kein Live-Start'}</div>
                        <div>letzte: {tageLabel(r.letzte_bewerbung_tage)}</div>
                      </div>
                      <Sparkline data={r.sparkline} />
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${meta.border}`, padding: '14px', background: '#fcfcfb' }}>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                          {r.primary_job_id
                            ? <Link to={`/kunden/${r.kunde_id}/jobs/${r.primary_job_id}/funnel`} style={linkBtn}>→ Bewerberliste</Link>
                            : <Link to={`/kunden/${r.kunde_id}`} style={linkBtn}>→ Kunde</Link>}
                          <Link to={`/kunden/${r.kunde_id}`} style={linkBtnGhost}>Kundenseite</Link>
                        </div>
                        <Drilldown d={drill[r.kunde_id]} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Diagramme ── */}
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={h2Style}>Bewerbungen pro Tag</h2>
              <select value={chartKunde} onChange={e => setChartKunde(e.target.value)} style={inputStyle}>
                <option value="">Gesamt (alle im Filter)</option>
                {data.kunden.map(k => <option key={k.id} value={k.id}>{k.firmenname}</option>)}
              </select>
            </div>
            <ChartCard>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={perTagChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Bewerbungen" fill="#0a0a0a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
            <section>
              <h2 style={h2Style}>Wochentag</h2>
              <p style={hintStyle}>Wann kommen die meisten Bewerbungen? (Basis fürs Ad-Scheduling)</p>
              <ChartCard>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.charts.wochentag} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="tag" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Bewerbungen" radius={[3, 3, 0, 0]}>
                      {data.charts.wochentag.map((_, i) => <Cell key={i} fill={i >= 5 ? '#c7c7c2' : '#0068a3'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>
            <section>
              <h2 style={h2Style}>Uhrzeit</h2>
              <p style={hintStyle}>Bewerbungen nach Tagesstunde (Berlin-Zeit)</p>
              <ChartCard>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.charts.stunde} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="stunde" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Bewerbungen" fill="#0a8043" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>
          </div>

          <p style={{ ...hintStyle, marginTop: 18 }}>
            Ampel-Schwellen: 🔴 = 0 Bewerbungen seit {data.thresholds.keineBewerbungTage}+ Tagen oder deutlich unter Soll ·
            🟡 = aktuelle Woche &lt; {Math.round(data.thresholds.gelbRuecklaufFaktor * 100)}% der Vorwoche oder Laufzeit überschritten.
          </p>
        </>
      )}
    </div>
  );
}

function Drilldown({ d }) {
  if (!d) return <div style={{ color: '#9a9994', fontSize: 13 }}>Lade Details…</div>;
  const c = d.conversion;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
      <div>
        <div style={miniTitle}>Bewerbungen pro Tag</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={d.charts.per_tag} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={24} />
            <Tooltip />
            <Bar dataKey="count" fill="#0a0a0a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div style={miniTitle}>Wochentag</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={d.charts.wochentag} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <XAxis dataKey="tag" tick={{ fontSize: 9 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={24} />
            <Tooltip />
            <Bar dataKey="count" fill="#0068a3" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div style={miniTitle}>Conversion & Quellen</div>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Pill>{c.bewerbungen} Bewerbungen</Pill>
            <span style={{ color: '#9a9994' }}>→</span>
            <Pill>{c.qualifiziert} qualifiziert{c.quote != null ? ` (${c.quote}%)` : ''}</Pill>
          </div>
          <div style={{ fontSize: 11, color: '#9a9994', margin: '6px 0 10px' }}>{c.hinweis}</div>
          <div style={{ fontSize: 12, color: '#5a5955' }}>
            Quellen: {d.quellen.funnel} intern (TalentOne) · {d.quellen.perspective} Perspective
            {d.quellen.andere ? ` · ${d.quellen.andere} andere` : ''}
          </div>
          {d.stellen.length > 1 && (
            <div style={{ fontSize: 12, color: '#5a5955', marginTop: 8 }}>
              {d.stellen.map(s => (
                <div key={s.job_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.stelle}</span>
                  <strong>{s.bewerbungen}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 10, padding: '12px 16px', minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#0a0a0a' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#5a5955' }}>{label}</div>
    </div>
  );
}
function ChartCard({ children }) {
  return <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 10, padding: '14px 10px 6px' }}>{children}</div>;
}
function Pill({ children }) {
  return <span style={{ background: '#f1f1ee', borderRadius: 100, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{children}</span>;
}

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: '#5a5955', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' };
const inputStyle = { padding: '7px 10px', border: '1px solid #d8d8d4', borderRadius: 8, fontSize: 13, background: '#fff' };
const h2Style = { fontSize: 15, fontWeight: 700, margin: '0 0 10px' };
const hintStyle = { fontSize: 12, color: '#9a9994', margin: '0 0 10px' };
const miniTitle = { fontSize: 11, fontWeight: 700, color: '#5a5955', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const emptyStyle = { padding: 30, background: '#fff', border: '1px solid #ececea', borderRadius: 10, textAlign: 'center', color: '#9a9994' };
const badge = { fontSize: 10, fontWeight: 600, color: '#5a5955', background: '#f1f1ee', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.03em' };
const linkBtn = { fontSize: 13, fontWeight: 600, color: '#fff', background: '#0a0a0a', padding: '7px 14px', borderRadius: 8, textDecoration: 'none' };
const linkBtnGhost = { fontSize: 13, fontWeight: 600, color: '#0a0a0a', background: '#f1f1ee', padding: '7px 14px', borderRadius: 8, textDecoration: 'none' };

function segBtn(active) {
  return {
    padding: '7px 12px', border: `1px solid ${active ? '#0a0a0a' : '#d8d8d4'}`,
    borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: active ? 700 : 400,
    background: active ? '#0a0a0a' : '#fff', color: active ? '#fff' : '#0a0a0a',
  };
}
