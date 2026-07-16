// Rechnungs-Ansicht eines Kunden — genutzt auf der Kunden-Detailseite (voll)
// und im Export-Tab eines Jobs (compact). Eine Komponente, ein Verhalten.
//
// Props:
//   kunde, invoices, busy, syncing
//   onSync, onCreateAdBudget, onSendInvoice(invoice)
//   compact — kompaktere Darstellung für den Export-Tab

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

const INVOICE_TYPE_LABEL = {
  setup:              'Setup',
  monthly_service:    'Monatlich',
  monthly_combined:   'Monatlich (kombiniert)',
  ad_budget:          'Werbebudget',
};
export function invoiceTypeLabel(inv) {
  const base = INVOICE_TYPE_LABEL[inv.invoice_type] || inv.invoice_type;
  return inv.source === 'standalone' ? `${base} — freistehend` : base;
}
export const INVOICE_STATUS_META = {
  draft:           { label: 'Draft',      bg: '#eeece7', color: '#5a5955' },
  sent:            { label: 'Offen',      bg: '#fff2d4', color: '#a34e00' },
  paid:            { label: 'Bezahlt',    bg: '#e0f5df', color: '#0a8043' },
  partially_paid:  { label: 'Teilzahlung', bg: '#fff2d4', color: '#a34e00' },
  overdue:         { label: 'Überfällig', bg: '#fde0e0', color: '#b91c1c' },
  cancelled:       { label: 'Storniert',  bg: '#eeece7', color: '#5a5955' },
};

export default function InvoicesSection({
  kunde, invoices, busy, syncing, onSync, onCreateAdBudget, onSendInvoice, compact = false,
}) {
  const openTotal = useMemo(() => invoices
    .filter(i => ['sent', 'partially_paid', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (Number(i.amount_gross) || 0), 0), [invoices]);

  return (
    <>
      <div className="section-head">
        <div>
          {compact ? (
            <div className="zahlungen-title">💳 Rechnungen{kunde?.firmenname ? ` — ${kunde.firmenname}` : ''}</div>
          ) : (
            <h2 className="section-title">Rechnungen</h2>
          )}
          <p className={compact ? 'zahlungen-hint' : 'section-sub'}>
            {compact
              ? 'Alle Rechnungen des verknüpften Kunden — Setup, Monatlich, Werbebudget und freistehende Werbekosten-Rechnungen.'
              : 'Alle Rechnungen dieses Kunden — Setup, Monatlich, Werbebudget und freistehende Werbekosten-Rechnungen.'}
          </p>
        </div>
        <button className={compact ? 'btn-primary btn-sm' : 'btn-primary'} onClick={onCreateAdBudget}>
          {!compact && <Icon name="plus" />} {compact ? '+ Werbekosten-Rechnung' : 'Werbekosten-Rechnung erstellen'}
        </button>
      </div>

      {busy && invoices.length === 0 ? (
        compact
          ? <div className="muted" style={{ padding: '12px 0' }}>Lade Rechnungen…</div>
          : <div className="card empty"><h2>Lade Rechnungen…</h2></div>
      ) : invoices.length === 0 ? (
        compact ? (
          <div className="muted" style={{ padding: '12px 0' }}>
            Noch keine Rechnungen für diesen Kunden.
          </div>
        ) : (
          <div className="card empty">
            <h2>Noch keine Rechnungen</h2>
            <p>Sobald ein Angebot angenommen ist oder eine freistehende Werbekosten-Rechnung erstellt wird, taucht sie hier auf.</p>
          </div>
        )
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, width: '100%' }}>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Typ</th>
                  <th style={{ textAlign: 'right' }}>Brutto</th>
                  <th>Status</th>
                  <th>Zahlung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const stMeta = INVOICE_STATUS_META[inv.status] || { label: inv.status, bg: 'var(--gray-100)', color: 'var(--ink)' };
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(inv.created_at).toLocaleDateString('de-DE')}
                      </td>
                      <td>
                        <strong>{invoiceTypeLabel(inv)}</strong>
                        {inv.label && <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{inv.label}</div>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>
                        {eur.format(Number(inv.amount_gross) || 0)}
                      </td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 100, background: stMeta.bg, color: stMeta.color, fontSize: 11, fontWeight: 700 }}>
                          {stMeta.label}
                        </span>
                        {inv.status === 'paid' && inv.paid_at && (
                          <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>{new Date(inv.paid_at).toLocaleDateString('de-DE')}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {inv.payment_method === 'paypal' ? '💳 PayPal' : '🏦 Überweisung'}
                        {inv.paypal_pay_link && inv.status !== 'paid' && (
                          <>
                            {' '}
                            <button className="btn-ghost btn-sm" title="PayPal-Zahllink kopieren"
                              onClick={async () => { try { await navigator.clipboard.writeText(inv.paypal_pay_link); } catch { /* noop */ } }}>
                              Pay-Link
                            </button>
                          </>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {inv.easybill_document_id && (
                          <>
                            <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">📄 PDF</a>{' '}
                            <button className="btn-ghost btn-sm" onClick={() => onSendInvoice(inv)} title="Rechnung per E-Mail versenden">
                              ✉︎ Mail
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontSize: 12, color: 'var(--ink-3)' }}>Offene Forderungen gesamt</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>{eur.format(openTotal)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>
        <span>Zahlungsstatus wird alle 15 Minuten mit easybill abgeglichen.</span>
        <button className="btn-ghost btn-sm" onClick={onSync} disabled={syncing}>
          {syncing ? '⏳ Gleiche ab…' : '↻ Jetzt abgleichen'}
        </button>
      </div>
    </>
  );
}

export function SendInvoiceMailModal({ invoice, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!invoice) { setPreview(null); return; }
    setErr('');
    api(`/invoices/${invoice.id}/email-preview`)
      .then(p => {
        setPreview(p);
        setTo(p.to || '');
        setSubject(p.subject || '');
        setBody(p.body || '');
      })
      .catch(e => setErr(e.message));
  }, [invoice?.id]);

  if (!invoice) return null;

  async function send() {
    setErr('');
    if (!to || !/.+@.+\..+/.test(to)) return setErr('Empfänger-E-Mail ungültig.');
    if (!subject.trim())               return setErr('Betreff fehlt.');
    if (!body.trim())                  return setErr('Text fehlt.');
    setBusy(true);
    try {
      await api(`/invoices/${invoice.id}/send-email`, { method: 'POST', body: { to, subject, body } });
      onSent();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title={`Rechnung an ${preview?.firma || 'Kunden'} senden`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={send} disabled={busy || !preview}>
          {busy ? 'Sende…' : '📄 Jetzt senden'}
        </button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Absender richtet sich nach der Marke der Rechnung. Reply-To geht an info@nowagwirth.de. Die Rechnung als PDF wird automatisch aus easybill angefügt.
      </p>

      {preview?.already_sent && (
        <div style={{ padding: 10, background: '#fff8d4', border: '1px solid #f0d878', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          Diese Rechnung wurde bereits versandt an <strong>{preview.sent_to}</strong> am {new Date(preview.sent_at).toLocaleString('de-DE')} — erneuter Versand aktualisiert den Empfänger.
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {!preview && !err && <div>Lade Vorschau…</div>}

      {preview && (
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
            <textarea rows={10} value={body} onChange={e => setBody(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, lineHeight: 1.55, fontFamily: 'inherit' }} />
          </label>
        </div>
      )}
    </Modal>
  );
}
