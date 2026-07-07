import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  LineChart, Line, ComposedChart,
} from 'recharts';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 10) / 10} %`);
const BRAND_COLORS = { talentone: '#c8ea2a', nowag_wirth: '#980000' };
const BRAND_LABEL  = { talentone: 'TalentOne', nowag_wirth: 'Nowag & Wirth' };

function todayIso() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthIso() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function Controlling() {
  const { me, isAdmin } = useAuth();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [brand, setBrand] = useState('');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  if (me && !isAdmin) {
    return <div className="card empty"><h2>Kein Zugriff</h2><p>Nur Admin-Mitglieder sehen das Controlling.</p></div>;
  }

  useEffect(() => {
    setLoading(true); setErr('');
    const q = new URLSearchParams({ from, to });
    if (brand) q.set('brand', brand);
    Promise.all([
      api(`/controlling/kpis?${q.toString()}`),
      api(`/controlling/mrr-trend${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/revenue-monthly${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/hire-times${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/open-invoices${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/abos-in-guarantee${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/abos-servicefree-paused${brand ? `?brand=${brand}` : ''}`),
      api(`/controlling/latest-offers?limit=20${brand ? `&brand=${brand}` : ''}`),
    ]).then(([k, tr, rev, ht, oi, ig, sfp, lo]) => {
      setData({ kpis: k, mrrTrend: tr.trend, revenue: rev.monthly, hireTimes: ht.groups,
                openInvoices: oi.invoices, inGuarantee: ig.abos, servicefreePaused: sfp.abos,
                latestOffers: lo.offers });
    }).catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [from, to, brand]);

  const funnelData = useMemo(() => {
    const f = data.kpis?.funnel;
    if (!f) return [];
    return ['created', 'sent', 'accepted'].map(stage => ({
      stage: stage === 'created' ? 'Erstellt' : stage === 'sent' ? 'Versandt' : 'Angenommen',
      TalentOne: f.talentone?.[stage] || 0,
      'Nowag & Wirth': f.nowag_wirth?.[stage] || 0,
    }));
  }, [data.kpis]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Controlling</h1>
          <p className="page-sub">Kennzahlen für Angebote, Rechnungen und Kampagnen — brand-getrennt.</p>
        </div>
      </div>

      <section className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group"><label>Von</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="filter-group"><label>Bis</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="filter-group"><label>Marke</label>
          <select value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowag_wirth">Nowag &amp; Wirth</option>
          </select></div>
        <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}
          onClick={() => { setFrom(firstOfMonthIso()); setTo(todayIso()); setBrand(''); }}>
          Zurücksetzen
        </button>
      </section>

      {err && <div className="alert alert-error">{err}</div>}
      {loading && <div className="card empty">Lade…</div>}

      {!loading && data.kpis && (
        <>
          {/* KPI-Kacheln */}
          <div className="stats-grid" style={{ marginBottom: 22 }}>
            <StatCard label="MRR" value={eur.format(data.kpis.mrr.total)}
              sub={`Δ Vormonat: ${data.kpis.mrr.delta >= 0 ? '+' : ''}${eur0.format(data.kpis.mrr.delta)}`}
              foot={`davon ${eur.format(data.kpis.mrr.in_guarantee)} in Garantiephase`} />
            <StatCard label="Angebote (Zeitraum)" value={sum3(data.kpis.funnel)}
              sub={`Erstellt / Versandt / Angenommen`} />
            <StatCard label="Annahmequote" value={pct(data.kpis.acceptance.rate)}
              sub={`${data.kpis.acceptance.accepted} von ${data.kpis.acceptance.sent}`} />
            <StatCard label="Ø Monat 1"
              value={brand === 'nowag_wirth' ? (data.kpis.avg_month1.nowag_wirth != null ? eur.format(data.kpis.avg_month1.nowag_wirth) : '—') :
                     brand === 'talentone'   ? (data.kpis.avg_month1.talentone   != null ? eur.format(data.kpis.avg_month1.talentone)   : '—') :
                     `${data.kpis.avg_month1.talentone != null ? eur0.format(data.kpis.avg_month1.talentone) : '—'} / ${data.kpis.avg_month1.nowag_wirth != null ? eur0.format(data.kpis.avg_month1.nowag_wirth) : '—'}`}
              sub={brand ? BRAND_LABEL[brand] : 'TalentOne / N&W'} />
            <StatCard label="Offene Forderungen"
              value={eur.format(data.kpis.open_receivables.total)}
              sub={`${data.kpis.open_receivables.count} Rechnungen`}
              foot={data.kpis.open_receivables.overdue > 0
                ? <span style={{ color: '#b91c1c' }}>davon überfällig: {eur.format(data.kpis.open_receivables.overdue)}</span>
                : 'keine überfälligen'} />
            <StatCard label="Garantiekosten"
              value={brand === 'nowag_wirth' ? eur.format(data.kpis.guarantee_costs.nowag_wirth) :
                     brand === 'talentone'   ? eur.format(data.kpis.guarantee_costs.talentone) :
                     eur.format(data.kpis.guarantee_costs.talentone + data.kpis.guarantee_costs.nowag_wirth)}
              sub={brand ? BRAND_LABEL[brand] : `TO ${eur0.format(data.kpis.guarantee_costs.talentone)} · NW ${eur0.format(data.kpis.guarantee_costs.nowag_wirth)}`}
              foot="entgangene Pauschalen (Skip-Log)" />
            <StatCard label="Churn" value={pct(data.kpis.churn.rate)}
              sub={`${data.kpis.churn.ended_in_range} von ${data.kpis.churn.active_at_start} beendet`} />
            <StatCard label="Ø Durchlaufzeit"
              value={data.kpis.turnaround.avg_days != null ? `${data.kpis.turnaround.avg_days} Tage` : '—'}
              sub={`sent → accepted (${data.kpis.turnaround.count} Angebote)`} />
          </div>

          {/* Diagramme */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
            <ChartCard title="Angebots-Funnel je Marke">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={funnelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="stage" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="TalentOne" fill={BRAND_COLORS.talentone} />
                  <Bar dataKey="Nowag & Wirth" fill={BRAND_COLORS.nowag_wirth} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="MRR-Entwicklung (12 Monate)">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.mrrTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={v => eur0.format(v)} />
                  <Tooltip formatter={v => eur.format(v)} />
                  <Legend />
                  <Bar dataKey="talentone"   stackId="a" fill={BRAND_COLORS.talentone}   name="TalentOne" />
                  <Bar dataKey="nowag_wirth" stackId="a" fill={BRAND_COLORS.nowag_wirth} name="Nowag & Wirth" />
                </BarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: '8px 0 0' }}>
                Basis: real fakturierte monthly_service-Anteile aus talentone_invoices.
              </p>
            </ChartCard>

            <ChartCard title="Umsatz je Monat: Setup vs. monatliche Pauschalen · Werbebudget (Durchleitung)">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.revenue || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={v => eur0.format(v)} />
                  <Tooltip formatter={v => eur.format(v)} />
                  <Legend />
                  <Bar dataKey="setup"    stackId="rev" fill="#5a5955" name="Setup (einmalig)" />
                  <Bar dataKey="service"  stackId="rev" fill="#0a8043" name="Servicepauschale" />
                  <Line dataKey="ad_budget" stroke="#0068a3" strokeDasharray="4 3" strokeWidth={1.5} name="Werbebudget — Durchleitung" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Ø Zeit bis Einstellung — je Marke × Garantiefrist">
              {(!data.hireTimes || data.hireTimes.length === 0) ? (
                <div className="card empty" style={{ padding: 20, fontSize: 12 }}>Noch keine Einstellungen erfasst.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="bewerbungen-table" style={{ marginTop: 6 }}>
                    <thead><tr>
                      <th>Marke</th><th>Garantie</th>
                      <th style={{ textAlign: 'right' }}>Ø bis 1. Einstellung</th>
                      <th style={{ textAlign: 'right' }}>Ø bis Ziel</th>
                      <th style={{ textAlign: 'right' }}>Angebote (Fall)</th>
                    </tr></thead>
                    <tbody>
                      {data.hireTimes.sort((a, b) => (b.avg_days_to_first || 0) - (a.avg_days_to_first || 0)).map(g => (
                        <tr key={`${g.brand}_${g.guarantee_period_days}`}>
                          <td>{BRAND_LABEL[g.brand]}</td>
                          <td>{g.guarantee_period_days} Tage</td>
                          <td style={{ textAlign: 'right' }}>{g.avg_days_to_first != null ? `${g.avg_days_to_first} Tage` : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{g.avg_days_to_goal  != null ? `${g.avg_days_to_goal}  Tage` : '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--ink-3)' }}>{g.offers_with_hire} / {g.offers_with_goal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>

          {/* Tabellen */}
          <TableCard title="Offene Rechnungen — sortiert nach Überfälligkeit"
            emptyLabel="Keine offenen Rechnungen.">
            {(data.openInvoices || []).slice(0, 15).map(i => (
              <tr key={i.id}>
                <td style={{ fontSize: 12 }}>{new Date(i.created_at).toLocaleDateString('de-DE')}</td>
                <td>{BRAND_LABEL[i.brand]}</td>
                <td>{i.invoice_type}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(i.amount_gross)}</td>
                <td style={{ textAlign: 'center' }}>
                  {i.overdue_days > 0
                    ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>+ {i.overdue_days} Tage</span>
                    : i.due_date ? <span style={{ color: 'var(--ink-3)' }}>fällig {new Date(i.due_date).toLocaleDateString('de-DE')}</span> : '—'}
                </td>
                <td><a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>PDF</a></td>
              </tr>
            ))}
            <TableHead>
              <th>Erstellt</th><th>Marke</th><th>Typ</th>
              <th style={{ textAlign: 'right' }}>Brutto</th>
              <th style={{ textAlign: 'center' }}>Überfällig</th>
              <th></th>
            </TableHead>
          </TableCard>

          <TableCard title="Frühwarnliste — Abos in Garantiephase (sortiert nach Resttagen)"
            emptyLabel="Keine Abos in Garantiephase.">
            {(data.inGuarantee || []).map(a => (
              <tr key={a.id}>
                <td>{BRAND_LABEL[a.brand]}</td>
                <td><strong>{a.firma || '—'}</strong></td>
                <td style={{ fontSize: 12 }}>{new Date(a.campaign_started_at).toLocaleDateString('de-DE')}</td>
                <td style={{ textAlign: 'center' }}>{a.guarantee_period_days} Tage</td>
                <td style={{ textAlign: 'right' }}>{eur.format(a.monthly_total)}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: a.days_remaining <= 7 ? '#b91c1c' : a.days_remaining <= 14 ? '#a34e00' : '#0068a3' }}>
                  {a.days_remaining} Tage
                </td>
              </tr>
            ))}
            <TableHead>
              <th>Marke</th><th>Firma</th><th>Aktiv seit</th>
              <th style={{ textAlign: 'center' }}>Garantie</th>
              <th style={{ textAlign: 'right' }}>Monatspauschale</th>
              <th style={{ textAlign: 'center' }}>Rest</th>
            </TableHead>
          </TableCard>

          <TableCard title="Servicefreie + pausierte Abos"
            emptyLabel="Alle Abos regulär abrechenbar.">
            {(data.servicefreePaused || []).map(a => (
              <tr key={a.id}>
                <td>{BRAND_LABEL[a.brand]}</td>
                <td><strong>{a.firma || '—'}</strong></td>
                <td>
                  {a.phase === 'paused'
                    ? <span style={{ padding: '2px 8px', borderRadius: 100, background: '#fde0e0', color: '#b91c1c', fontSize: 11, fontWeight: 700 }}>pausiert</span>
                    : <span style={{ padding: '2px 8px', borderRadius: 100, background: '#fff2d4', color: '#a34e00', fontSize: 11, fontWeight: 700 }}>servicefrei</span>}
                </td>
                <td style={{ fontSize: 12 }}>{new Date(a.campaign_started_at).toLocaleDateString('de-DE')}</td>
                <td style={{ textAlign: 'right' }}>{eur.format(a.monthly_total)}</td>
              </tr>
            ))}
            <TableHead>
              <th>Marke</th><th>Firma</th><th>Status</th><th>Aktiv seit</th>
              <th style={{ textAlign: 'right' }}>Monatspauschale (Soll)</th>
            </TableHead>
          </TableCard>

          <TableCard title="Letzte 20 Angebote"
            emptyLabel="Noch keine Angebote.">
            {(data.latestOffers || []).map(o => (
              <tr key={o.id}>
                <td style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('de-DE')}</td>
                <td><strong>{o.customer_snapshot?.company_name || '—'}</strong></td>
                <td>{BRAND_LABEL[o.brand]}</td>
                <td style={{ textAlign: 'right' }}>{eur.format(o.monthly_total)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{eur.format(o.first_month_total)}</td>
                <td>{o.status}</td>
              </tr>
            ))}
            <TableHead>
              <th>Datum</th><th>Kunde</th><th>Marke</th>
              <th style={{ textAlign: 'right' }}>Monatspauschale</th>
              <th style={{ textAlign: 'right' }}>Monat 1</th>
              <th>Status</th>
            </TableHead>
          </TableCard>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, foot }) {
  return (
    <div className="stat-card">
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{sub}</div>}
      {foot && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{foot}</div>}
    </div>
  );
}
function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function TableCard({ title, emptyLabel, children }) {
  // children ist [rows..., <thead>]. Wir splitten praktisch: der <TableHead> als last child.
  const arr = Array.isArray(children) ? children : [children];
  const head = arr.find(c => c?.type === TableHead);
  const rows = arr.filter(c => c?.type !== TableHead);
  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>{emptyLabel}</div>
      ) : (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead><tr>{head?.props?.children}</tr></thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function TableHead({ children }) { return <>{children}</>; }

function sum3(f) {
  const t = f?.talentone || { created: 0, sent: 0, accepted: 0 };
  const n = f?.nowag_wirth || { created: 0, sent: 0, accepted: 0 };
  return `${t.created + n.created} / ${t.sent + n.sent} / ${t.accepted + n.accepted}`;
}
