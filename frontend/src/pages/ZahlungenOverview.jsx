import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

const STATUS_LABEL = {
  entwurf: 'Entwurf',
  offen: '⏳ Offen',
  bezahlt: '✅ Bezahlt',
  ueberfaellig: '⚠ Überfällig',
  storniert: 'Storniert',
};

function fmtEur(cent) {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export default function ZahlungenOverview() {
  const [loading, setLoading] = useState(true);
  const [zahlungen, setZahlungen] = useState([]);
  const [kundeFilter, setKundeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await api('/zahlungen');
      setZahlungen(res.zahlungen || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function refreshAll() {
    // Sequenziell — PayPal hat Rate-Limits
    for (const z of zahlungen) {
      if (z.status === 'offen' || z.status === 'ueberfaellig') {
        try {
          const res = await api(`/zahlungen/${z.id}/refresh`, { method: 'POST', body: {} });
          setZahlungen(prev => prev.map(x => x.id === z.id ? res.zahlung : x));
        } catch { /* skip */ }
      }
    }
  }

  const kundenMap = useMemo(() => {
    const map = new Map();
    for (const z of zahlungen) {
      const k = z.talentone_jobs?.talentone_kunden;
      if (k && !map.has(k.id)) map.set(k.id, k);
    }
    return Array.from(map.values()).sort((a, b) => (a.firmenname || '').localeCompare(b.firmenname || ''));
  }, [zahlungen]);

  const filtered = useMemo(() => {
    let list = zahlungen;
    if (kundeFilter) list = list.filter(z => z.kunde_id === kundeFilter);
    if (statusFilter) list = list.filter(z => z.status === statusFilter);
    return list;
  }, [zahlungen, kundeFilter, statusFilter]);

  // Summen
  const summen = useMemo(() => {
    const offen = zahlungen.filter(z => z.status === 'offen' || z.status === 'ueberfaellig')
      .reduce((s, z) => s + z.betrag_cent, 0);
    const thisMonth = new Date();
    const start = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
    const bezahltMonat = zahlungen
      .filter(z => z.status === 'bezahlt' && z.bezahlt_am && new Date(z.bezahlt_am) >= start)
      .reduce((s, z) => s + z.betrag_cent, 0);
    const ueberfaellig = zahlungen.filter(z => z.status === 'ueberfaellig').length;
    return { offen, bezahltMonat, ueberfaellig };
  }, [zahlungen]);

  return (
    <div className="bew-overview">
      <header className="bew-overview-head">
        <h1>Zahlungen <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: '#fff2d4', color: '#a34e00', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Alt — bitte künftig über Angebots-Abrechnung</span></h1>
        <button className="btn-ghost" onClick={refreshAll}>↻ Alle offenen aktualisieren</button>
      </header>
      <div style={{ padding: 12, background: 'var(--gray-50)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--ink-2)' }}>
        Dies ist die alte PayPal-Direktrechnungs-Ansicht. Neue Rechnungen (Setup + monatlich) laufen über den <strong>Angebots-Konfigurator</strong> → dort werden alle Rechnungen in easybill geführt und PayPal ist optional pro Kunde/Rechnung wählbar.
      </div>

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-num">{fmtEur(summen.offen)}</div><div className="stat-label">Offen gesamt</div></div>
        <div className="stat-card"><div className="stat-num">{fmtEur(summen.bezahltMonat)}</div><div className="stat-label">Bezahlt diesen Monat</div></div>
        <div className="stat-card"><div className="stat-num">{summen.ueberfaellig}</div><div className="stat-label">Überfällige Rechnungen</div></div>
        <div className="stat-card"><div className="stat-num">{zahlungen.length}</div><div className="stat-label">Rechnungen insgesamt</div></div>
      </section>

      <section className="filter-bar">
        <div className="filter-group">
          <label>Kunde</label>
          <select value={kundeFilter} onChange={e => setKundeFilter(e.target.value)}>
            <option value="">Alle Kunden</option>
            {kundenMap.map(k => <option key={k.id} value={k.id}>{k.firmenname}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="offen">Offen</option>
            <option value="ueberfaellig">Überfällig</option>
            <option value="bezahlt">Bezahlt</option>
            <option value="storniert">Storniert</option>
          </select>
        </div>
      </section>

      {loading ? <div className="motiv-sub">Lade…</div>
        : filtered.length === 0 ? <div className="motiv-sub">Keine Zahlungen für den Filter.</div>
        : (
          <div className="bewerbungen-table-scroll">
            <table className="bewerbungen-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Kunde</th>
                  <th>Stelle</th>
                  <th>Beschreibung</th>
                  <th>Netto</th>
                  <th>MwSt</th>
                  <th>Brutto</th>
                  <th>Status</th>
                  <th>easybill</th>
                  <th>Bezahlt</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(z => {
                  const k = z.talentone_jobs?.talentone_kunden;
                  const job = z.talentone_jobs;
                  const netto  = z.betrag_netto  ?? Math.round((z.betrag_cent || 0) / 1.19);
                  const mwst   = z.betrag_mwst   ?? ((z.betrag_cent || 0) - netto);
                  const brutto = z.betrag_brutto ?? z.betrag_cent ?? 0;
                  return (
                    <tr key={z.id}>
                      <td className="td-date">{new Date(z.created_at).toLocaleDateString('de-DE')}</td>
                      <td>{k ? <Link to={`/kunden/${k.id}`}>{k.firmenname}</Link> : '—'}</td>
                      <td>{job && k ? <Link to={`/kunden/${k.id}/jobs/${job.id}/export`}>{job.stelle || '—'}</Link> : '—'}</td>
                      <td style={{ maxWidth: 240 }}>{z.beschreibung || ''}</td>
                      <td>{fmtEur(netto)}</td>
                      <td className="muted">{z.kleinunternehmer ? '—' : fmtEur(mwst)}</td>
                      <td><strong>{fmtEur(brutto)}</strong></td>
                      <td><span className={`zahlung-status zahlung-${z.status}`}>{STATUS_LABEL[z.status] || z.status}</span></td>
                      <td>
                        {z.easybill_invoice_number
                          ? <span title={z.easybill_id}>{z.easybill_invoice_number}</span>
                          : z.easybill_status?.startsWith('fehler')
                            ? <span className="zahlung-status zahlung-ueberfaellig" title={z.easybill_status}>⚠ Fehler</span>
                            : z.status === 'bezahlt'
                              ? <span className="muted">⏳</span>
                              : <span className="muted">—</span>}
                      </td>
                      <td>{z.bezahlt_am ? new Date(z.bezahlt_am).toLocaleDateString('de-DE') : <span className="muted">—</span>}</td>
                      <td>
                        {z.pay_link && <a href={z.pay_link} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">öffnen ↗</a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
