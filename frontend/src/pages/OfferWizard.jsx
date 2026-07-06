import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import Icon from '../components/Icon.jsx';

const eur  = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num  = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BRAND_META = {
  talentone: {
    key: 'talentone', label: 'TalentOne',
    tagline: 'Rundum-sorglos, eine Rechnung — Ausstrahlung über TalentOne',
    bullets: [
      'Ausstrahlung über das TalentOne-Werbekonto — kein eigenes Meta-Konto nötig',
      'Werbebudget als Durchleitung monatlich im Voraus',
      'Portal mit Bewerber-Übersicht und Kampagnen-Status',
      'Ideal für kleine bis mittlere Betriebe',
    ],
  },
  nowag_wirth: {
    key: 'nowag_wirth', label: 'Nowag & Wirth',
    tagline: 'Premium — eigenes Werbekonto, Dateneigentum, Partnermanager',
    bullets: [
      'Eigenes Meta-Werbekonto, Kunde behält alle Assets & Zielgruppen',
      'Telefonische Vorqualifizierung + persönlicher Partnermanager',
      'Erfolgsgarantie und wöchentliche Optimierungs-Calls',
      'Für Betriebe, die langfristig eine eigene Recruiting-Marke aufbauen',
    ],
  },
};
const EXTRA_JOB_SKU = { talentone: 'TO-OPT-EXTRA-JOB', nowag_wirth: 'NW-OPT-EXTRA-JOB' };

