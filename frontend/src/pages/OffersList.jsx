import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import Modal from '../components/Modal.jsx';
import KundePicker from '../components/KundePicker.jsx';
import { AdBudgetChips } from './OfferWizard.jsx';
import { displayNameForEmail } from '../lib/team-display.js';
import AnredeAbfrage from '../components/AnredeAbfrage.jsx';
import { anredeOffen } from '../lib/anrede.js';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

const STATUS_LABEL = {
  draft:    { label: 'Entwurf',        color: '#5a5955', bg: 'var(--gray-100)' },
  created:  { label: 'Erstellt',       color: '#0068a3', bg: '#e0f5ff' },
  sent:     { label: 'Versandt',       color: '#a34e00', bg: '#fff2d4' },
  accepted: { label: 'Angenommen',     color: '#0a8043', bg: '#e0f5df' },
  declined: { label: 'Abgelehnt',      color: '#b91c1c', bg: '#fde0e0' },
};

const BRAND_LABEL = { talentone: 'TalentOne', nowag_wirth: 'Nowag & Wirth' };

// Phasen-Badges — gleiche Farb-Codierung wie im BillingModal
export const PHASE_META = {
  guarantee:         { label: 'Garantiefrist läuft',      color: '#0068a3', bg: '#e0f5ff' }, // blau
  active:            { label: 'Reguläre Abrechnung',      color: '#0a8043', bg: '#e0f5df' }, // grün
  guarantee_expired: { label: 'Servicefrei (Frist erreicht)', color: '#a34e00', bg: '#fff2d4' }, // orange
  paused:            { label: 'Pausiert — manuell reaktivieren', color: '#b91c1c', bg: '#fde0e0' }, // rot
  ended:             { label: 'Abrechnung beendet',       color: '#5a5955', bg: 'var(--gray-100)' },
  inactive:          { label: 'Abrechnung nicht aktiv',   color: '#5a5955', bg: 'var(--gray-100)' },
};

/** Reine Client-Version von computeBillingPhase — spiegelt die Backend-Logik. */
export function computeBillingPhaseClient(offerSnap) {
  if (!offerSnap) return 'inactive';
  if (offerSnap.billing_ended_at)   return 'ended';
  if (offerSnap.billing_paused_at)  return 'paused';
  if (!offerSnap.campaign_started_at) return 'inactive';
  const now = Date.now();
  const start = new Date(offerSnap.campaign_started_at).getTime();
  const guaranteeMs = (Number(offerSnap.guarantee_period_days) || 30) * 86400000;
  if (now <= start + guaranteeMs) return 'guarantee';
  return 'active'; // Backend unterscheidet zusätzlich guarantee_expired via hires — Vereinfachung im Client.
}

