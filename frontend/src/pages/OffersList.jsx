import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

const STATUS_LABEL = {
  draft:    { label: 'Entwurf',        color: '#5a5955', bg: 'var(--gray-100)' },
  created:  { label: 'Erstellt',       color: '#0068a3', bg: '#e0f5ff' },
  sent:     { label: 'Versandt',       color: '#a34e00', bg: '#fff2d4' },
  accepted: { label: 'Angenommen',     color: '#0a8043', bg: '#e0f5df' },
  declined: { label: 'Abgelehnt',      color: '#b91c1c', bg: '#fde0e0' },
};

const BRAND_LABEL = { talentone: 'TalentOne', nowag_wirth: 'Nowag & Wirth' };

export default function OffersList() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [params] = useSearchParams();
  const newDraftId = params.get('draft');
  const newCreatedId = params.get('created');
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState({}); // { [offerId]: msg }

  async function pdfHref(offerId) {
    // Auth-Header ist Pflicht — Standard-Link würde 401 werfen.
    // Deshalb: PDF holen, Blob-URL öffnen.
    setBusyId(offerId);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/offers/${offerId}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`PDF-Abruf fehlgeschlagen (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Blob-URL nach kurzer Zeit freigeben (das neue Tab hält es selbst)
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setRowError(r => ({ ...r, [offerId]: e.message }));
    } finally { setBusyId(null); }
  }

  async function retryCreateEasybill(offerId) {
    setBusyId(offerId);
    setRowError(r => ({ ...r, [offerId]: '' }));
    try {
      await api(`/offers/${offerId}/create-easybill`, { method: 'POST' });
      load();
    } catch (e) {
      setRowError(r => ({ ...r, [offerId]: e.message }));
    } finally { setBusyId(null); }
  }

  function load() {
    setLoading(true); setError('');
    const q = new URLSearchParams();
    if (brandFilter)  q.set('brand', brandFilter);
    if (statusFilter) q.set('status', statusFilter);
    api(`/offers${q.toString() ? '?' + q.toString() : ''}`)
      .then(res => setOffers(res.offers || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [brandFilter, statusFilter]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Angebote</h1>
          <p className="page-sub">Alle Angebote — Entwürfe und erzeugte easybill-Dokumente.</p>
        </div>
        <Link to="/angebote/neu" className="btn-primary">+ Neues Angebot</Link>
      </div>

      {newDraftId && (
        <div style={{ padding: 14, background: 'color-mix(in srgb, var(--accent) 12%, #fff)', border: '1px solid var(--accent)', borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          ✓ Entwurf gespeichert. Über <strong>„in easybill erzeugen"</strong> in der Tabelle kannst du das Angebot jetzt anlegen.
        </div>
      )}
      {newCreatedId && (
        <div style={{ padding: 14, background: 'color-mix(in srgb, #16a34a 14%, #fff)', border: '1px solid #16a34a', borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          ✓ Angebot in easybill erzeugt. PDF ist über den 📄-Button in der Tabelle abrufbar.
        </div>
      )}

      <section className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group">
          <label>Marke</label>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowag_wirth">Nowag &amp; Wirth</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card empty">Lade…</div>}
      {!loading && offers.length === 0 && (
        <div className="card empty">
          <h2>Noch keine Angebote</h2>
          <p>Über den Button oben rechts das erste Angebot erstellen.</p>
        </div>
      )}

      {!loading && offers.length > 0 && (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Kunde</th>
                <th>Marke</th>
                <th style={{ textAlign: 'right' }}>Setup</th>
                <th style={{ textAlign: 'right' }}>Monatlich</th>
                <th style={{ textAlign: 'right' }}>Monat 1</th>
                <th>Status</th>
                <th>Erstellt von</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {offers.map(o => {
                const st = STATUS_LABEL[o.status] || { label: o.status, color: '#000', bg: 'var(--gray-100)' };
                const snap = o.customer_snapshot || {};
                const hasPdf = !!o.easybill_document_id;
                const isDraft = o.status === 'draft';
                const isBusy = busyId === o.id;
                const err = rowError[o.id];
                const highlighted = newDraftId === o.id || newCreatedId === o.id;
                return (
                  <tr key={o.id} style={{ background: highlighted ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(o.created_at).toLocaleDateString('de-DE')}</td>
                    <td><strong>{snap.company_name || o.easybill_customer_id}</strong></td>
                    <td>{BRAND_LABEL[o.brand]}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(o.setup_total)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(o.monthly_total)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{eur.format(o.first_month_total)}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 100, background: st.bg, color: st.color, fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{o.created_by || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                      {hasPdf && (
                        <button className="btn-ghost btn-sm" title="PDF öffnen" disabled={isBusy}
                          onClick={() => pdfHref(o.id)}>📄 PDF</button>
                      )}
                      {isDraft && (
                        <button className="btn-primary btn-sm" title="Angebot in easybill erzeugen"
                          disabled={isBusy}
                          onClick={() => retryCreateEasybill(o.id)}>
                          {isBusy ? '⏳' : '📤 In easybill erzeugen'}
                        </button>
                      )}
                      {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>⚠ {err}</span>}
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
