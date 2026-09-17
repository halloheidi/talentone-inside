import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';

// Job-Tab „Meta": Zuordnungs-Übersicht (Prüf-Block) + Laufphasen-Zeitleiste +
// Tages-/Wochen-Zahlen + Sprungmarken. Konsumiert GET /meta/projekt/:id/tab.
// Ohne Meta-Verknüpfung: Zuordnungs-Zustand statt Zahlen.

const fmtEur = v => v == null ? '—' : (Number(v)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtEur2 = v => v == null ? '—' : (Number(v)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCtr = v => v == null ? '—' : `${Number(v).toFixed(2)} %`;
const actNr = id => String(id || '').replace(/^act_/, '');

export default function JobMeta() {
  const { job, projekt } = useJob();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  const projektId = projekt?.id || job?.projekt_id || null;

  async function load() {
    if (!projektId) { setLoading(false); return; }
    setLoading(true); setError('');
    try { setData(await api(`/meta/projekt/${projektId}/tab`)); }
    catch (e) { setError(e.body?.error || e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projektId]);

  async function jetztSyncen() {
    setSyncBusy(true); setError('');
    try { await api('/meta/sync', { method: 'POST', body: { backfill: false } }); await load(); }
    catch (e) { setError(e.body?.error || e.message); }
    finally { setSyncBusy(false); }
  }

  // ── Kein Projekt / keine Verknüpfung ──
  if (!projektId) {
    return (
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Meta</h2>
        <p className="pane-hint">Dieser Job hat kein Projekt — ohne Projekt gibt es keine Meta-Zuordnung.
          Zuordnung erfolgt unter <Link to="/admin/meta">/admin/meta</Link>.</p>
      </div>
    );
  }
  if (loading) return <div className="card"><p className="pane-hint">Lade Meta-Daten…</p></div>;
  if (error) return <div className="card"><div className="alert alert-error">{error}</div></div>;
  if (!data) return null;

  const m = data.metrik;
  const einKonto = data.konto?.[0];
  const adsManagerUrl = einKonto
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${actNr(einKonto.konto_id)}`
    : null;

  // ── Ohne Verknüpfung: Zuordnungs-Zustand ──
  if (!data.hat_verknuepfung) {
    return (
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Meta</h2>
        <p className="pane-hint" style={{ marginBottom: 12 }}>
          <strong>Kein Werbekonto/keine Kampagne zugeordnet.</strong> Sobald eine Meta-Kampagne (oder Anzeigengruppe)
          diesem Projekt zugeordnet ist, erscheinen hier die Zahlen.
        </p>
        <Link className="btn-primary btn-sm" to="/admin/meta">Zur Meta-Zuordnung</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ═══ 1. Zuordnungs-Übersicht (Prüf-Block) ═══ */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>Zuordnung</h2>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Letzter Sync: {data.last_sync ? new Date(data.last_sync).toLocaleString('de-DE') : '—'}</span>
        </div>

        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ marginBottom: 6 }}><strong>Werbekonten:</strong>{' '}
            {data.konto.length === 0 ? '—' : data.konto.map(k => (
              <span key={k.konto_id} style={{ marginRight: 10 }}>
                {k.name || k.konto_id} <span style={{ color: 'var(--ink-3)' }}>({k.typ || '?'})</span>
                {k.zahlungsproblem ? <span style={{ color: '#c1272d' }}> · ⚠️ Zahlungsproblem</span> : ''}
              </span>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '4px 8px' }}>Quelle</th><th style={{ padding: '4px 8px' }}>Typ</th>
                  <th style={{ padding: '4px 8px' }}>Meta-Status</th><th style={{ padding: '4px 8px' }}>Start</th>
                  <th style={{ padding: '4px 8px' }}>zuletzt aktiv</th><th style={{ padding: '4px 8px' }}>aktive Tage</th>
                </tr>
              </thead>
              <tbody>
                {data.quellen.length === 0
                  ? <tr><td colSpan={6} style={{ padding: 8, color: 'var(--ink-3)' }}>Keine Kampagnen/Anzeigengruppen zugeordnet.</td></tr>
                  : data.quellen.map(q => (
                    <tr key={q.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '4px 8px' }}>{q.live ? '🟢 ' : ''}{q.name || q.id}</td>
                      <td style={{ padding: '4px 8px' }}>{q.typ === 'adset' ? 'Anzeigengruppe' : 'Kampagne'}</td>
                      <td style={{ padding: '4px 8px' }}>{q.effective_status || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{q.start || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{q.letzter_aktiv || '—'}</td>
                      <td style={{ padding: '4px 8px' }}>{q.aktive_lauftage || 0}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {data.warnungen.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.warnungen.map((w, i) => (
              <div key={i} style={{ background: '#fff7e6', border: '1px solid #ffe0a3', color: '#8a5a00', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>⚠️ {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ 2. Laufphasen-Zeitleiste ═══ */}
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Laufphasen</h2>
        <Timeline quellen={data.quellen} />
      </div>

      {/* ═══ 3. Tages-/Wochen-Zahlen ═══ */}
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Zahlen</h2>
        {m ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 14 }}>
            <Kpi label="Spend Monat" value={fmtEur(m.spend_monat)} />
            <Kpi label="Spend Phase" value={fmtEur(m.spend_phase)} />
            <Kpi label="CTR" value={fmtCtr(m.ctr)} />
            <Kpi label="CPL" value={m.cpl != null ? fmtEur2(m.cpl) : '—'} />
            <Kpi label="Bewerbungen (Phase)" value={m.bewerbungen ?? '—'} />
            <Kpi label="aktive Lauftage" value={m.aktive_lauftage ?? '—'} />
            {m.budget ? <Kpi label="Budget" value={`${m.budget_prozent ?? 0}% von ${fmtEur(m.budget)}`} /> : null}
          </div>
        ) : <p className="pane-hint">Noch keine Kennzahlen (kein Spend erfasst).</p>}

        <DailyBars tage={data.tage} />
      </div>

      {/* ═══ 4. Sprungmarken ═══ */}
      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Sprungmarken</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {adsManagerUrl && <a className="btn-ghost btn-sm" href={adsManagerUrl} target="_blank" rel="noreferrer">↗ Im Ads Manager öffnen</a>}
          <Link className="btn-ghost btn-sm" to="/controlling">↗ Zum Controlling</Link>
          <Link className="btn-ghost btn-sm" to="/admin/meta">Zuordnung ändern</Link>
          <button className="btn-ghost btn-sm" onClick={jetztSyncen} disabled={syncBusy}>{syncBusy ? 'Sync läuft…' : '🔄 Jetzt syncen'}</button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// Horizontale Laufphasen-Balken über eine gemeinsame Zeitachse (min Start … heute).
function Timeline({ quellen }) {
  const phasen = [];
  for (const q of quellen) for (const p of (q.phasen || [])) phasen.push({ ...p, quelle: q.name || q.id, typ: q.typ });
  if (!phasen.length) return <p className="pane-hint">Noch keine Laufphasen (kein Spend erfasst).</p>;
  const heute = new Date().toISOString().slice(0, 10);
  const alleStart = phasen.map(p => p.phase_start).filter(Boolean).sort();
  const min = alleStart[0];
  const t0 = Date.parse(min), t1 = Date.parse(heute);
  const span = Math.max(1, (t1 - t0) / 86400000);
  const pct = d => `${Math.max(0, Math.min(100, ((Date.parse(d) - t0) / 86400000 / span) * 100))}%`;

  // Gruppieren nach Quelle
  const byQuelle = {};
  for (const p of phasen) (byQuelle[p.quelle] ||= { typ: p.typ, phasen: [] }).phasen.push(p);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{min} → heute</div>
      {Object.entries(byQuelle).map(([name, g]) => (
        <div key={name}>
          <div style={{ fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: 'var(--ink-3)' }}>{g.typ === 'adset' ? '▸ Anzeigengruppe · ' : '▸ Kampagne · '}</span>{name}
          </div>
          <div style={{ position: 'relative', height: 22, background: '#f1f0ec', borderRadius: 4 }}>
            {g.phasen.map((p, i) => {
              const ende = p.phase_ende || heute;
              const left = pct(p.phase_start), right = pct(ende);
              const w = `calc(${right} - ${left})`;
              const laufend = !p.phase_ende;
              return (
                <div key={i} title={`${p.phase_start} – ${p.phase_ende || 'laufend'} · ${p.aktive_lauftage} aktive Tage · ${fmtEur(p.spend_summe)}`}
                  style={{ position: 'absolute', top: 3, height: 16, left, width: w, minWidth: 3, borderRadius: 3,
                    background: laufend ? '#1a7f37' : '#7aa5c8', opacity: laufend ? 1 : 0.85 }}>
                  <span style={{ position: 'absolute', left: 4, top: -1, fontSize: 10, color: '#fff', whiteSpace: 'nowrap' }}>{p.aktive_lauftage}T</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// 30-Tage-Balken: Spend (grau) + Bewerbungen (Punkte). Kompakt.
function DailyBars({ tage }) {
  if (!tage?.length) return null;
  const maxSpend = Math.max(1, ...tage.map(t => t.spend || 0));
  const sumSpend = tage.reduce((s, t) => s + (t.spend || 0), 0);
  const sumBew = tage.reduce((s, t) => s + (t.bewerbungen || 0), 0);
  const sumClicks = tage.reduce((s, t) => s + (t.clicks || 0), 0);
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
        Letzte 30 Tage: {fmtEur(sumSpend)} Spend · {sumClicks} Klicks · {sumBew} Bewerbungen
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
        {tage.map(t => (
          <div key={t.datum} title={`${t.datum}: ${fmtEur2(t.spend)} · ${t.clicks} Klicks · ${t.bewerbungen} Bew.`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            {t.bewerbungen > 0 && <div style={{ fontSize: 9, color: '#1a7f37', fontWeight: 700 }}>{t.bewerbungen}</div>}
            <div style={{ width: '100%', background: t.spend > 0 ? '#7aa5c8' : '#e4e2dd', height: `${Math.max(2, (t.spend / maxSpend) * 70)}px`, borderRadius: 2 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>
        <span>{tage[0]?.datum}</span><span>{tage[tage.length - 1]?.datum}</span>
      </div>
    </div>
  );
}