export default function OfferWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Schritt 1
  const [customer, setCustomer] = useState(null); // Cache-Row: { id, easybill_id, company_name, ... }
  const [alsoInTool, setAlsoInTool] = useState(true);
  // Schritt 2
  const [brand, setBrand] = useState(null);
  // Schritt 3
  const [products, setProducts] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [additionalPositionsCount, setAdditionalPositionsCount] = useState(0);
  const [adBudget, setAdBudget] = useState('800');
  // Schritt 4
  const [totals, setTotals] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [error, setError] = useState('');

  const canNext = useMemo(() => {
    if (step === 1) return !!customer;
    if (step === 2) return !!brand;
    if (step === 3) return products.length > 0;
    return false;
  }, [step, customer, brand, products.length]);

  // Wenn Marke wechselt: Katalog + Textbausteine laden, Default-Optionen wählen
  useEffect(() => {
    if (!brand) return;
    let cancel = false;
    Promise.all([
      api(`/offer-catalog/products?brand=${brand}`),
      api(`/offer-catalog/templates?brand=${brand}`),
    ]).then(([pRes, tRes]) => {
      if (cancel) return;
      const list = pRes.products || [];
      setProducts(list);
      setTemplates(tRes.templates || []);
      // Pflicht + Default-Optionen vorbelegen
      const initial = new Set();
      for (const p of list) {
        if (p.category === 'setup' || p.category === 'monthly') initial.add(p.id);
        else if (p.is_default) initial.add(p.id);
      }
      setSelectedIds(initial);
      setAdditionalPositionsCount(0);
    }).catch(err => setError(err.message));
    return () => { cancel = true; };
  }, [brand]);

  // Live-Berechnung (Debounce 250ms) — für Schritt 3 und 4
  const calcTimer = useRef(null);
  useEffect(() => {
    if (!brand || !products.length) return;
    if (calcTimer.current) clearTimeout(calcTimer.current);
    calcTimer.current = setTimeout(async () => {
      try {
        const payload = {
          brand,
          selected_product_ids: [...selectedIds].map(id => ({ product_id: id })),
          additional_positions_count: additionalPositionsCount,
          ad_budget_monthly: brand === 'talentone' ? parseFloat(adBudget) || 0 : null,
        };
        const res = await api('/offers/calculate', { method: 'POST', body: payload });
        setTotals(res.totals);
      } catch (err) { setError(err.message); }
    }, 250);
    return () => calcTimer.current && clearTimeout(calcTimer.current);
  }, [brand, products, selectedIds, additionalPositionsCount, adBudget]);

  function buildPayload() {
    return {
      brand,
      easybill_customer_id: String(customer.easybill_id),
      customer_snapshot: {
        company_name: customer.company_name, first_name: customer.first_name,
        last_name: customer.last_name, email: customer.email,
        street: customer.street, zip_code: customer.zip_code, city: customer.city,
        country: customer.country, number: customer.number, phone_1: customer.phone_1,
      },
      customer_id: customer.tool_kunde_id || null,
      selected_product_ids: [...selectedIds].map(id => ({ product_id: id })),
      additional_positions_count: additionalPositionsCount,
      ad_budget_monthly: brand === 'talentone' ? parseFloat(adBudget) || 0 : null,
    };
  }

  async function saveDraft() {
    setSavingDraft(true); setError('');
    try {
      const res = await api('/offers', { method: 'POST', body: buildPayload() });
      navigate(`/angebote?draft=${res.offer.id}`);
    } catch (err) { setError(err.message); }
    finally { setSavingDraft(false); }
  }

  /* Draft speichern UND direkt easybill-Angebot erzeugen.
     Fällt easybill um: Draft bleibt bestehen, User bekommt Fehler zurück
     und kann später erneut aus der Liste erzeugen. */
  async function createEasybillOffer() {
    setCreatingOffer(true); setError('');
    let draftId = null;
    try {
      const draftRes = await api('/offers', { method: 'POST', body: buildPayload() });
      draftId = draftRes.offer.id;
      const easyRes = await api(`/offers/${draftId}/create-easybill`, { method: 'POST' });
      // easybill hat Angebotsnummer geliefert — direkt in die Liste, PDF ist im Row-Link
      navigate(`/angebote?created=${easyRes.offer.id}`);
    } catch (err) {
      // Draft ist entstanden aber easybill schlug fehl → zurück in die Liste,
      // damit der User später erneut versuchen kann.
      if (draftId) {
        setError(`easybill-Erzeugung fehlgeschlagen: ${err.message} — Der Entwurf wurde gespeichert. Du kannst ihn in der Angebotsliste erneut erzeugen.`);
      } else {
        setError(err.message);
      }
    } finally { setCreatingOffer(false); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Angebot erstellen</h1>
          <p className="page-sub">Kunde wählen, Marke bestimmen, Positionen konfigurieren, prüfen &amp; speichern.</p>
        </div>
      </div>

      <StepIndicator step={step} labels={['Kunde', 'Marke', 'Konfiguration', 'Vorschau']} />

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        {step === 1 && <Step1Customer customer={customer} onSelect={setCustomer} alsoInTool={alsoInTool} setAlsoInTool={setAlsoInTool} />}
        {step === 2 && <Step2Brand brand={brand} onSelect={setBrand} />}
        {step === 3 && (
          <Step3Config
            brand={brand} products={products}
            selectedIds={selectedIds} onToggle={id => setSelectedIds(cur => {
              const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n;
            })}
            additionalPositionsCount={additionalPositionsCount}
            setAdditionalPositionsCount={setAdditionalPositionsCount}
            adBudget={adBudget} setAdBudget={setAdBudget}
          />
        )}
        {step === 4 && (
          <Step4Preview
            brand={brand} customer={customer} products={products}
            selectedIds={selectedIds} totals={totals} templates={templates}
            additionalPositionsCount={additionalPositionsCount}
            savingDraft={savingDraft} onSaveDraft={saveDraft}
            creatingOffer={creatingOffer} onCreateEasybill={createEasybillOffer}
          />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn-ghost" disabled={step === 1} onClick={() => setStep(s => s - 1)}>← Zurück</button>
        {step < 4 && (
          <button className="btn-primary" disabled={!canNext} onClick={() => setStep(s => s + 1)}>Weiter →</button>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step, labels }) {
  return (
    <div className="step-indicator" style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
      {labels.map((lb, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <div key={lb} style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: active ? 'var(--ink)' : (done ? 'var(--accent)' : 'var(--gray-50)'),
            color: active ? '#fff' : (done ? 'var(--ink)' : 'var(--ink-3)'),
            fontWeight: 600, fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              display: 'grid', placeItems: 'center', fontSize: 11,
              background: active ? 'var(--accent)' : (done ? '#fff' : 'transparent'),
              color: active ? 'var(--ink)' : (done ? 'var(--ink)' : 'inherit'),
              border: done ? 'none' : '1px solid currentColor',
            }}>{done ? '✓' : idx}</span>
            {lb}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────── Step 1 ───────────────────────
function Step1Customer({ customer, onSelect, alsoInTool, setAlsoInTool }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancel = false;
    const t = setTimeout(() => {
      setLoading(true);
      api(`/easybill-customers/search?q=${encodeURIComponent(q)}&limit=25`)
        .then(res => { if (!cancel) setResults(res.customers || []); })
        .catch(() => { if (!cancel) setResults([]); })
        .finally(() => { if (!cancel) setLoading(false); });
    }, 200);
    return () => { clearTimeout(t); cancel = true; };
  }, [q]);

  useEffect(() => {
    api('/easybill-customers/sync/status').then(setSyncStatus).catch(() => {});
  }, []);

  async function triggerSync() {
    setSyncing(true);
    try {
      const res = await api('/easybill-customers/sync', { method: 'POST' });
      setSyncStatus({ running: false, last_run_at: new Date().toISOString(), last_result: res.result });
    } catch (err) {
      alert('Sync fehlgeschlagen: ' + err.message);
    } finally { setSyncing(false); }
  }

  if (customer && !editing) {
    return (
      <CustomerCard
        customer={customer}
        alsoInTool={alsoInTool}
        setAlsoInTool={setAlsoInTool}
        onEdit={() => setEditing(true)}
        onChangeCustomer={() => onSelect(null)}
      />
    );
  }
  if (customer && editing) {
    return (
      <EditCustomerForm
        customer={customer}
        onSaved={c => { onSelect(c); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Schritt 1 — Kunden wählen</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>
        Suche im lokalen easybill-Cache. Nicht dabei? Über den Button rechts einen neuen Kunden anlegen — er wird direkt in easybill geführt.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Firmenname, Kundennummer, E-Mail…"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }}
          autoFocus
        />
        <button className="btn-ghost" onClick={triggerSync} disabled={syncing} title="Cache aus easybill neu ziehen">
          {syncing ? '⏳ Sync läuft…' : '↻ Liste aktualisieren'}
        </button>
        <button className="btn-primary" onClick={() => setShowNewModal(true)}>+ Neu anlegen</button>
      </div>

      {syncStatus?.last_run_at && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 8 }}>
          Cache-Stand: {new Date(syncStatus.last_run_at).toLocaleString('de-DE')}
          {syncStatus?.last_result?.upserted != null && ` · ${syncStatus.last_result.upserted} Kunden im Cache`}
        </div>
      )}

      <div className="bewerbungen-table-scroll">
        <table className="bewerbungen-table">
          <thead>
            <tr>
              <th>Firma</th>
              <th>Nr.</th>
              <th>Ansprechpartner</th>
              <th>Ort</th>
              <th>E-Mail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Suche…</td></tr>}
            {!loading && results.length === 0 && (
              <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic' }}>
                Keine Treffer{q ? ` für "${q}"` : ''}.
              </td></tr>
            )}
            {results.map(c => (
              <tr key={c.id}>
                <td><strong>{c.company_name || '—'}</strong></td>
                <td><code style={{ fontSize: 11 }}>{c.number || '—'}</code></td>
                <td>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                <td>{[c.zip_code, c.city].filter(Boolean).join(' ') || '—'}</td>
                <td style={{ fontSize: 12 }}>{c.email || '—'}</td>
                <td><button className="btn-primary btn-sm" onClick={() => onSelect(c)}>Auswählen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewCustomerModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        initialName={q}
        onCreated={c => { onSelect(c); setShowNewModal(false); }}
      />
    </div>
  );
}

function CustomerCard({ customer, alsoInTool, setAlsoInTool, onEdit, onChangeCustomer }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
            Kunde
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {customer.company_name}
            {customer.number && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-4)', fontWeight: 400 }}>Nr. {customer.number}</span>}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost btn-sm" onClick={onEdit}>Bearbeiten</button>
          <button className="btn-ghost btn-sm" onClick={onChangeCustomer}>Anderen wählen</button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
        {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || <em style={{ color: 'var(--ink-4)' }}>Kein Ansprechpartner</em>}<br />
        {customer.street}<br />
        {[customer.zip_code, customer.city].filter(Boolean).join(' ')} · {customer.country || 'DE'}<br />
        {customer.email && <><a href={`mailto:${customer.email}`}>{customer.email}</a><br /></>}
        {customer.phone_1}
      </div>
      <div style={{ marginTop: 14, padding: 12, background: 'var(--gray-50)', borderRadius: 8, fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={alsoInTool} onChange={e => setAlsoInTool(e.target.checked)} />
          <span>Kunde auch im Tool anlegen (für Onboarding, Bewerber-Hub etc.)</span>
        </label>
      </div>
    </div>
  );
}

function NewCustomerModal({ open, onClose, initialName, onCreated }) {
  const [form, setForm] = useState({ company_name: '', first_name: '', last_name: '', street: '', zip_code: '', city: '', country: 'DE', email: '', phone_1: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dubletten, setDubletten] = useState([]);

  useEffect(() => {
    if (open) {
      setForm({ company_name: initialName || '', first_name: '', last_name: '', street: '', zip_code: '', city: '', country: 'DE', email: '', phone_1: '' });
      setErr(''); setDubletten([]);
    }
  }, [open, initialName]);

  // Live-Dubletten-Check
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!form.company_name || form.company_name.length < 3) { setDubletten([]); return; }
      api(`/easybill-customers/dubletten-check?company_name=${encodeURIComponent(form.company_name)}`)
        .then(r => setDubletten(r.matches || [])).catch(() => setDubletten([]));
    }, 300);
    return () => clearTimeout(t);
  }, [open, form.company_name]);

  async function submit() {
    setErr('');
    if (!form.company_name.trim()) return setErr('Firmenname ist Pflicht.');
    if (!form.last_name.trim())    return setErr('Nachname (Ansprechpartner) ist Pflicht.');
    if (!form.street.trim())       return setErr('Straße ist Pflicht.');
    if (!form.zip_code.trim())     return setErr('PLZ ist Pflicht.');
    if (!form.city.trim())         return setErr('Ort ist Pflicht.');
    setBusy(true);
    try {
      const res = await api('/easybill-customers', { method: 'POST', body: form });
      onCreated(res.customer);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Neuen Kunden anlegen"
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Speichere in easybill…' : 'Anlegen'}</button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Wird direkt in easybill angelegt (führendes System) und dann in den lokalen Cache übernommen.
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      {dubletten.length > 0 && (
        <div style={{ padding: 12, background: '#fff8d4', border: '1px solid #f0d878', borderRadius: 8, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠ Ähnliche Kunden im Cache — Dublette?</div>
          {dubletten.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 13 }}>
                <strong>{m.company_name}</strong>
                {m.number && <span style={{ marginLeft: 8, color: 'var(--ink-4)' }}>Nr. {m.number}</span>}
                {m.city && <span style={{ marginLeft: 8, color: 'var(--ink-4)' }}>· {m.city}</span>}
              </span>
              <button className="btn-ghost btn-sm" onClick={() => onCreated(m)}>Diesen übernehmen</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <FieldRow label="Firmenname *"    value={form.company_name} onChange={v => setForm({ ...form, company_name: v })} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FieldRow label="Vorname"          value={form.first_name} onChange={v => setForm({ ...form, first_name: v })} />
          <FieldRow label="Nachname *"       value={form.last_name}  onChange={v => setForm({ ...form, last_name: v })} />
        </div>
        <FieldRow label="Straße *"           value={form.street}     onChange={v => setForm({ ...form, street: v })} />
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', gap: 10 }}>
          <FieldRow label="PLZ *"            value={form.zip_code}   onChange={v => setForm({ ...form, zip_code: v })} />
          <FieldRow label="Ort *"            value={form.city}       onChange={v => setForm({ ...form, city: v })} />
          <FieldRow label="Land"             value={form.country}    onChange={v => setForm({ ...form, country: v })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FieldRow label="E-Mail"           value={form.email}      onChange={v => setForm({ ...form, email: v })} type="email" />
          <FieldRow label="Telefon"          value={form.phone_1}    onChange={v => setForm({ ...form, phone_1: v })} type="tel" />
        </div>
      </div>
    </Modal>
  );
}

function EditCustomerForm({ customer, onSaved, onCancel }) {
  const [form, setForm] = useState({
    company_name: customer.company_name || '', first_name: customer.first_name || '',
    last_name: customer.last_name || '', street: customer.street || '',
    zip_code: customer.zip_code || '', city: customer.city || '',
    country: customer.country || 'DE', email: customer.email || '', phone_1: customer.phone_1 || '',
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const res = await api(`/easybill-customers/${customer.id}`, { method: 'PATCH', body: form });
      onSaved(res.customer);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Kundendaten bearbeiten</h2>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Änderungen werden zuerst in easybill gespeichert und dann in den Cache übernommen.
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gap: 10, maxWidth: 640 }}>
        <FieldRow label="Firmenname *"    value={form.company_name} onChange={v => setForm({ ...form, company_name: v })} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FieldRow label="Vorname"       value={form.first_name} onChange={v => setForm({ ...form, first_name: v })} />
          <FieldRow label="Nachname *"    value={form.last_name}  onChange={v => setForm({ ...form, last_name: v })} />
        </div>
        <FieldRow label="Straße"          value={form.street}     onChange={v => setForm({ ...form, street: v })} />
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px', gap: 10 }}>
          <FieldRow label="PLZ"           value={form.zip_code}   onChange={v => setForm({ ...form, zip_code: v })} />
          <FieldRow label="Ort"           value={form.city}       onChange={v => setForm({ ...form, city: v })} />
          <FieldRow label="Land"          value={form.country}    onChange={v => setForm({ ...form, country: v })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FieldRow label="E-Mail"        value={form.email}      onChange={v => setForm({ ...form, email: v })} type="email" />
          <FieldRow label="Telefon"       value={form.phone_1}    onChange={v => setForm({ ...form, phone_1: v })} type="tel" />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Speichere in easybill…' : 'Speichern'}</button>
      </div>
    </div>
  );
}

function FieldRow({ label, value, onChange, type = 'text' }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.02em' }}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 14 }} />
    </label>
  );
}

// ─────────────────────── Step 2 ───────────────────────
function Step2Brand({ brand, onSelect }) {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Schritt 2 — Marke wählen</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>Legt fest, welcher Positionskatalog und welche Textbausteine ins Angebot fließen.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {Object.values(BRAND_META).map(b => {
          const active = brand === b.key;
          return (
            <button
              key={b.key}
              onClick={() => onSelect(b.key)}
              style={{
                textAlign: 'left', padding: 22, borderRadius: 14, cursor: 'pointer',
                border: active ? '2.5px solid var(--ink)' : '2px solid var(--line)',
                background: active ? 'color-mix(in srgb, var(--accent) 8%, #fff)' : '#fff',
                boxShadow: active ? '0 10px 30px rgba(0,0,0,0.08)' : '0 2px 6px rgba(0,0,0,0.04)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{b.label}</span>
                {active && <span style={{ fontSize: 11, padding: '2px 8px', background: 'var(--accent)', color: 'var(--ink)', borderRadius: 100, fontWeight: 700 }}>✓ Gewählt</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>{b.tagline}</div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {b.bullets.map(bp => (
                  <li key={bp} style={{ fontSize: 13, color: 'var(--ink-2)', paddingLeft: 20, position: 'relative', lineHeight: 1.5 }}>
                    <span style={{ position: 'absolute', left: 0, top: 1, color: 'var(--accent)', fontWeight: 700 }}>✓</span>
                    {bp}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────── Step 3 ───────────────────────
function Step3Config({ brand, products, selectedIds, onToggle, additionalPositionsCount, setAdditionalPositionsCount, adBudget, setAdBudget }) {
  const setups   = products.filter(p => p.category === 'setup');
  const monthlys = products.filter(p => p.category === 'monthly');
  const options  = products.filter(p => p.category === 'option_setup' || p.category === 'option_monthly');
  const extraSku = EXTRA_JOB_SKU[brand];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Schritt 3 — Konfiguration</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>Pflichtpositionen sind bereits ausgewählt und nicht abwählbar. Optionen nach Bedarf ergänzen.</p>

      <section style={{ marginBottom: 22 }}>
        <SectionHead label="Setup (einmalig)" />
        {setups.map(p => <PositionRow key={p.id} p={p} selected={true} readonly required />)}
      </section>

      <section style={{ marginBottom: 22 }}>
        <SectionHead label="Monatlich" />
        {monthlys.map(p => <PositionRow key={p.id} p={p} selected={true} readonly required />)}
      </section>

      <section style={{ marginBottom: 22 }}>
        <SectionHead label="Optionen" />
        {options.map(p => {
          const isExtra = p.sku === extraSku;
          return (
            <PositionRow
              key={p.id} p={p}
              selected={selectedIds.has(p.id)}
              onToggle={() => onToggle(p.id)}
              extraCount={isExtra ? additionalPositionsCount : null}
              onExtraCount={isExtra ? setAdditionalPositionsCount : null}
            />
          );
        })}
      </section>

      {brand === 'talentone' && (
        <section style={{ marginBottom: 6, padding: 16, background: 'var(--gray-50)', borderRadius: 12 }}>
          <SectionHead label="Werbebudget (monatliche Durchleitung)" />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input type="number" step="10" min="0" value={adBudget} onChange={e => setAdBudget(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 15, width: 160, textAlign: 'right' }} />
            <span style={{ fontSize: 13 }}>€ / Monat</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>· Empfehlung 600–1.200 €</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
            Wird als durchlaufender Posten monatlich im Voraus berechnet. Kampagnenstart erfolgt nach Zahlungseingang.
          </p>
        </section>
      )}

      {brand === 'nowag_wirth' && (
        <section style={{ padding: 16, background: 'var(--gray-50)', borderRadius: 12 }}>
          <SectionHead label="Werbebudget" />
          <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.6 }}>
            Zahlt der Kunde direkt an Meta über sein eigenes Werbekonto.<br />
            <strong>Empfehlung: 20–40 € pro Tag pro Stelle.</strong>
          </p>
        </section>
      )}
    </div>
  );
}

function SectionHead({ label }) {
  return <h3 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 8px' }}>{label}</h3>;
}

function PositionRow({ p, selected, onToggle, readonly, required, extraCount, onExtraCount }) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      padding: '12px 14px', marginBottom: 6,
      border: '1px solid ' + (selected ? 'var(--ink)' : 'var(--line)'),
      borderRadius: 10,
      background: selected ? 'color-mix(in srgb, var(--accent) 6%, #fff)' : '#fff',
    }}>
      <input
        type="checkbox" checked={selected} disabled={readonly} onChange={onToggle}
        style={{ width: 18, height: 18, cursor: readonly ? 'default' : 'pointer' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
          {p.title}
          {required && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px', background: 'var(--gray-100)', borderRadius: 100, color: 'var(--ink-3)', fontWeight: 500 }}>Pflicht</span>}
          {p.category.endsWith('monthly') && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px', background: '#e0f5ff', borderRadius: 100, color: '#0068a3', fontWeight: 600 }}>monatlich</span>}
        </div>
        {extraCount != null && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Zusätzliche parallele Stellen:</span>
            <input
              type="number" min="0" max="5" value={extraCount}
              onChange={e => onExtraCount(Math.max(0, Math.min(5, parseInt(e.target.value, 10) || 0)))}
              style={{ width: 60, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'center', fontSize: 13 }}
            />
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{eur.format(Number(p.unit_price))}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>je Einheit netto</div>
      </div>
    </div>
  );
}

// ─────────────────────── Step 4 ───────────────────────
function Step4Preview({ brand, customer, products, selectedIds, totals, templates, additionalPositionsCount, savingDraft, onSaveDraft, creatingOffer, onCreateEasybill }) {
  const positionsWithText = (totals?.positions || []).map(l => ({
    ...l,
    description: products.find(p => p.id === l.product_id)?.description || '',
  }));
  const brandMeta = BRAND_META[brand];
  const guarantee = templates.find(t => t.key === 'guarantee')?.text || '';
  const paymentTerms = templates.find(t => t.key === 'payment_terms')?.text || '';

  if (!totals) return <div>Lade Vorschau…</div>;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Schritt 4 — Vorschau &amp; Speichern</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div>
          <div style={{ padding: 16, background: 'var(--gray-50)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Angebot für</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{customer.company_name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
              {[customer.first_name, customer.last_name].filter(Boolean).join(' ')} · {[customer.zip_code, customer.city].filter(Boolean).join(' ')}
              {customer.number && <> · Kd-Nr. {customer.number}</>}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>Marke: <strong>{brandMeta.label}</strong></div>
          </div>

          <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '18px 0 8px' }}>Positionen</h3>
          {positionsWithText.map(l => (
            <div key={l.product_id} style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {l.title}
                    {l.category.endsWith('monthly') && <span style={{ marginLeft: 8, fontSize: 10, color: '#0068a3' }}>(monatlich)</span>}
                    {l.quantity > 1 && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>× {l.quantity}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{eur.format(l.line_total)}</div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>{l.description}</p>
            </div>
          ))}
          {brand === 'talentone' && totals.ad_budget_monthly > 0 && (
            <div style={{ padding: '12px 14px', border: '1px dashed var(--line)', borderRadius: 10, marginBottom: 8, background: '#fafaf8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ fontSize: 14 }}>Werbebudget-Abwicklung (monatlich im Voraus)</strong>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{eur.format(totals.ad_budget_monthly)}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 0' }}>
                Vollständige Abwicklung Ihres Werbebudgets über TalentOne — eine Rechnung, keine separaten Meta-Rechnungen. Kampagnenstart nach Zahlungseingang.
              </p>
            </div>
          )}

          {guarantee && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '22px 0 8px' }}>Garantie</h3>
              <div style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{guarantee}</div>
            </>
          )}
          {paymentTerms && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '22px 0 8px' }}>Zahlungsbedingungen</h3>
              <div style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{paymentTerms}</div>
            </>
          )}
        </div>

        <aside style={{ position: 'sticky', top: 12, alignSelf: 'flex-start' }}>
          <TotalsCard totals={totals} brand={brand} />

          <div style={{ marginTop: 14 }}>
            <button
              className="btn-primary" style={{ width: '100%', marginBottom: 8 }}
              onClick={onCreateEasybill} disabled={creatingOffer || savingDraft}
            >
              {creatingOffer ? '⏳ Erzeuge in easybill…' : '📤 Angebot in easybill erzeugen'}
            </button>
            <button
              className="btn-ghost" style={{ width: '100%' }}
              onClick={onSaveDraft} disabled={savingDraft || creatingOffer}
              title="Speichert nur als Entwurf, sendet nichts an easybill"
            >
              {savingDraft ? 'Speichere…' : '💾 Nur als Entwurf speichern'}
            </button>
            <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
              Erzeugen speichert zuerst den Entwurf, ruft dann easybill und öffnet das PDF.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TotalsCard({ totals, brand }) {
  const rows = [
    { label: 'Setup gesamt',        value: totals.setup_total,      hint: 'einmalig' },
    { label: 'Monatlich',           value: totals.monthly_total,    hint: 'wiederkehrend' },
  ];
  if (brand === 'talentone' && totals.ad_budget_monthly > 0) {
    rows.push({ label: 'Werbebudget',    value: totals.ad_budget_monthly, hint: 'monatlich, Durchleitung' });
  }
  const netto = totals.first_month_total;
  const brutto = totals.gross.first_month_gross;
  const vat = totals.vat.first_month_vat;

  return (
    <div style={{ padding: 18, background: 'var(--ink)', color: '#fff', borderRadius: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>Summe Monat 1</div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed rgba(255,255,255,0.15)', fontSize: 13 }}>
          <div>
            {r.label}
            <div style={{ fontSize: 10, opacity: 0.6 }}>{r.hint}</div>
          </div>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{eur.format(r.value)}</div>
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
          <span>Netto Monat 1</span><span>{eur.format(netto)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
          <span>USt {totals.vat_rate}%</span><span>{eur.format(vat)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.25)' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Brutto Monat 1</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{eur.format(brutto)}</span>
        </div>
      </div>
    </div>
  );
}