// Lädt den verknüpften Kunden (für die Pflicht-Anrede im Versand-Modal).
// Verwaiste Angebote ohne customer_id liefern null — dort greift kein Gate.
async function loadOfferKunde(offer) {
  if (!offer?.customer_id) return null;
  try {
    const res = await api(`/kunden/${offer.customer_id}`);
    return res.kunde || null;
  } catch { return null; }
}

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
  const [sendOrderModal, setSendOrderModal] = useState(null); // dgl. für AB-Versand
  const [billingOffer, setBillingOffer] = useState(null); // Angebot fürs Abrechnungs-Modal
  const [declineOffer, setDeclineOffer] = useState(null); // Angebot fürs Decline-Modal
  const [linkOffer, setLinkOffer] = useState(null); // verwaistes Angebot fürs Zuordnungs-Modal
  const [linkBusy, setLinkBusy] = useState(false);

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
      const kunde = await loadOfferKunde(offer);
      setSendModal({ offerId: offer.id, kunde, ...preview });
    } catch (e) { setRowError(r => ({ ...r, [offer.id]: e.message })); }
    finally { setBusyId(null); }
  }

  async function openSendOrderModal(offer) {
    setBusyId(offer.id);
    setRowError(r => ({ ...r, [offer.id]: '' }));
    try {
      const preview = await api(`/offers/${offer.id}/order-email-preview`);
      const kunde = await loadOfferKunde(offer);
      setSendOrderModal({ offerId: offer.id, kunde, ...preview });
    } catch (e) { setRowError(r => ({ ...r, [offer.id]: e.message })); }
    finally { setBusyId(null); }
  }

  async function retryCreateEasybill(offerId) {
    setBusyId(offerId);
    setRowError(r => ({ ...r, [offerId]: '' }));
    try {
      try {
        await api(`/offers/${offerId}/create-easybill`, { method: 'POST' });
      } catch (e) {
        if (e.status === 409 && e.body?.warning === 'guarantee_bewerbungen') {
          const ok = window.confirm(`⚠️ ${e.body.message}\n\nGefundene Formulierung:\n„${e.body.sample || '(nicht extrahierbar)'}"\n\nTrotzdem senden?`);
          if (!ok) throw new Error('Abgebrochen — bitte Garantie-Text korrigieren.');
          await api(`/offers/${offerId}/create-easybill`, { method: 'POST', body: { confirm_guarantee_warning: true } });
        } else { throw e; }
      }
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
                <th style={{ textAlign: 'right' }} title="Einmalige Setup-Positionen">Setup</th>
                <th style={{ textAlign: 'right' }} title="Wiederkehrende Servicepauschale (ohne Werbebudget)">Monatspauschale</th>
                <th style={{ textAlign: 'right' }} title="Setup + 1. Monatspauschale + ggf. Werbebudget (Vorauszahlung)">Monat 1</th>
                <th>Status &amp; Phase</th>
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
                    <td>
                      <strong>{snap.company_name || o.easybill_customer_id}</strong>
                      {!o.customer_id && (
                        <button type="button" className="avv-warn offer-orphan-badge"
                          title="Dieses Angebot ist keinem internen Kunden zugeordnet — klicken zum Verknüpfen"
                          onClick={() => setLinkOffer(o)}>
                          ⚠️ Kein Kunde verknüpft
                        </button>
                      )}
                    </td>
                    <td>{BRAND_LABEL[o.brand]}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(o.setup_total)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {eur.format(o.monthly_total)}
                      {Number(o.ad_budget_monthly) > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>+ {eur.format(o.ad_budget_monthly)} Werbebudget</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{eur.format(o.first_month_total)}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 100, background: st.bg, color: st.color, fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                      {o.status === 'accepted' && !o.easybill_document_id && (
                        <span
                          title="Auftragsbestätigung wurde direkt aus dem Wizard erzeugt — kein Angebot vorausgegangen."
                          style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 100, background: '#fff7ed', color: '#9a3412', fontSize: 10, fontWeight: 700, border: '1px dashed #fdba74' }}
                        >Direktauftrag</span>
                      )}
                      {o.status === 'accepted' && o.billing_phase && PHASE_META[o.billing_phase] && (
                        <div style={{ marginTop: 4 }}>
                          <span
                            title={o.billing_phase === 'guarantee' ? `Aktiv seit ${new Date(o.campaign_started_at).toLocaleDateString('de-DE')} · Garantie ${o.guarantee_period_days} Tage` :
                                   o.billing_phase === 'active'    ? `${o.hire_count} von ${o.hires_target || 1} Einstellungen` :
                                   o.billing_phase === 'guarantee_expired' ? 'Frist erreicht ohne Einstellung — ab nächstem Lauf servicefrei' :
                                   o.billing_phase === 'paused'    ? 'TalentOne max servicefrei erreicht — bitte manuell reaktivieren' :
                                   ''}
                            style={{ padding: '2px 8px', borderRadius: 100, background: PHASE_META[o.billing_phase].bg, color: PHASE_META[o.billing_phase].color, fontSize: 10, fontWeight: 700 }}
                          >{PHASE_META[o.billing_phase].label}
                          {o.billing_phase === 'active' && ` · ${o.hire_count}/${o.hires_target || 1}`}
                          </span>
                        </div>
                      )}
                      {o.status === 'declined' && o.decline_note && (
                        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }} title={o.decline_note}>
                          {o.decline_note.slice(0, 40)}{o.decline_note.length > 40 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }} title={o.created_by || undefined}>
                      {o.created_by ? displayNameForEmail(o.created_by) : '—'}
                    </td>
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
                      {o.status === 'accepted' && (
                        <button
                          className="btn-primary btn-sm"
                          title="Abrechnung: Setup-Rechnung, monatliches Abo, Werbebudget"
                          onClick={() => setBillingOffer(o)}
                        >📊 Abrechnung</button>
                      )}
                      {o.easybill_order_document_id && (
                        <button
                          className={o.order_sent_at ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
                          title={o.order_sent_at ? `AB bereits versandt an ${o.order_sent_to || 'Kunde'} — erneut senden` : 'Auftragsbestätigung per E-Mail an Kunden senden'}
                          disabled={isBusy}
                          onClick={() => openSendOrderModal(o)}
                        >{isBusy ? '⏳' : (o.order_sent_at ? '📋 AB erneut senden' : '📋 AB senden')}</button>
                      )}
                      {(o.status === 'draft' || o.status === 'created' || o.status === 'sent') && (
                        <button
                          className="btn-ghost btn-sm"
                          title="Angebot ablehnen (mit Notiz)"
                          onClick={() => setDeclineOffer(o)}
                        >❌ Ablehnen</button>
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
        kunde={sendModal?.kunde}
        onKundeSaved={(k) => setSendModal(m => (m ? { ...m, kunde: k } : m))}
        onClose={() => setSendModal(null)}
        onSent={() => { setSendModal(null); load(); }}
      />

      <SendOrderModal
        preview={sendOrderModal}
        kunde={sendOrderModal?.kunde}
        onKundeSaved={(k) => setSendOrderModal(m => (m ? { ...m, kunde: k } : m))}
        onClose={() => setSendOrderModal(null)}
        onSent={() => { setSendOrderModal(null); load(); }}
      />

      <BillingModal
        offer={billingOffer}
        onClose={() => setBillingOffer(null)}
        onChanged={() => { setBillingOffer(null); load(); }}
      />

      <DeclineModal
        offer={declineOffer}
        onClose={() => setDeclineOffer(null)}
        onDeclined={() => { setDeclineOffer(null); load(); }}
      />

      <Modal open={!!linkOffer} onClose={() => setLinkOffer(null)}
        title={`Angebot verknüpfen — ${linkOffer?.customer_snapshot?.company_name || linkOffer?.easybill_customer_id || ''}`}>
        {linkOffer && (
          <div style={{ minWidth: 380 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 0 }}>
              Diesem Angebot ist noch kein interner Kunde zugeordnet. Wähle den passenden Kunden — die zugehörigen Rechnungen werden mit-zugeordnet.
            </p>
            <KundePicker autoFocus onPick={async (k) => {
              setLinkBusy(true);
              try {
                await api(`/offers/${linkOffer.id}/link-customer`, { method: 'POST', body: { customer_id: k.id } });
                setLinkOffer(null); load();
              } catch (e) { alert(e.message); }
              finally { setLinkBusy(false); }
            }} />
            {linkBusy && <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>Verknüpfe…</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function SendOfferModal({ preview, kunde, onKundeSaved, onClose, onSent }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachFlyer, setAttachFlyer] = useState(false);
  const [flyerParagraph, setFlyerParagraph] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okNote, setOkNote] = useState('');

  useEffect(() => {
    if (!preview) return;
    setTo(preview.to || '');
    setSubject(preview.subject || '');
    setErr(''); setOkNote('');
    setFlyerParagraph(preview.flyer_paragraph || '');
    const flyerOnByDefault = !!preview.flyer_available;
    setAttachFlyer(flyerOnByDefault);
    // Body mit oder ohne Flyer-Absatz vorab füllen. Der Flyer-Absatz landet
    // VOR der Grußformel — als eigener Absatz zwischen dem Angebots-PDF-
    // Absatz und dem letzten Absatz.
    setBody(composeBody(preview.body || '', preview.flyer_paragraph || '', flyerOnByDefault));
  }, [preview?.offerId]);

  // Wenn User Checkbox toggled: Body neu zusammensetzen (überschreibt Edits!)
  function onToggleFlyer(next) {
    if (!preview) return;
    const oldBody = body;
    const withFlyer = next;
    const newBody = composeBody(preview.body || '', flyerParagraph, withFlyer);
    if (oldBody !== preview.body && oldBody !== composeBody(preview.body || '', flyerParagraph, !withFlyer)) {
      // User hat editiert
      if (!window.confirm('Der Text wird beim Umschalten neu aufgebaut. Deine Änderungen im Body gehen verloren. Fortfahren?')) return;
    }
    setAttachFlyer(withFlyer);
    setBody(newBody);
  }

  if (!preview) return null;

  async function send() {
    setErr(''); setOkNote('');
    if (!to || !/.+@.+\..+/.test(to)) return setErr('Empfänger-E-Mail ungültig.');
    if (!subject.trim())               return setErr('Betreff fehlt.');
    if (!body.trim())                  return setErr('Text fehlt.');
    setBusy(true);
    try {
      const res = await api(`/offers/${preview.offerId}/send-email`, {
        method: 'POST',
        body: { to, subject, body, attach_flyer: attachFlyer },
      });
      if (attachFlyer && !res.flyer_attached) {
        // Best-effort: Mail ging raus, aber ohne Flyer
        setOkNote(`Versandt — ${res.flyer_warn || 'ohne Flyer'}`);
        setTimeout(onSent, 1500);
      } else {
        onSent();
      }
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
        <button className="btn-primary" onClick={send} disabled={busy || (kunde && anredeOffen(kunde))}>
          {busy ? 'Sende…' : '📤 Jetzt senden'}
        </button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Absender richtet sich nach der Marke des Angebots. Reply-To geht an info@nowagwirth.de. Das easybill-PDF wird automatisch als Anhang angefügt.
      </p>

      <AnredeAbfrage kunde={kunde} onSaved={(k) => onKundeSaved?.(k)} />

      {preview.flyer_available && (
        <div style={{ padding: 10, background: 'var(--gray-50)', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="flyer-toggle" type="checkbox" checked={attachFlyer} onChange={e => onToggleFlyer(e.target.checked)} />
          <label htmlFor="flyer-toggle" style={{ fontSize: 13, cursor: 'pointer' }}>
            📎 <strong>Flyer anhängen</strong> — <code style={{ fontSize: 11 }}>{preview.flyer_filename}</code>
          </label>
        </div>
      )}

      {okNote && <div className="alert" style={{ background: '#fff8d4', color: '#a34e00', border: '1px solid #f0d878', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{okNote}</div>}

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

export function SendOrderModal({ preview, kunde, onKundeSaved, onClose, onSent }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachFlyer, setAttachFlyer] = useState(false);
  const [flyerParagraph, setFlyerParagraph] = useState('');
  const [terminSet, setTerminSet] = useState(false);
  const [terminIso, setTerminIso] = useState('');
  const [formularOption, setFormularOption] = useState('none'); // 'none' | 'link' | 'separat'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okNote, setOkNote] = useState('');

  function buildBody(withFlyer, tSet, tIso, fOpt) {
    const base = composeBody(preview?.body || '', preview?.flyer_paragraph || '', withFlyer);
    return composeOrderBody(base, {
      terminSet: tSet, terminIso: tIso,
      formularOption: fOpt,
      formularLink: preview?.onboarding_form_url || null,
    });
  }

  useEffect(() => {
    if (!preview) return;
    setTo(preview.to || '');
    setSubject(preview.subject || '');
    setErr(''); setOkNote('');
    setFlyerParagraph(preview.flyer_paragraph || '');
    const flyerOnByDefault = !!preview.flyer_available;
    setAttachFlyer(flyerOnByDefault);
    setTerminSet(false); setTerminIso(''); setFormularOption('none');
    setBody(buildBody(flyerOnByDefault, false, '', 'none'));
    // eslint-disable-next-line
  }, [preview?.offerId]);

  function reflow(next) {
    if (!preview) return;
    const params = {
      withFlyer:      next.withFlyer      ?? attachFlyer,
      terminSet:      next.terminSet      ?? terminSet,
      terminIso:      next.terminIso      ?? terminIso,
      formularOption: next.formularOption ?? formularOption,
    };
    const rebuilt = buildBody(params.withFlyer, params.terminSet, params.terminIso, params.formularOption);
    const previousRebuild = buildBody(attachFlyer, terminSet, terminIso, formularOption);
    if (body !== previousRebuild) {
      if (!window.confirm('Der Text wird beim Umschalten neu aufgebaut. Deine Änderungen im Body gehen verloren. Fortfahren?')) return;
    }
    if (next.withFlyer !== undefined)      setAttachFlyer(next.withFlyer);
    if (next.terminSet !== undefined)      setTerminSet(next.terminSet);
    if (next.terminIso !== undefined)      setTerminIso(next.terminIso);
    if (next.formularOption !== undefined) setFormularOption(next.formularOption);
    setBody(rebuilt);
  }

  function onToggleFlyer(v)      { reflow({ withFlyer: v }); }
  function onToggleTermin(v)     { reflow({ terminSet: v }); }
  function onChangeTermin(v)     { reflow({ terminSet: terminSet || !!v, terminIso: v }); }
  function onChangeFormular(v)   { reflow({ formularOption: v }); }

  if (!preview) return null;

  async function send() {
    setErr(''); setOkNote('');
    if (!to || !/.+@.+\..+/.test(to)) return setErr('Empfänger-E-Mail ungültig.');
    if (!subject.trim())               return setErr('Betreff fehlt.');
    if (!body.trim())                  return setErr('Text fehlt.');
    setBusy(true);
    try {
      const res = await api(`/offers/${preview.offerId}/send-order-email`, {
        method: 'POST',
        body: { to, subject, body, attach_flyer: attachFlyer },
      });
      if (attachFlyer && !res.flyer_attached) {
        setOkNote(`Versandt — ${res.flyer_warn || 'ohne Flyer'}`);
        setTimeout(onSent, 1500);
      } else {
        onSent();
      }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title={`Auftragsbestätigung an ${preview.firma || 'Kunden'} senden`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={send} disabled={busy || (kunde && anredeOffen(kunde))}>
          {busy ? 'Sende…' : '📋 Jetzt senden'}
        </button>
      </>}
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Absender richtet sich nach der Marke des Angebots. Reply-To geht an info@nowagwirth.de. Die AB als PDF wird automatisch aus easybill angefügt.
      </p>

      <AnredeAbfrage kunde={kunde} onSaved={(k) => onKundeSaved?.(k)} />

      {preview.flyer_available && (
        <div style={{ padding: 10, background: 'var(--gray-50)', borderRadius: 8, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="order-flyer-toggle" type="checkbox" checked={attachFlyer} onChange={e => onToggleFlyer(e.target.checked)} />
          <label htmlFor="order-flyer-toggle" style={{ fontSize: 13, cursor: 'pointer' }}>
            📎 <strong>Flyer anhängen</strong> — <code style={{ fontSize: 11 }}>{preview.flyer_filename}</code>
          </label>
        </div>
      )}

      <div style={{ padding: 10, background: 'var(--gray-50)', borderRadius: 8, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={terminSet} onChange={e => onToggleTermin(e.target.checked)} />
          <strong>Onboarding-Termin bereits vereinbart</strong>
        </label>
        {terminSet && (
          <input type="datetime-local" value={terminIso} onChange={e => onChangeTermin(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} />
        )}
      </div>

      <div style={{ padding: 10, background: 'var(--gray-50)', borderRadius: 8, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Onboarding-Formular:</span>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="radio" name="form-opt" checked={formularOption === 'none'} onChange={() => onChangeFormular('none')} />
          nicht erwähnen
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, cursor: preview.onboarding_form_url ? 'pointer' : 'not-allowed', opacity: preview.onboarding_form_url ? 1 : 0.5 }}
          title={preview.onboarding_form_url ? preview.onboarding_form_url : 'Keine URL im Katalog hinterlegt (Admin → Angebots-Katalog)'}
        >
          <input type="radio" name="form-opt"
            disabled={!preview.onboarding_form_url}
            checked={formularOption === 'link'} onChange={() => onChangeFormular('link')} />
          Link in dieser Mail
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="radio" name="form-opt" checked={formularOption === 'separat'} onChange={() => onChangeFormular('separat')} />
          wird separat geschickt
        </label>
      </div>

      {okNote && <div className="alert" style={{ background: '#fff8d4', color: '#a34e00', border: '1px solid #f0d878', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{okNote}</div>}

      {preview.already_sent && (
        <div style={{ padding: 10, background: '#fff8d4', border: '1px solid #f0d878', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          Diese AB wurde bereits versandt an <strong>{preview.sent_to}</strong> am {new Date(preview.sent_at).toLocaleString('de-DE')} — erneuter Versand aktualisiert den Empfänger.
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

export function BillingModal({ offer, onClose, onChanged }) {
  const [dup, setDup] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [hires, setHires] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [adBudget, setAdBudget] = useState('');
  const [hireModal, setHireModal] = useState(null); // { hire, preview } für Erfassungs-Modal
  const [waiveOverride, setWaiveOverride] = useState(false);
  const [waiveNote, setWaiveNote] = useState('');

  useEffect(() => {
    if (!offer) return;
    setErr(''); setDup(null); setInvoices([]); setHires([]);
    setAdBudget(offer.ad_budget_monthly ? String(offer.ad_budget_monthly) : '0');
    setWaiveOverride(!!offer.service_waived_override);
    setWaiveNote(offer.service_waived_note || '');
    Promise.all([
      api(`/invoices/offer/${offer.id}/dup-check`).catch(() => ({ duplicate: false })),
      api(`/invoices?offer_id=${offer.id}`).catch(() => ({ invoices: [] })),
      api(`/hires?offer_id=${offer.id}`).catch(() => ({ hires: [] })),
    ]).then(([d, list, h]) => {
      setDup(d);
      setInvoices(list.invoices || []);
      setHires(h.hires || []);
    });
  }, [offer?.id]);

  if (!offer) return null;

  const setupInv = invoices.find(i => i.invoice_type === 'setup' && i.status !== 'cancelled');
  const billingActive = !!offer.campaign_started_at;
  const billingEnded  = !!offer.billing_ended_at;
  const billingPaused = !!offer.billing_paused_at;
  const isTalentOne   = offer.brand === 'talentone';

  // Garantie-Phase & Countdown
  const guaranteeDays = Number(offer.guarantee_period_days || 30);
  const start = offer.campaign_started_at ? new Date(offer.campaign_started_at) : null;
  const cutoff = start ? new Date(start.getTime() + guaranteeDays * 86400000) : null;
  const now = new Date();
  const withinGuarantee = start && now <= cutoff;
  const daysSinceStart = start ? Math.floor((now - start) / 86400000) + 1 : null;
  const hasHire = hires.length > 0;

  let phaseBanner = null;
  if (billingEnded)               phaseBanner = { label: `Abrechnung beendet am ${new Date(offer.billing_ended_at).toLocaleDateString('de-DE')}`, color: '#5a5955', bg: 'var(--gray-100)' };
  else if (!billingActive)        phaseBanner = { label: 'Monatliche Abrechnung noch nicht aktiviert', color: '#5a5955', bg: 'var(--gray-100)' };
  else if (hasHire)               phaseBanner = { label: `Einstellung(en) erfasst — reguläre Abrechnung`, color: '#0a8043', bg: '#e0f5df' };
  else if (billingPaused)         phaseBanner = { label: `Servicefrei-Monat aufgebraucht — Team muss manuell reaktivieren`, color: '#b91c1c', bg: '#fde0e0' };
  else if (withinGuarantee)       phaseBanner = { label: `Garantiefrist läuft (Tag ${daysSinceStart} von ${guaranteeDays})`, color: '#0068a3', bg: '#e0f5ff' };
  else                            phaseBanner = { label: `Garantiefrist erreicht — ab dem nächsten Lauf servicefrei`, color: '#a34e00', bg: '#fff2d4' };

  async function runSetup() {
    setErr(''); setBusy('setup');
    try {
      await api('/invoices/setup', { method: 'POST', body: { offer_id: offer.id } });
      onChanged();
    } catch (e) { setErr(e.message); setBusy(''); }
  }
  async function runActivateMonthly() {
    setErr(''); setBusy('monthly');
    try {
      await api('/invoices/monthly/activate', { method: 'POST', body: { offer_id: offer.id } });
      onChanged();
    } catch (e) { setErr(e.message); setBusy(''); }
  }
  async function runStopMonthly() {
    if (!window.confirm('Monatliche Abrechnung wirklich stoppen? Auch die servicefreie Nachleistung endet.')) return;
    setErr(''); setBusy('stop');
    try {
      await api('/invoices/monthly/stop', { method: 'POST', body: { offer_id: offer.id } });
      onChanged();
    } catch (e) { setErr(e.message); setBusy(''); }
  }
  async function runReactivate() {
    setErr(''); setBusy('reactivate');
    try {
      await api('/invoices/monthly/reactivate', { method: 'POST', body: { offer_id: offer.id } });
      onChanged();
    } catch (e) { setErr(e.message); setBusy(''); }
  }
  async function toggleWaiveOverride(active) {
    if (active) {
      const n = window.prompt('Notiz zur Kulanz (Pflicht):', '');
      if (!n || !n.trim()) return;
      setErr(''); setBusy('waive');
      try {
        await api('/invoices/monthly/waive-override', {
          method: 'POST', body: { offer_id: offer.id, active: true, note: n.trim() },
        });
        onChanged();
      } catch (e) { setErr(e.message); setBusy(''); }
    } else {
      setErr(''); setBusy('waive');
      try {
        await api('/invoices/monthly/waive-override', {
          method: 'POST', body: { offer_id: offer.id, active: false },
        });
        onChanged();
      } catch (e) { setErr(e.message); setBusy(''); }
    }
  }
  async function openHireModal(hiredAtDefault = null) {
    setBusy('hire-open');
    try {
      const q = new URLSearchParams({ offer_id: offer.id });
      if (hiredAtDefault) q.set('hired_at', hiredAtDefault);
      const preview = await api(`/hires/preview?${q.toString()}`);
      setHireModal({ offer_id: offer.id, preview, hired_at: hiredAtDefault || new Date().toISOString().slice(0, 10) });
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }
  async function deleteHire(id) {
    if (!window.confirm('Diese Einstellung wirklich löschen? Wenn es die letzte ist, kann die servicefreie Logik wieder greifen.')) return;
    setErr('');
    try {
      await api(`/hires/${id}`, { method: 'DELETE' });
      const h = await api(`/hires?offer_id=${offer.id}`);
      setHires(h.hires || []);
    } catch (e) { setErr(e.message); }
  }
  async function runUpdateBudget() {
    const raw = String(adBudget ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) return setErr('Betrag ungültig.');
    if (n !== 0) {
      if (n < 300)     return setErr('Werbebudget muss mindestens 300 € betragen.');
      if (n > 5000)    return setErr('Werbebudget darf höchstens 5.000 € betragen.');
      if (n % 50 !== 0) return setErr('Werbebudget muss ein Vielfaches von 50 € sein.');
    }
    setErr(''); setBusy('budget');
    try {
      await api('/invoices/ad-budget', { method: 'POST', body: { offer_id: offer.id, new_amount: n } });
      onChanged();
    } catch (e) { setErr(e.message); setBusy(''); }
  }

  return (
    <Modal open={!!offer} onClose={onClose} title={`Abrechnung — ${offer.customer_snapshot?.company_name || '—'}`}>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
        Marke: <strong>{offer.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne'}</strong> ·
        Monat 1: <strong>{eur.format(Number(offer.first_month_total || 0))}</strong> ·
        Monatlich: <strong>{eur.format(Number(offer.monthly_total || 0))}</strong>
      </p>

      {/* Setup-Rechnung */}
      <section style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>1. Setup-Rechnung</div>
        {setupInv ? (
          <div style={{ fontSize: 13 }}>
            ✓ Bereits erstellt: <strong>{eur.format(Number(setupInv.amount_gross))}</strong> · Status: <strong>{setupInv.status}</strong>
            {setupInv.easybill_document_id && <> · <a href={`/api/invoices/${setupInv.id}/pdf`} target="_blank" rel="noreferrer">📄 PDF</a></>}
          </div>
        ) : dup?.duplicate ? (
          <div style={{ fontSize: 13, color: '#a34e00' }}>
            ⚠ In easybill existiert bereits eine Rechnung mit ref_id auf dieses Angebot
            {dup.source === 'easybill' && dup.doc?.number && <> (Nr. {dup.doc.number})</>}. Der Button wird deaktiviert — bitte in easybill oder in der Liste weiter verwalten.
            <button className="btn-primary btn-sm" disabled style={{ display: 'block', marginTop: 8 }}>Setup-Rechnung erstellen</button>
          </div>
        ) : (
          <button className="btn-primary btn-sm" onClick={runSetup} disabled={busy === 'setup'}>
            {busy === 'setup' ? 'Erstelle…' : 'Setup-Rechnung erstellen'}
          </button>
        )}
      </section>

      {/* Phasen-Banner */}
      {phaseBanner && (
        <div style={{ padding: '10px 14px', background: phaseBanner.bg, color: phaseBanner.color, borderRadius: 10, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          {phaseBanner.label}
        </div>
      )}

      {/* Monatliche Abrechnung */}
      <section style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>2. Monatliche Abrechnung</div>
        {billingEnded ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Beendet am {new Date(offer.billing_ended_at).toLocaleDateString('de-DE')}.
          </div>
        ) : !billingActive ? (
          <button className="btn-primary btn-sm" onClick={runActivateMonthly} disabled={busy === 'monthly'}>
            {busy === 'monthly' ? 'Aktiviere…' : 'Monatliche Abrechnung aktivieren'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Aktiv seit {new Date(offer.campaign_started_at).toLocaleDateString('de-DE')} · Garantie {guaranteeDays}d
            </div>
            {billingPaused && (
              <button className="btn-primary btn-sm" onClick={runReactivate} disabled={busy === 'reactivate'}>
                {busy === 'reactivate' ? 'Reaktiviere…' : '▶ Servicepauschale wieder aktivieren'}
              </button>
            )}
            <button className="btn-ghost btn-sm" onClick={runStopMonthly} disabled={busy === 'stop'}>
              {busy === 'stop' ? 'Stoppe…' : 'Beenden'}
            </button>
          </div>
        )}
      </section>

      {/* Einstellungen */}
      {billingActive && (
        <section style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              3. Einstellungen · <strong style={{ color: 'var(--ink)' }}>{hires.length} von {offer.hires_target || 1}</strong>
            </div>
            <button className="btn-primary btn-sm" onClick={() => openHireModal()} disabled={busy === 'hire-open'}>
              {busy === 'hire-open' ? 'Lade…' : '+ Einstellung erfassen'}
            </button>
          </div>
          {hires.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Noch keine Einstellung erfasst.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {hires.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#fff', borderRadius: 8, fontSize: 13 }}>
                  <div>
                    <strong>{h.position || '—'}</strong>
                    <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{new Date(h.hired_at).toLocaleDateString('de-DE')}</span>
                    {h.mail_sent_at ? (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#0a8043' }}>✓ Mail an {h.mail_sent_to}</span>
                    ) : (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-4)' }}>keine Mail</span>
                    )}
                  </div>
                  <button className="btn-ghost btn-sm" onClick={() => deleteHire(h.id)}>Löschen</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Kulanz-Schalter */}
      {billingActive && (
        <section style={{ padding: 14, background: '#fff8d4', border: '1px solid #f0d878', borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#a34e00', marginBottom: 6 }}>
            ⚠ Ausnahme: Kulanz-Schalter
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={waiveOverride} disabled={busy === 'waive'}
              onChange={e => toggleWaiveOverride(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Servicefrei trotz laufender Garantiefrist</span>
          </label>
          {offer.service_waived_note && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
              Notiz: „{offer.service_waived_note}"
            </div>
          )}
        </section>
      )}

      {/* Werbebudget — nur TalentOne */}
      {isTalentOne && (
        <section style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>4. Werbebudget</div>
          <AdBudgetChips value={adBudget} onChange={setAdBudget} />
          <div style={{ marginTop: 10 }}>
            <button className="btn-primary btn-sm" onClick={runUpdateBudget} disabled={busy === 'budget'}>
              {busy === 'budget' ? 'Speichere…' : 'Ändern'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: '6px 0 0' }}>Änderung wirkt ab der nächsten monatlichen Rechnung — die laufende Periode bleibt unberührt. Historie wird geführt.</p>
        </section>
      )}

      <HireModal
        state={hireModal}
        onClose={() => setHireModal(null)}
        onSaved={() => {
          setHireModal(null);
          api(`/hires?offer_id=${offer.id}`).then(h => setHires(h.hires || []));
          onChanged();
        }}
      />
    </Modal>
  );
}

function HireModal({ state, onClose, onSaved }) {
  const [hiredAt, setHiredAt] = useState('');
  const [position, setPosition] = useState('');
  const [note, setNote] = useState('');
  const [sendMail, setSendMail] = useState(true);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!state) return;
    setHiredAt(state.hired_at || new Date().toISOString().slice(0, 10));
    setPosition('');
    setNote('');
    setSendMail(true);
    setTo(state.preview?.default_to || '');
    setSubject(state.preview?.subject || '');
    setBody(state.preview?.body || '');
    setErr('');
  }, [state?.hired_at, state?.preview?.body_key]);

  if (!state) return null;

  async function save() {
    setErr('');
    if (!hiredAt) return setErr('Datum ist Pflicht.');
    if (sendMail) {
      if (!to || !/.+@.+\..+/.test(to)) return setErr('Empfänger-E-Mail ungültig.');
      if (!subject.trim()) return setErr('Betreff fehlt.');
      if (!body.trim())    return setErr('Text fehlt.');
    }
    setBusy(true);
    try {
      await api('/hires/record-and-mail', {
        method: 'POST',
        body: {
          offer_id: state.offer_id,
          position, hired_at: hiredAt, note,
          send_mail: sendMail, to, subject, body,
        },
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!state} onClose={onClose}
      title="Einstellung erfassen"
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Speichere…' : sendMail ? '✉︎ Speichern & senden' : 'Speichern'}
        </button>
      </>}
    >
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Datum</span>
            <input type="date" value={hiredAt} onChange={e => setHiredAt(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Position</span>
            <input type="text" value={position} onChange={e => setPosition(e.target.value)}
              placeholder="z.B. Servicetechniker"
              style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Notiz (optional)</span>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: 8 }}>
          <input type="checkbox" checked={sendMail} onChange={e => setSendMail(e.target.checked)} />
          <span style={{ fontSize: 13 }}>Bestätigungs-Mail an Kunden senden <span style={{ color: 'var(--ink-4)' }}>(Absender: angebote@…)</span></span>
        </label>
        {sendMail && (
          <>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Empfänger</span>
              <input type="email" value={to} onChange={e => setTo(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Betreff</span>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Nachricht (Merge-Tags bereits aufgelöst)</span>
              <textarea rows={12} value={body} onChange={e => setBody(e.target.value)}
                style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, lineHeight: 1.55, fontFamily: 'inherit' }} />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

export function DeclineModal({ offer, onClose, onDeclined }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (offer) { setNote(''); setErr(''); } }, [offer?.id]);
  if (!offer) return null;

  async function submit() {
    setErr('');
    if (!note.trim()) return setErr('Notiz ist Pflicht.');
    setBusy(true);
    try {
      await api(`/offers/${offer.id}/decline`, { method: 'POST', body: { note: note.trim() } });
      onDeclined();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!offer} onClose={onClose}
      title={`Angebot ablehnen — ${offer.customer_snapshot?.company_name || '—'}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'Speichere…' : 'Als abgelehnt markieren'}
        </button>
      </>}
    >
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>
        Der Status wird auf <strong>declined</strong> gesetzt. Die Notiz ist Pflicht — sie erklärt, warum das Angebot nicht angenommen wurde (z.B. „Budget zu hoch", „Kunde entschied sich für Alternative").
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>Grund der Ablehnung</span>
        <textarea rows={5} value={note} onChange={e => setNote(e.target.value)}
          placeholder="z.B. Kunde hat sich für einen Wettbewerber entschieden."
          style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
      </label>
    </Modal>
  );
}

// Baut den Body zusammen — Flyer-Absatz wird vor die letzte Absatzeinheit
// (in der Regel die Grußformel) eingefügt.
function composeBody(baseBody, flyerParagraph, withFlyer) {
  const clean = String(baseBody || '').trim();
  if (!withFlyer || !flyerParagraph?.trim()) return clean;
  const paragraphs = clean.split(/\n\s*\n/);
  if (paragraphs.length < 2) return clean + '\n\n' + flyerParagraph.trim();
  // vor dem letzten Absatz einfügen
  const last = paragraphs.pop();
  return paragraphs.join('\n\n') + '\n\n' + flyerParagraph.trim() + '\n\n' + last;
}

// Manipuliert im AB-Body den „So geht es weiter"-Absatz und schiebt optional
// einen Formular-Absatz vor „Die Setup-Rechnung..." bzw. „Die Setup-Rechnung
// folgt separat.". Die Sätze zur Setup-Rechnung/Zahlungseingang bleiben
// unverändert, ebenso die Grußformel.
export function composeOrderBody(baseBody, { terminSet, terminIso, formularOption, formularLink }) {
  let text = String(baseBody || '').trim();
  const paragraphs = text.split(/\n\s*\n/);

  // Absatz mit „So geht es weiter" finden und ggf. ersetzen
  const naechsteIdx = paragraphs.findIndex(p => /^So geht es weiter/i.test(p.trim()));
  if (naechsteIdx >= 0 && terminSet && terminIso) {
    paragraphs[naechsteIdx] = `Ihr Onboarding-Termin steht bereits: ${formatDeDateTime(terminIso)}. Bis dahin schalten wir Sie im Kunden-Portal frei.`;
  }

  // Formular-Absatz
  let formSatz = null;
  if (formularOption === 'link' && formularLink) {
    formSatz = `Um direkt zu starten, füllen Sie gern vorab unser Onboarding-Formular aus: ${formularLink}`;
  } else if (formularOption === 'separat') {
    formSatz = 'Unser Onboarding-Formular erhalten Sie in einer separaten E-Mail.';
  }
  if (formSatz) {
    // Vor „Die Setup-Rechnung..." einfügen; sonst vor letztem Absatz.
    const setupIdx = paragraphs.findIndex(p => /^Die Setup-Rechnung/i.test(p.trim()));
    const insertAt = setupIdx >= 0 ? setupIdx : Math.max(0, paragraphs.length - 1);
    paragraphs.splice(insertAt, 0, formSatz);
  }

  return paragraphs.join('\n\n');
}

function formatDeDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hasTime = iso.length > 10;
  return d.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }) + (hasTime ? ' Uhr' : '');
}
