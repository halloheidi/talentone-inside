import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';

const AMPEL = {
  rot:   { emoji: '🔴', label: 'Kritisch',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  gelb:  { emoji: '🟡', label: 'Achtung',    color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  gruen: { emoji: '🟢', label: 'Läuft',      color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  grau:  { emoji: '⚪', label: 'Nicht live', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
};
// Meta-Formatierung (einheitliche Form über alle Seiten)
const fmtEur = (n) => `${(Number(n) || 0).toFixed(2)} €`;
const fmtCtr = (n) => (n == null ? '—' : `${(Number(n) || 0).toFixed(2)} %`);
const fmtCpl = (n) => (n == null ? '—' : fmtEur(n));
const fmtPct = (n) => (n == null ? '—' : `${Math.round(Number(n) || 0)} %`);

// 📣 Meta-Ads (Spend & CPL) — Zeilen aus data.rows MIT meta.hat_meta, sortiert nach spend_monat desc.
function MetaAdsSection({ rows }) {
  const metaRows = rows
    .filter(r => r.meta && r.meta.hat_meta)
    .sort((a, b) => (Number(b.meta.spend_monat) || 0) - (Number(a.meta.spend_monat) || 0));
  const ohneMeta = rows.filter(r => !(r.meta && r.meta.hat_meta)).length;

  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={h2Style}>📣 Meta-Ads (Spend & CPL)</h2>
      {metaRows.length === 0 ? (
        <div style={emptyStyle}>Keine Meta-verknüpften Projekte im Zeitraum.</div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={metaTh}>Kunde</th>
                    <th style={metaTh}>Stelle / Projekt</th>
                    <th style={{ ...metaTh, textAlign: 'right' }}>Spend (Monat)</th>
                    <th style={{ ...metaTh, textAlign: 'right' }}>Spend (Phase)</th>
                    <th style={{ ...metaTh, textAlign: 'right' }}>CTR</th>
                    <th style={{ ...metaTh, textAlign: 'right' }}>CPL</th>
                    <th style={{ ...metaTh, textAlign: 'right' }}>aktive Lauftage</th>
                  </tr>
                </thead>
                <tbody>
                  {metaRows.map(r => {
                    const m = r.meta;
                    return (
                      <tr key={r.projekt_id} style={{ borderTop: '1px solid #f0f0ee' }}>
                        <td style={metaTd}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {m.live && (
                              <span title="live" style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                            )}
                            <strong>{r.kunde}</strong>
                          </span>
                        </td>
                        <td style={{ ...metaTd, color: '#5a5955' }}>{r.stelle}{r.anzahl_stellen > 1 ? ` (+${r.anzahl_stellen - 1})` : ''}</td>
                        <td style={{ ...metaTd, textAlign: 'right', fontWeight: 700 }}>{fmtEur(m.spend_monat)}</td>
                        <td style={{ ...metaTd, textAlign: 'right' }}>{fmtEur(m.spend_phase)}</td>
                        <td style={{ ...metaTd, textAlign: 'right' }}>{fmtCtr(m.ctr)}</td>
                        <td style={{ ...metaTd, textAlign: 'right' }}>{fmtCpl(m.cpl)}</td>
                        <td style={{ ...metaTd, textAlign: 'right' }}>{m.aktive_lauftage == null ? '—' : m.aktive_lauftage}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {ohneMeta > 0 && (
            <div style={{ ...hintStyle, marginTop: 8 }}>
              {ohneMeta} weitere Projekte ohne Meta-Verknüpfung (—)
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Ampel-Punkt je Zeilen-Ampel (rot/gelb/gruen/grau) — Emoji + Tooltip-Label aus AMPEL
const AMPEL_DOT = { rot: '🔴', gelb: '🟡', gruen: '🟢', grau: '⚪' };

// Sortier-Wert je Key (null bleibt null → immer ans Ende). Default = Server-Reihenfolge (kein key).
function cockpitSortVal(r, key) {
  switch (key) {
    case 'cpl':              return r.meta?.cpl ?? null;
    case 'spend_monat':      return r.meta?.spend_monat ?? null;
    case 'budget_prozent':   return r.meta?.budget_prozent ?? null;
    case 'ueberfaellig_tage':return r.cockpit?.ueberfaellig_tage ?? null;
    case 'aktive_lauftage':  return r.meta?.aktive_lauftage ?? null;
    case 'kunde':            return r.kunde ?? null;
    default:                 return null;
  }
}

// Mini-Balken für ein Zahlen-Array (Spend- ODER Bewerbungen-Wochen). Leer → null.
function MiniSpark({ values, color = '#0a0a0a', label }) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const max = Math.max(1, ...values.map(v => Number(v) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 20 }} title={label}>
      {values.map((v, i) => {
        const n = Number(v) || 0;
        return (
          <div key={i} title={`Woche ${i + 1}: ${n}`}
            style={{ width: 4, height: `${Math.max(2, (n / max) * 20)}px`, background: n > 0 ? color : '#e5e7eb', borderRadius: 1 }} />
        );
      })}
    </div>
  );
}

// Automatische Funnel-Mini-Diagnose (robuste Null-Guards)
function funnelDiagnose(m, benchmark) {
  if (!m) return null;
  const ctr = m.ctr;
  const clicks = Number(m.clicks) || 0;
  const bew = m.bewerbungen;
  const cpl = m.cpl;
  if (ctr != null && ctr < 1) return '→ Creative prüfen';
  if (clicks > 50 && bew != null && (bew / clicks) < 0.02) return '→ Funnel prüfen';
  if (cpl != null && benchmark && cpl > 1.3 * benchmark) return '→ Kosten/Zielgruppe';
  return null;
}

// CPL-Trend 7T vs. 28T → Richtungspfeil (fallend = besser = grün)
function cplTrend(m) {
  if (!m || m.cpl_7t == null || m.cpl_28t == null) return null;
  const a = Number(m.cpl_7t) || 0;
  const b = Number(m.cpl_28t) || 0;
  const rel = b ? Math.abs(a - b) / b : 0;
  if (rel < 0.05) return { arrow: '→', color: '#5a5955' };
  if (a < b) return { arrow: '↓', color: '#16a34a' };
  return { arrow: '↑', color: '#dc2626' };
}

// Gründe-Chip (rot rot-hinterlegt, gelb amber)
function GrundChip({ g }) {
  const rot = g?.stufe === 'rot';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
      background: rot ? '#fef2f2' : '#fffbeb', color: rot ? '#b91c1c' : '#b45309',
      border: `1px solid ${rot ? '#fecaca' : '#fde68a'}`,
    }}>{g?.label}</span>
  );
}

function BudgetBar({ prozent }) {
  if (prozent == null) return <span style={{ color: '#9a9994' }}>—</span>;
  const v = Number(prozent) || 0;
  const color = v >= 100 ? '#dc2626' : v >= 80 ? '#d97706' : '#16a34a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 44, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(100, v)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600 }}>{fmtPct(prozent)}</span>
    </div>
  );
}

// Sortierbarer Spaltenkopf
function CockpitTh({ label, sortKey, sort, onSort, align }) {
  const active = sortKey && sort.key === sortKey;
  return (
    <th
      style={{ ...cockpitTh, textAlign: align || 'left', cursor: sortKey ? 'pointer' : 'default', userSelect: 'none' }}
      onClick={sortKey ? () => onSort(sortKey) : undefined}
      title={sortKey ? 'Klick zum Sortieren' : undefined}
    >
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

// 🎛️ Kunden-Cockpit — Aggregat-Kopf + einheitliches Regelwerk (rot-zuerst vom Server)
function KundenCockpit({ meta, rows, onReload }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState({ key: null, dir: 'desc' }); // key null = Server-Reihenfolge
  const [filter, setFilter] = useState({ ueberfaellig: false, zahlung: false, nw: false });
  const [expandedId, setExpandedId] = useState(null);           // Kampagnen-Aufklapp
  const [edit, setEdit] = useState(null);                       // { id, field:'budget'|'wk' }
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);

  const onSort = useCallback((key) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'kunde' ? 'asc' : 'desc' });
  }, []);

  const visible = useMemo(() => {
    let list = (rows || []);
    if (filter.ueberfaellig) list = list.filter(r => r.cockpit?.ueberfaellig);
    if (filter.zahlung)      list = list.filter(r => r.cockpit?.status === 'zahlungsproblem');
    if (filter.nw)           list = list.filter(r => r.cockpit?.werbekosten === 'N&W');
    const { key, dir } = sort;
    if (!key) return list;   // Default: Server-Reihenfolge (rot zuerst) — NICHT umsortieren
    return [...list].sort((a, b) => {
      const va = cockpitSortVal(a, key);
      const vb = cockpitSortVal(b, key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // null immer ans Ende
      if (vb == null) return -1;
      let cmp;
      if (typeof va === 'string') cmp = va.localeCompare(String(vb), 'de');
      else cmp = (Number(va) || 0) - (Number(vb) || 0);
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, filter, sort]);

  function go(r) {
    if (r.primary_job_id && r.kunde_id) navigate(`/kunden/${r.kunde_id}/jobs/${r.primary_job_id}/stelle`);
    else navigate(`/projekte?highlight=${r.projekt_id}`);
  }

  const stop = (e) => e.stopPropagation();

  async function saveBudget(r) {
    setSaving(true);
    try {
      const num = editVal === '' ? null : Number(editVal);
      const val = (num != null && Number.isFinite(num)) ? num : null;
      await api('/projekte/' + r.projekt_id, { method: 'PATCH', body: { monatsbudget_euro: val } });
      setEdit(null); setEditVal('');
      onReload && onReload();
    } catch (e) { alert(e.message || 'Budget speichern fehlgeschlagen'); }
    finally { setSaving(false); }
  }

  async function saveWk(r, wert) {   // wert: 'Kunde' | 'N&W'
    if (!wert) return;
    setSaving(true);
    try {
      await api('/projekte/' + r.projekt_id, { method: 'PATCH', body: { werbekosten: wert } });
      setEdit(null);
      onReload && onReload();
    } catch (e) { alert(e.message || 'Werbekosten speichern fehlgeschlagen'); }
    finally { setSaving(false); }
  }

  const ueberfaelligN = Number(meta.ueberfaellig) || 0;
  const zahlungN = Number(meta.zahlungsproblem) || 0;

  // Gewerk-Benchmark-Leiste (nur Gewerke mit cpl != null)
  const gewerkBench = Object.entries(meta.benchmark?.gewerk || {})
    .filter(([, v]) => v && v.cpl != null)
    .map(([g, v]) => ({ gewerk: g, cpl: v.cpl, n: v.n }));

  const COLS = 9;

  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={h2Style}>🎛️ Kunden-Cockpit</h2>

      {/* (a) Aggregat-Kopfzeile */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Spend lfd. Monat" value={fmtEur(meta.spend_monat_gesamt)} />
        <Stat label="Ø CPL (global)" value={fmtCpl(meta.cpl_schnitt)} />
        <Stat label="Meta-Projekte" value={Number(meta.anzahl_meta) || 0} />
        <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', minWidth: 120 }}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: '#166534' }}>{Number(meta.live) || 0}</strong> live{' · '}
            <strong style={{ color: ueberfaelligN > 0 ? '#dc2626' : '#0a0a0a' }}>{ueberfaelligN} überfällig</strong>{' · '}
            <strong>{Number(meta.pausiert) || 0}</strong> pausiert{' · '}
            <strong style={{ color: zahlungN > 0 ? '#dc2626' : '#0a0a0a' }}>{zahlungN} Zahlungsproblem</strong>
          </div>
        </div>
      </div>

      {/* (a2) Gewerk-Benchmark-Leiste */}
      {gewerkBench.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px', background: '#fafafa', border: '1px solid #ececea', borderRadius: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: '#5a5955' }}>Gewerk-Ø CPL:</span>
          {gewerkBench.map((b, i) => (
            <span key={b.gewerk} style={{ color: '#0a0a0a' }}>
              {i > 0 && <span style={{ color: '#c7c7c2' }}>· </span>}
              <strong>{b.gewerk}</strong> {fmtEur(b.cpl)}{b.n ? <span style={{ color: '#9a9994' }}> ({b.n})</span> : ''}
            </span>
          ))}
          {meta.cpl_schnitt != null && (
            <span style={{ color: '#9a9994', marginLeft: 'auto' }}>global Ø {fmtEur(meta.cpl_schnitt)}{meta.benchmark?.global_n ? ` (${meta.benchmark.global_n})` : ''}</span>
          )}
        </div>
      )}

      {/* Filter + Schnell-Sort */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" style={segBtn(filter.ueberfaellig)} onClick={() => setFilter(f => ({ ...f, ueberfaellig: !f.ueberfaellig }))}>⏰ nur überfällig</button>
        <button type="button" style={segBtn(filter.zahlung)} onClick={() => setFilter(f => ({ ...f, zahlung: !f.zahlung }))}>🔴 nur Zahlungsprobleme</button>
        <button type="button" style={segBtn(filter.nw)} onClick={() => setFilter(f => ({ ...f, nw: !f.nw }))}>nur N&amp;W-Werbekosten</button>
        <button type="button" style={segBtn(sort.key === 'cpl')} onClick={() => onSort('cpl')}>↕ nach CPL</button>
        {sort.key && <button type="button" style={segBtn(false)} onClick={() => setSort({ key: null, dir: 'desc' })}>↺ Server-Reihenfolge</button>}
      </div>

      {visible.length === 0 ? (
        <div style={emptyStyle}>Keine Projekte im aktuellen Filter.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <CockpitTh label="" />
                  <CockpitTh label="Kunde / Stelle" sortKey="kunde" sort={sort} onSort={onSort} />
                  <CockpitTh label="Zeit / Phase" sortKey="ueberfaellig_tage" sort={sort} onSort={onSort} />
                  <CockpitTh label="Funnel-Kette" />
                  <CockpitTh label="CPL & Trend" sortKey="cpl" sort={sort} onSort={onSort} align="right" />
                  <CockpitTh label="Budget %" sortKey="budget_prozent" sort={sort} onSort={onSort} />
                  <CockpitTh label="Garantie-Rest" align="right" />
                  <CockpitTh label="Werbekosten" />
                  <CockpitTh label="Verlauf (8W)" />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const c = r.cockpit || {};
                  const m = r.meta || null;
                  const ampel = r.ampel || 'grau';
                  const gruende = Array.isArray(r.ampel_gruende) ? r.ampel_gruende : [];
                  const nKamp = Number(m?.anzahl_kampagnen) || 0;
                  const kampagnen = Array.isArray(m?.kampagnen) ? m.kampagnen : [];
                  const isOpen = expandedId === r.projekt_id;
                  const clicks = Number(m?.clicks) || 0;
                  const conv = (m && m.bewerbungen != null && clicks > 0) ? fmtPct((m.bewerbungen / clicks) * 100) : '—';
                  const diag = funnelDiagnose(m, r.gewerk_benchmark);
                  const trend = cplTrend(m);
                  const budgetGepflegt = !!(m && m.budget != null);
                  const editingBudget = edit?.id === r.projekt_id && edit.field === 'budget';
                  const editingWk = edit?.id === r.projekt_id && edit.field === 'wk';
                  return (
                    <Fragment key={r.projekt_id}>
                      <tr style={{ borderTop: '1px solid #f0f0ee', cursor: 'pointer' }}
                        onClick={() => go(r)} title="Zur Stelle / zum Projekt">
                        {/* Toggle + Ampel-Punkt */}
                        <td style={{ ...cockpitTd, textAlign: 'center', paddingRight: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {nKamp >= 2 ? (
                              <button type="button" title="Kampagnen anzeigen"
                                onClick={(e) => { stop(e); setExpandedId(isOpen ? null : r.projekt_id); }}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#5a5955', padding: 0, width: 14, lineHeight: 1 }}>
                                {isOpen ? '▾' : '▸'}
                              </button>
                            ) : <span style={{ width: 14, display: 'inline-block' }} />}
                            <span title={(AMPEL[ampel] || AMPEL.grau).label} style={{ fontSize: 15 }}>{AMPEL_DOT[ampel] || AMPEL_DOT.grau}</span>
                          </div>
                        </td>
                        {/* Kunde / Stelle + Kampagnen-Chip + Gründe-Chips */}
                        <td style={cockpitTd}>
                          <div style={{ fontWeight: 700 }}>{r.kunde}</div>
                          <div style={{ fontSize: 12, color: '#5a5955', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{r.stelle}{r.anzahl_stellen > 1 ? ` (+${r.anzahl_stellen - 1})` : ''}</span>
                            {nKamp >= 2 && (
                              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', whiteSpace: 'nowrap' }}>⚡ {nKamp} Kampagnen</span>
                            )}
                          </div>
                          {gruende.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                              {gruende.map((g, i) => <GrundChip key={g.code || i} g={g} />)}
                            </div>
                          )}
                        </td>
                        {/* Zeit / Phase */}
                        <td style={cockpitTd}>
                          {c.ueberfaellig ? (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>
                              ⏰ überfällig seit {c.ueberfaellig_tage} T{c.soll ? ` (geplant ${c.soll})` : ''}
                            </span>
                          ) : (
                            <div style={{ lineHeight: 1.4 }}>
                              <div>aktuelle Phase seit <strong>{m?.aktive_lauftage ?? '—'}</strong> aktiven T</div>
                              <div style={{ fontSize: 11, color: '#9a9994' }}>Projekt gesamt {m?.aktive_lauftage_gesamt ?? '—'} aktive T</div>
                            </div>
                          )}
                        </td>
                        {/* Funnel-Kette */}
                        <td style={cockpitTd}>
                          {m ? (
                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                              <div><strong>{fmtEur(m.spend_monat)}</strong> <span style={{ color: '#9a9994' }}>Spend</span></div>
                              <div>{m.clicks ?? '—'} Klicks <span style={{ color: '#9a9994' }}>· CTR {fmtCtr(m.ctr)}</span></div>
                              <div>{m.bewerbungen ?? '—'} Bew. <span style={{ color: '#9a9994' }}>· Konv. {conv}</span></div>
                              <div><span style={{ color: '#9a9994' }}>o. KO</span> {m.ohne_ko ?? '—'}</div>
                              {diag && <div style={{ color: '#b45309', fontWeight: 600 }}>{diag}</div>}
                            </div>
                          ) : '—'}
                        </td>
                        {/* CPL & Trend + Gewerk-Benchmark */}
                        <td style={{ ...cockpitTd, textAlign: 'right' }}>
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                            <div style={{ fontWeight: 700 }}>
                              {m ? fmtCpl(m.cpl) : '—'}
                              {r.gewerk_benchmark != null && <span style={{ color: '#9a9994', fontWeight: 400 }}> · Ø {fmtEur(r.gewerk_benchmark)}</span>}
                            </div>
                            {trend && (
                              <div style={{ fontSize: 11, color: '#5a5955' }}>
                                <span style={{ color: trend.color, fontWeight: 700 }}>{trend.arrow}</span> 7T {fmtCpl(m.cpl_7t)} · 28T {fmtCpl(m.cpl_28t)}
                              </div>
                            )}
                          </div>
                        </td>
                        {/* Budget % (inline pflegbar) */}
                        <td style={cockpitTd} onClick={editingBudget ? stop : undefined}>
                          {budgetGepflegt ? (
                            <BudgetBar prozent={m.budget_prozent} />
                          ) : editingBudget ? (
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={stop}>
                              <input type="number" autoFocus value={editVal} placeholder="€/Monat" style={inlineInput}
                                onClick={stop}
                                onChange={(e) => setEditVal(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveBudget(r); if (e.key === 'Escape') { setEdit(null); setEditVal(''); } }} />
                              <button type="button" style={inlineBtn} disabled={saving} onClick={(e) => { stop(e); saveBudget(r); }}>✓</button>
                              <button type="button" style={inlineBtnGhost} onClick={(e) => { stop(e); setEdit(null); setEditVal(''); }}>✕</button>
                            </span>
                          ) : (
                            <a role="button" style={setzLink} onClick={(e) => { stop(e); setEdit({ id: r.projekt_id, field: 'budget' }); setEditVal(''); }}>+ Budget</a>
                          )}
                        </td>
                        {/* Garantie-Rest */}
                        <td style={{ ...cockpitTd, textAlign: 'right' }}>
                          {c.garantie_rest == null
                            ? '—'
                            : <span style={c.garantie_laeuft_aus ? { color: '#dc2626', fontWeight: 700 } : undefined}>{c.garantie_rest} T</span>}
                        </td>
                        {/* Werbekosten (inline pflegbar) */}
                        <td style={cockpitTd} onClick={editingWk ? stop : undefined}>
                          {c.werbekosten ? (
                            c.werbekosten
                          ) : editingWk ? (
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={stop}>
                              <select autoFocus defaultValue="" style={inlineInput} disabled={saving}
                                onClick={stop}
                                onChange={(e) => saveWk(r, e.target.value)}>
                                <option value="" disabled>wählen…</option>
                                <option value="Kunde">K (Kunde)</option>
                                <option value="N&W">N&W</option>
                              </select>
                              <button type="button" style={inlineBtnGhost} onClick={(e) => { stop(e); setEdit(null); }}>✕</button>
                            </span>
                          ) : (
                            <a role="button" style={setzLink} onClick={(e) => { stop(e); setEdit({ id: r.projekt_id, field: 'wk' }); }}>+ Werbekosten</a>
                          )}
                        </td>
                        {/* Verlauf: Spend (grau) + Bewerbungen (dunkel) */}
                        <td style={cockpitTd}>
                          {m && (Array.isArray(m.spend_wochen) || Array.isArray(m.bewerbungen_wochen)) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <MiniSpark values={m.spend_wochen} color="#c7c7c2" label="Spend / Woche (8W)" />
                              <MiniSpark values={m.bewerbungen_wochen} color="#0a0a0a" label="Bewerbungen / Woche (8W)" />
                            </div>
                          ) : <span style={{ color: '#9a9994' }}>—</span>}
                        </td>
                      </tr>
                      {isOpen && kampagnen.length > 0 && (
                        <tr style={{ background: '#fcfcfb' }}>
                          <td />
                          <td style={{ ...cockpitTd, whiteSpace: 'normal' }} colSpan={COLS - 1}>
                            <div style={{ display: 'grid', gap: 6 }}>
                              {kampagnen.map((k, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                                  <span title={k.live ? 'live' : 'nicht live'} style={{ width: 8, height: 8, borderRadius: '50%', background: k.live ? '#16a34a' : '#d8d8d4', flexShrink: 0 }} />
                                  <strong style={{ minWidth: 160 }}>{k.name || 'Kampagne'}</strong>
                                  <span style={{ color: '#5a5955' }}>Start {k.phase_start || '—'}</span>
                                  <span>{fmtEur(k.spend)}</span>
                                  <span style={{ color: '#5a5955' }}>{k.effective_status || '—'}</span>
                                  <span style={{ color: '#5a5955' }}>{k.aktive_lauftage ?? '—'} aktive T</span>
                                </div>
                              ))}
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
        </div>
      )}
    </section>
  );
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
      .then(res => { if (!cancelled) setData(res); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, days, from]);

  // Overview leise neu laden (nach Inline-Pflege im Cockpit)
  const reloadOverview = useCallback(() => {
    if (days === 'custom' && !from) return;
    api(`/controlling-ops/overview?${query}`)
      .then(res => setData(res))
      .catch(err => setError(err.message));
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

  // Drilldown bei Bedarf laden (Chart-Kunde gewählt)
  useEffect(() => { if (chartKunde) loadDrill(chartKunde); }, [chartKunde, loadDrill]);

  // Reset Drill-Cache bei Filterwechsel (Zeitraum ändert die Zahlen)
  useEffect(() => { setDrill({}); }, [query]);

  const perTagChart = chartKunde
    ? (drill[chartKunde]?.charts?.per_tag || [])
    : (data?.charts?.per_tag || []);

  return (
    <div style={{ padding: '24px 32px' }}>
      <PageContainer wide />
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
            {data.totals.zufriedenheit_schnitt != null && (
              <Stat label={`⭐ Ø Zufriedenheit (${data.totals.zufriedenheit_anzahl})`} value={`${data.totals.zufriedenheit_schnitt} / 5`}
                color={data.totals.zufriedenheit_schnitt <= 2 ? AMPEL.rot.color : data.totals.zufriedenheit_schnitt < 4 ? AMPEL.gelb.color : AMPEL.gruen.color} />
            )}
          </div>

          {/* ── 🎛️ Kunden-Cockpit (prominent ganz oben, einheitliches Regelwerk) ── */}
          <KundenCockpit meta={data.totals.meta || {}} rows={data.rows} onReload={reloadOverview} />

          {/* ── 📣 Meta-Ads (Spend & CPL) ── */}
          <MetaAdsSection rows={data.rows} />

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

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: '#5a5955', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' };
const inputStyle = { padding: '7px 10px', border: '1px solid #d8d8d4', borderRadius: 8, fontSize: 13, background: '#fff' };
const h2Style = { fontSize: 15, fontWeight: 700, margin: '0 0 10px' };
const hintStyle = { fontSize: 12, color: '#9a9994', margin: '0 0 10px' };
const emptyStyle = { padding: 30, background: '#fff', border: '1px solid #ececea', borderRadius: 10, textAlign: 'center', color: '#9a9994' };
const metaTh ={ textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#5a5955', padding: '10px 14px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', background: '#fafafa' };
const metaTd = { padding: '10px 14px', whiteSpace: 'nowrap', color: '#0a0a0a' };
const cockpitTh = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#5a5955', padding: '9px 12px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', background: '#fafafa' };
const cockpitTd = { padding: '9px 12px', whiteSpace: 'nowrap', color: '#0a0a0a', verticalAlign: 'top' };
// Inline-Datenpflege (Setz-Link + Mini-Eingaben)
const setzLink = { fontSize: 12, fontWeight: 600, color: '#0068a3', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' };
const inlineInput = { padding: '3px 6px', border: '1px solid #d8d8d4', borderRadius: 6, fontSize: 12, width: 78, background: '#fff' };
const inlineBtn = { padding: '3px 7px', border: '1px solid #0a0a0a', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: '#0a0a0a', color: '#fff', fontWeight: 700 };
const inlineBtnGhost = { padding: '3px 7px', border: '1px solid #d8d8d4', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: '#fff', color: '#5a5955' };

function segBtn(active) {
  return {
    padding: '7px 12px', border: `1px solid ${active ? '#0a0a0a' : '#d8d8d4'}`,
    borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: active ? 700 : 400,
    background: active ? '#0a0a0a' : '#fff', color: active ? '#fff' : '#0a0a0a',
  };
}
