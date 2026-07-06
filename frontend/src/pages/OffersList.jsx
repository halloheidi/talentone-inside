import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import Modal from '../components/Modal.jsx';

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
  const [sendModal, setSendModal] = useState(null); // { offerId, subject, body, to, firma, already_sent }

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

  async function openSendModal(offer) {
    setBusyId(offer.id);
    setRowError(r => ({ ...r, [offer.id]: '' }));
    try {
      const preview = await api(`/offers/${offer.id}/email-preview`);
      setSendModal({ offerId: offer.id, ...preview });
    } catch (e) { setRowError(r => ({ ...r, [offer.id]: e.message })); }
    finally { setBusyId(null); }
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
                    <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
                      {hasPdf && (o.status === 'created' || o.status === 'sent') && (
                        <button
                          className={o.status === 'sent' ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
                          title={o.status === 'sent' ? `Bereits versandt an ${o.sent_to || 'Kunde'} — erneut senden` : 'Angebot per E-Mail an Kunden senden'}
                          disabled={isBusy}
                          onClick={() => openSendModal(o)}
                        >{isBusy ? '⏳' : (o.status === 'sent' ? '✉︎ Erneut senden' : '✉︎ An Kunden senden')}</button>
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

      <SendOfferModal
        preview={sendModal}
        onClose={() => setSendModal(null)}
        onSent={() => { setSendModal(null); load(); }}
      />
    </div>
  );
}

function SendOfferModal({ preview, onClose, onSent }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!preview) return;
    setTo(preview.to || '');
    setSubject(preview.subject || '');
    setBody(preview.body || '');
    setErr('');
  }, [preview?.offerId]);

  if (!preview) return null;

  async function send() {
    setErr('');
    if (!to || !/.+@.+\..+/.test(to)) return setErr('Empfänger-E-Mail ungültig.');
    if (!subject.trim())               return setErr('Betreff fehlt.');
    if (!body.trim())                  return setErr('Text fehlt.');
    setBusy(true);
    try {
      await api(`/offers/${preview.offerId}/send-email`, {
        method: 'POST',
        body: { to, subject, body },
      });
      onSent();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title={`Angebot an ${preview.firma || 'Kunden'} senden`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={send} disabled={busy}>
          {busy ? 'Sende…' : '📤 Jetzt senden'}
        </button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Absender richtet sich nach der Marke des Angebots. Reply-To geht an info@nowagwirth.com. Das easybill-PDF wird automatisch als Anhang angefügt.
      </p>

      {preview.already_sent && (
        <div style={{ padding: 10, background: '#fff8d4', border: '1px solid #f0d878', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          Dieses Angebot wurde bereits versandt an <strong>{preview.sent_to}</strong> am {new Date(preview.sent_at).toLocaleString('de-DE')} — erneuter Versand aktualisiert den Empfänger.
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.02em' }}>Empfänger</span>
          <input type="email" value={to} onChange={e => setTo(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.02em' }}>Betreff</span>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.02em' }}>Nachricht</span>
          <textarea rows={14} value={body} onChange={e => setBody(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, lineHeight: 1.55, fontFamily: 'inherit' }} />
        </label>
      </div>
    </Modal>
  );
}
