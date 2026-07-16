// Einheitliches Modal für freistehende Werbekosten-Rechnungen (easybill +
// optionaler PayPal-Zahllink). Wird von der Kunden-Detailseite UND vom
// Export-Tab eines Jobs genutzt — es gibt bewusst nur diesen einen Flow.
//
// Props:
//   open, kunde, onClose, onCreated(invoice)
//   defaultLabel — Vorbelegung der Positions-Bezeichnung (z. B. "Werbebudget Monteur")

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from './Modal.jsx';
import AnredeAbfrage from './AnredeAbfrage.jsx';
import { anredeOffen } from '../lib/anrede.js';
import { AdBudgetChips } from '../pages/OfferWizard.jsx';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export default function StandaloneAdBudgetModal({ open, kunde: kundeProp, onClose, onCreated, defaultLabel = '' }) {
  // Lokale Kopie, damit eine hier gesetzte Anrede sofort greift (der Aufrufer
  // lädt den Kunden ggf. erst später neu).
  const [kunde, setKunde] = useState(kundeProp);
  useEffect(() => { setKunde(kundeProp); }, [kundeProp]);
  const [easybillQuery, setEasybillQuery] = useState('');
  const [easybillResults, setEasybillResults] = useState([]);
  const [easybillCustomer, setEasybillCustomer] = useState(null);
  const [brand, setBrand] = useState('talentone');
  const [amount, setAmount] = useState('800');
  const [label, setLabel] = useState('');
  const [usePaypal, setUsePaypal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    // Suche mit Firmenname vorbelegen
    setEasybillQuery(kunde?.firmenname || '');
    setEasybillCustomer(null);
    setBrand(kunde?.agentur === 'nowagwirth' ? 'nowag_wirth' : 'talentone');
    setUsePaypal(!!kunde?.paypal_enabled);
    setAmount('800');
    setLabel(defaultLabel || '');
    setErr('');
  }, [open, kunde?.id, defaultLabel]);

  useEffect(() => {
    if (!open || easybillCustomer) return;
    const t = setTimeout(() => {
      api(`/easybill-customers/search?q=${encodeURIComponent(easybillQuery)}&limit=10`)
        .then(res => setEasybillResults(res.customers || []))
        .catch(() => setEasybillResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [open, easybillQuery, easybillCustomer]);

  if (!open) return null;

  const num = Number(String(amount ?? '').trim());
  const amountValid = Number.isFinite(num) && num >= 300 && num <= 5000 && num % 50 === 0;
  const brutto = amountValid ? num * 1.19 : 0;

  async function create() {
    setErr('');
    if (!easybillCustomer) return setErr('easybill-Kunde auswählen.');
    if (!amountValid)      return setErr('Betrag ungültig (300–5.000 €, 50-€-Schritte).');
    if (!label.trim())     return setErr('Bezeichnung ist Pflicht (z. B. „Juli 2026" oder Kampagnenname).');
    setBusy(true);
    try {
      const res = await api('/invoices/standalone-ad-budget', {
        method: 'POST',
        body: {
          easybill_customer_id: String(easybillCustomer.easybill_id),
          brand,
          amount_net:   num,
          period_label: label.trim(),
          use_paypal:   usePaypal,
          customer_id:  kunde?.id || null,
        },
      });
      onCreated(res.invoice);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Werbekosten-Rechnung — ${kunde?.firmenname || ''}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={create}
          disabled={busy || !easybillCustomer || !amountValid || !label.trim() || anredeOffen(kunde)}>
          {busy ? 'Erzeuge…' : `📄 Rechnung erzeugen (${eur.format(brutto)} brutto)`}
        </button>
      </>}
    >
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      <AnredeAbfrage kunde={kunde} onSaved={setKunde} />

      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.02em' }}>easybill-Kunde</label>
          {easybillCustomer ? (
            <div style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{easybillCustomer.company_name}</strong>
                <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>easybill-ID {easybillCustomer.easybill_id}{easybillCustomer.email ? ` · ${easybillCustomer.email}` : ''}</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setEasybillCustomer(null)}>Anderen wählen</button>
            </div>
          ) : (
            <>
              <input type="text" value={easybillQuery} onChange={e => setEasybillQuery(e.target.value)}
                placeholder="Firma oder E-Mail suchen…"
                style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, marginTop: 4, width: '100%' }} />
              {easybillResults.length > 0 && (
                <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                  {easybillResults.map(c => (
                    <button key={c.easybill_id} onClick={() => setEasybillCustomer(c)}
                      style={{ display: 'block', textAlign: 'left', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                      <strong>{c.company_name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>ID {c.easybill_id}{c.email ? ` · ${c.email}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.02em' }}>Marke (bestimmt die Rechnungsvorlage)</span>
          <select value={brand} onChange={e => setBrand(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }}>
            <option value="talentone">TalentOne</option>
            <option value="nowag_wirth">Nowag &amp; Wirth</option>
          </select>
        </label>

        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.02em' }}>Betrag (netto)</label>
          <div style={{ marginTop: 6 }}>
            <AdBudgetChips value={amount} onChange={setAmount} />
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
            Brutto (19 % USt): <strong>{eur.format(brutto)}</strong>
          </div>
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.02em' }}>Bezeichnung (erscheint im Positionstitel)</span>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder='z. B. "Juli 2026" oder "Kampagne Servicetechniker"'
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }} />
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8 }}>
          <input type="checkbox" checked={usePaypal} onChange={e => setUsePaypal(e.target.checked)} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>PayPal-Zahllink beilegen</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {kunde?.paypal_enabled ? 'PayPal ist am Kunden aktiv' : 'PayPal ist am Kunden nicht aktiv — Checkbox überschreibt für diese Rechnung.'}
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
