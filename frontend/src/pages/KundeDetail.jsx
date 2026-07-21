import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { fileToBase64, downloadFromUrl } from '../lib/files.js';
import { getBrandBaseUrl } from '../lib/branding.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Lightbox from '../components/Lightbox.jsx';
import MultiPhotoUpload from '../components/MultiPhotoUpload.jsx';
import NewProjectModal from '../components/NewProjectModal.jsx';
import CloseLeadWarnung from '../components/CloseLeadWarnung.jsx';
import TerminEinladungModal from '../components/TerminEinladungModal.jsx';
import StandaloneAdBudgetModal from '../components/StandaloneAdBudgetModal.jsx';
import AnredeAbfrage from '../components/AnredeAbfrage.jsx';
import { anredeLabel, anredeOffen } from '../lib/anrede.js';
import InvoicesSection, { SendInvoiceMailModal } from '../components/InvoicesSection.jsx';
import { ItemBadge } from '../components/NaechsterSchrittBadge.jsx';
import { SendOfferModal, SendOrderModal, BillingModal, DeclineModal, PHASE_META } from './OffersList.jsx';

const ANFRAGE_TEXTE = {
  beides: `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür ein paar Materialien von euch. Über den unten stehenden Link könnt ihr ganz einfach euer Logo und Fotos vom Team / Arbeitsplatz hochladen.`,
  logo: `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür noch euer Logo. Über den unten stehenden Link könnt ihr es ganz einfach hochladen.`,
  fotos: `wir bereiten gerade eure Recruiting-Kampagne vor und brauchen dafür noch ein paar Fotos vom Team / Arbeitsplatz. Über den unten stehenden Link könnt ihr sie ganz einfach hochladen.`,
};
const ANFRAGE_DEFAULT_TEXTE = new Set(Object.values(ANFRAGE_TEXTE));
const DEFAULT_ANFRAGE = ANFRAGE_TEXTE.beides;

export default function KundeDetail() {
  const { kundeId } = useParams();
  const [kunde, setKunde] = useState(null);
  const [avv, setAvv] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const [showAnrede, setShowAnrede] = useState(false);
  const [showAnfrage, setShowAnfrage] = useState(false);
  const [showTermin, setShowTermin] = useState(false);
  const [anfrageUmfang, setAnfrageUmfang] = useState('beides'); // beides | logo | fotos
  const [anfrageText, setAnfrageText] = useState(DEFAULT_ANFRAGE);
  const [anfrageBusy, setAnfrageBusy] = useState(false);
  const [anfrageMsg, setAnfrageMsg] = useState('');

  const [referenzbilder, setReferenzbilder] = useState([]);
  const [refLightboxIndex, setRefLightboxIndex] = useState(null);

  // Archivieren + Löschen
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null); // { preview, typedName, busy, error } | null

  async function archiveKunde() {
    if (!confirm(`"${kunde?.firmenname || 'Diesen Kunden'}" archivieren? Der Kunde verschwindet aus der Liste, alle Daten bleiben erhalten.`)) return;
    setArchiveBusy(true);
    try {
      const res = await api(`/kunden/${kundeId}/archivieren`, { method: 'POST' });
      setKunde(res.kunde);
    } catch (err) { alert(err.message); }
    finally { setArchiveBusy(false); }
  }
  async function unarchiveKunde() {
    setArchiveBusy(true);
    try {
      const res = await api(`/kunden/${kundeId}/wiederherstellen`, { method: 'POST' });
      setKunde(res.kunde);
    } catch (err) { alert(err.message); }
    finally { setArchiveBusy(false); }
  }
  async function openDeleteModal() {
    setDeleteModal({ preview: null, typedName: '', busy: true, error: '' });
    try {
      const res = await api(`/kunden/${kundeId}/loeschen-vorschau`);
      setDeleteModal({ preview: res, typedName: '', busy: false, error: '' });
    } catch (err) {
      setDeleteModal({ preview: null, typedName: '', busy: false, error: err.message });
    }
  }
  async function confirmDelete() {
    if (!deleteModal?.preview) return;
    setDeleteModal(m => ({ ...m, busy: true, error: '' }));
    try {
      await api(`/kunden/${kundeId}`, {
        method: 'DELETE',
        body: { firmenname_confirm: deleteModal.typedName },
      });
      alert(`"${deleteModal.preview.firmenname}" wurde vollständig gelöscht.`);
      window.location.href = '/kunden';
    } catch (err) {
      setDeleteModal(m => ({ ...m, busy: false, error: err.message }));
    }
  }

  // Rechnungen (alle talentone_invoices dieses Kunden)
  const [invoices, setInvoices] = useState([]);
  const [invoicesBusy, setInvoicesBusy] = useState(false);
  const [invoicesSyncing, setInvoicesSyncing] = useState(false);
  const [showAdBudgetModal, setShowAdBudgetModal] = useState(false);
  const [sendInvoiceModal, setSendInvoiceModal] = useState(null);

  // Angebote & Aufträge des Kunden + Aktivitäten-Timeline
  const [offers, setOffers] = useState([]);
  const [verwaisteAngebote, setVerwaisteAngebote] = useState([]);
  const [linkBusyId, setLinkBusyId] = useState(null);
  const [activity, setActivity] = useState([]);
  const [projekte, setProjekte] = useState([]);
  const [schritteItems, setSchritteItems] = useState([]);
  const [sendOfferPreview, setSendOfferPreview] = useState(null);
  const [sendOrderPreview, setSendOrderPreview] = useState(null);
  const [billingOffer, setBillingOffer] = useState(null);
  const [declineOffer, setDeclineOffer] = useState(null);

  // Farben (lokaler Edit-State, mit Speichern-Button)
  const [farben, setFarben] = useState({ primaer: '', sekundaer: '', akzent: '' });
  const [farbenDirty, setFarbenDirty] = useState(false);
  const [farbenBusy, setFarbenBusy] = useState(false);
  const [farbenMsg, setFarbenMsg] = useState('');

  // Logo-Upload
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);

  // Kontakt-Edit
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    firmenname: '', ansprechpartner: '', email: '', telefon: '',
    branche: '', agentur: 'talentone', notizen: '', close_lead_id: '',
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState('');

  function startEdit() {
    setEditForm({
      firmenname: kunde?.firmenname || '',
      ansprechpartner: kunde?.ansprechpartner || '',
      email: kunde?.email || '',
      telefon: kunde?.telefon || '',
      branche: kunde?.branche || '',
      agentur: kunde?.agentur || 'talentone',
      notizen: kunde?.notizen || '',
      close_lead_id: kunde?.close_lead_id || '',
    });
    setEditMode(true);
    setEditMsg('');
  }
  function cancelEdit() { setEditMode(false); setEditMsg(''); }
  async function saveEdit() {
    setEditBusy(true); setEditMsg('');
    try {
      const closeLead = editForm.close_lead_id.trim();
      if (closeLead && !closeLead.startsWith('lead_')) {
        setEditMsg('Close Lead ID muss mit lead_ beginnen.');
        setEditBusy(false); return;
      }
      const res = await api(`/kunden/${kundeId}`, {
        method: 'PATCH',
        body: {
          firmenname: editForm.firmenname.trim(),
          ansprechpartner: editForm.ansprechpartner.trim() || null,
          email: editForm.email.trim() || null,
          telefon: editForm.telefon.trim() || null,
          branche: editForm.branche.trim() || null,
          agentur: editForm.agentur || 'talentone',
          notizen: editForm.notizen.trim() || null,
          close_lead_id: closeLead || null,
        },
      });
      setKunde(res.kunde);
      setEditMode(false);
    } catch (err) {
      setEditMsg(err.message);
    } finally {
      setEditBusy(false);
    }
  }

  // Website-URL + Farb-Extraktion (Preview)
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteUrlDirty, setWebsiteUrlDirty] = useState(false);
  const [websiteUrlBusy, setWebsiteUrlBusy] = useState(false);
  const [extractBusy, setExtractBusy] = useState(null); // 'logo' | 'url' | null
  const [farbenPreview, setFarbenPreview] = useState(null); // { source, farben } | null
  const [extractError, setExtractError] = useState('');

  async function downloadKundenLogo(k) {
    if (!k?.logo_url) return;
    try {
      const originalName = decodeURIComponent(k.logo_url.split('/').pop() || '').split('?')[0];
      const ext = (originalName.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0];
      const slug = (k.firmenname || 'logo').toString().normalize('NFKD')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'logo';
      await downloadFromUrl(k.logo_url, `${slug}-logo${ext}`);
    } catch (err) { alert('Download fehlgeschlagen: ' + err.message); }
  }

  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoUploading(true);
    try {
      const fileData = await fileToBase64(file);
      const res = await api(`/kunden/${kundeId}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      setKunde(res.kunde);
      if (res.kunde.farben) {
        setFarben({
          primaer:   res.kunde.farben.primaer   || '',
          sekundaer: res.kunde.farben.sekundaer || '',
          akzent:    res.kunde.farben.akzent    || '',
        });
        setFarbenDirty(false);
      }
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoUploading(false);
    }
  }

  function load() {
    setLoading(true);
    Promise.all([api(`/kunden/${kundeId}`), api(`/jobs?kunde_id=${kundeId}`)])
      .then(([k, j]) => {
        setKunde(k.kunde);
        setAvv(k.avv || null);
        setJobs(j.jobs || []);
        setFarben({
          primaer:   k.kunde?.farben?.primaer   || '',
          sekundaer: k.kunde?.farben?.sekundaer || '',
          akzent:    k.kunde?.farben?.akzent    || '',
        });
        setFarbenDirty(false);
        setWebsiteUrl(k.kunde?.website_url || '');
        setWebsiteUrlDirty(false);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadInvoices() {
    setInvoicesBusy(true);
    api(`/invoices?customer_id=${kundeId}`)
      .then(res => setInvoices(res.invoices || []))
      .catch(() => setInvoices([]))
      .finally(() => setInvoicesBusy(false));
  }

  function loadOffers() {
    api(`/offers?customer_id=${kundeId}`)
      .then(res => setOffers(res.offers || []))
      .catch(() => setOffers([]));
    api(`/kunden/${kundeId}/verwaiste-angebote`)
      .then(res => setVerwaisteAngebote(res.angebote || []))
      .catch(() => setVerwaisteAngebote([]));
  }

  async function linkOrphan(offer) {
    setLinkBusyId(offer.id);
    try {
      await api(`/offers/${offer.id}/link-customer`, { method: 'POST', body: { customer_id: kundeId } });
      loadOffers();
    } catch (e) { alert(e.message); }
    finally { setLinkBusyId(null); }
  }
  function loadActivity() {
    api(`/kunden/${kundeId}/activity`)
      .then(res => setActivity(res.activity || []))
      .catch(() => setActivity([]));
  }
  function loadProjekte() {
    api(`/projekte?kunde_id=${kundeId}`)
      .then(res => setProjekte(res.projekte || []))
      .catch(() => setProjekte([]));
    // Naechste-Schritte-Badges pro Job des Kunden nachladen
    api(`/kunden/naechste-schritte?ids=${kundeId}`)
      .then(r => setSchritteItems((r.schritte || {})[kundeId] || []))
      .catch(() => setSchritteItems([]));
  }

  async function syncInvoicesNow() {
    setInvoicesSyncing(true);
    try {
      await api('/invoices/sync', { method: 'POST' });
      loadInvoices();
      // Ampel-Status am Kunden refreshen
      const k = await api(`/kunden/${kundeId}`);
      setKunde(k.kunde);
    } catch (e) { alert('Sync fehlgeschlagen: ' + e.message); }
    finally { setInvoicesSyncing(false); }
  }

  async function saveWebsiteUrl() {
    setWebsiteUrlBusy(true);
    try {
      const res = await api(`/kunden/${kundeId}`, {
        method: 'PATCH',
        body: { website_url: websiteUrl.trim() || null },
      });
      setKunde(res.kunde);
      setWebsiteUrlDirty(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setWebsiteUrlBusy(false);
    }
  }

  async function extractFromLogo() {
    setExtractBusy('logo');
    setExtractError('');
    setFarbenPreview(null);
    try {
      const res = await api(`/kunden/${kundeId}/farben/from-logo`, { method: 'POST' });
      if (!res.farben) throw new Error('Aus dem Logo konnten keine Farben ermittelt werden.');
      setFarbenPreview({ source: 'logo', farben: res.farben });
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtractBusy(null);
    }
  }

  async function extractFromUrl() {
    if (!websiteUrl.trim()) {
      setExtractError('Bitte zuerst eine Website-URL eintragen.');
      return;
    }
    setExtractBusy('url');
    setExtractError('');
    setFarbenPreview(null);
    try {
      // Speichere zuerst die URL, falls geändert
      if (websiteUrlDirty) await saveWebsiteUrl();
      const res = await api(`/kunden/${kundeId}/farben/from-url`, {
        method: 'POST', body: { url: websiteUrl.trim() },
      });
      if (!res.farben) throw new Error('Aus der Website konnten keine Farben ermittelt werden.');
      setFarbenPreview({ source: 'url', farben: res.farben });
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtractBusy(null);
    }
  }

  function applyPreview() {
    if (!farbenPreview?.farben) return;
    const f = farbenPreview.farben;
    setFarben({
      primaer:   f.primaer   || '',
      sekundaer: f.sekundaer || '',
      akzent:    f.akzent    || '',
    });
    setFarbenDirty(true);
    setFarbenPreview(null);
  }

  // Farben separat polling — bei Quick-Create aus URL kommen die Farben asynchron rein.
  useEffect(() => {
    if (!kunde) return;
    if (kunde.farben?.primaer) return;
    const start = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - start > 60_000) { clearInterval(t); return; }
      try {
        const k = await api(`/kunden/${kundeId}`);
        if (k.kunde?.farben?.primaer) {
          clearInterval(t);
          setKunde(k.kunde);
          setFarben({
            primaer:   k.kunde.farben.primaer   || '',
            sekundaer: k.kunde.farben.sekundaer || '',
            akzent:    k.kunde.farben.akzent    || '',
          });
        }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunde?.id]);

  function updateFarbe(key, value) {
    setFarben(prev => ({ ...prev, [key]: value }));
    setFarbenDirty(true);
  }

  async function saveFarben() {
    setFarbenBusy(true);
    setFarbenMsg('');
    try {
      const payload = {
        primaer:   farben.primaer.trim()   || null,
        sekundaer: farben.sekundaer.trim() || null,
        akzent:    farben.akzent.trim()    || null,
      };
      const allEmpty = !payload.primaer && !payload.sekundaer && !payload.akzent;
      const res = await api(`/kunden/${kundeId}`, {
        method: 'PATCH',
        body: { farben: allEmpty ? null : payload },
      });
      setKunde(res.kunde);
      setFarbenDirty(false);
      setFarbenMsg('Gespeichert.');
      setTimeout(() => setFarbenMsg(''), 2000);
    } catch (err) {
      setFarbenMsg(err.message);
    } finally {
      setFarbenBusy(false);
    }
  }

  useEffect(() => { load(); loadInvoices(); loadOffers(); loadActivity(); loadProjekte(); }, [kundeId]);

  useEffect(() => {
    api(`/kunden/${kundeId}/referenzbilder`)
      .then(res => setReferenzbilder(res.referenzbilder || []))
      .catch(() => {});
  }, [kundeId]);

  // Umfang wechseln: den Standard-Text mitziehen, solange der Nutzer den Text
  // nicht selbst angepasst hat (aktueller Text ist noch einer der Defaults).
  function changeAnfrageUmfang(next) {
    setAnfrageUmfang(next);
    setAnfrageText(prev => ANFRAGE_DEFAULT_TEXTE.has(prev.trim()) ? ANFRAGE_TEXTE[next] : prev);
  }

  async function sendAnfrage() {
    setAnfrageBusy(true);
    setAnfrageMsg('');
    try {
      await api(`/kunden/${kundeId}/anfrage`, { method: 'POST', body: { customText: anfrageText, umfang: anfrageUmfang } });
      setAnfrageMsg(`Mail an ${kunde.email} verschickt.`);
      setTimeout(() => { setShowAnfrage(false); setAnfrageMsg(''); }, 1500);
    } catch (err) {
      setAnfrageMsg(err.message);
    } finally {
      setAnfrageBusy(false);
    }
  }

  if (loading) return <div className="card empty">Lade…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!kunde) return <div className="card empty"><h2>Kunde nicht gefunden</h2></div>;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/kunden">Kunden</Link>
        <span aria-hidden>›</span>
        <span>{kunde.firmenname}</span>
      </div>

      <CampaignPaymentBanner
        status={kunde.campaign_payment_status}
        kundeId={kunde.id}
      />

      <div className="kunde-head">
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={`kunde-head-logo ${kunde.logo_url ? 'has-image' : ''} is-clickable`}
            onClick={() => !logoUploading && logoInputRef.current?.click()}
            title={kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen'}
            aria-label={kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen'}
          >
            {kunde.logo_url
              ? <img src={kunde.logo_url} alt="" />
              : <span>{(kunde.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
            <span className="kunde-head-logo-edit">{logoUploading ? '…' : 'Ändern'}</span>
          </button>
          {kunde.logo_url && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); downloadKundenLogo(kunde); }}
              title="Logo in Originalqualität herunterladen"
              aria-label="Logo herunterladen"
              style={{
                position: 'absolute', top: -4, right: -4, width: 26, height: 26,
                border: '1px solid var(--line)', background: 'var(--ink)',
                color: '#fff', borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >⬇</button>
          )}
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: 'none' }}
          onChange={onLogoChange}
        />
        <div className="kunde-head-body">
          {!editMode ? (
            <>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>{kunde.firmenname || '—'}</span>
                {(() => {
                  const formularJob = jobs.find(j => j.eingabe_methode === 'formular');
                  if (!formularJob) return null;
                  const datum = new Date(formularJob.created_at).toLocaleDateString('de-DE');
                  return (
                    <span title={`Kunde hat das Briefing-Formular am ${new Date(formularJob.created_at).toLocaleString('de-DE')} eigenständig ausgefüllt.`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: '#dcfce7', color: '#166534',
                        padding: '3px 10px', borderRadius: 100,
                        fontSize: 12, fontWeight: 600,
                      }}>✅ Formular ausgefüllt · {datum}</span>
                  );
                })()}
                {avv?.annahme ? (
                  <span title={`Auftragsverarbeitungsvertrag akzeptiert von ${avv.annahme.akzeptiert_von || '—'}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: '#dcfce7', color: '#166534',
                      padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                    }}>
                    ✅ AVV akzeptiert am {new Date(avv.annahme.akzeptiert_am).toLocaleDateString('de-DE')} von {avv.annahme.akzeptiert_von || '—'}{avv.annahme.version ? ` (Version ${avv.annahme.version})` : ''}
                  </span>
                ) : (kunde.status === 'aktiv' ? (
                  <span title="Auftragsverarbeitungsvertrag noch nicht akzeptiert"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: '#fef3c7', color: '#92400e',
                      padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                    }}>
                    ⚠️ AVV offen
                  </span>
                ) : null)}
              </h1>
              <div className="kunde-head-meta">
                {kunde.agentur && (
                  <span><strong>Agentur:</strong> {kunde.agentur === 'nowagwirth' ? 'Nowag & Wirth' : 'TalentOne'}</span>
                )}
                {kunde.branche && <span><strong>Branche:</strong> {kunde.branche}</span>}
                {kunde.ansprechpartner && <span><strong>Ansprechpartner:</strong> {kunde.ansprechpartner}</span>}
                <span>
                  <strong>Anrede:</strong>{' '}
                  {anredeLabel(kunde) || <em style={{ color: 'var(--ink-4)' }}>noch nicht festgelegt</em>}{' '}
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAnrede(v => !v)}>
                    {showAnrede ? 'Schließen' : (anredeLabel(kunde) ? 'Ändern' : 'Festlegen')}
                  </button>
                </span>
                {kunde.email && <span><strong>E-Mail:</strong> <a href={`mailto:${kunde.email}`}>{kunde.email}</a></span>}
                {kunde.telefon && <span><strong>Telefon:</strong> {kunde.telefon}</span>}
                <span>
                  <strong>PayPal-Zahlung:</strong>
                  <PaypalToggle
                    kunde={kunde}
                    onChanged={updated => setKunde(k => ({ ...k, paypal_enabled: updated.paypal_enabled }))}
                  />
                </span>
                <span>
                  <strong>KI-Bilder erlaubt:</strong>
                  <KiFreigabeToggle
                    kunde={kunde}
                    onChanged={updated => setKunde(k => ({ ...k, keine_ki_bilder: updated.keine_ki_bilder }))}
                  />
                </span>
              </div>
              {showAnrede && (
                <div style={{ maxWidth: 460 }}>
                  <AnredeAbfrage kunde={kunde} onSaved={k => { setKunde(k); setShowAnrede(false); }} />
                </div>
              )}
              {kunde.notizen && <p className="kunde-head-notes">{kunde.notizen}</p>}
              <div className="kunde-head-actions">
                <button className="btn-ghost btn-sm" onClick={startEdit}>Bearbeiten</button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => !logoUploading && logoInputRef.current?.click()}
                  disabled={logoUploading}
                >
                  {logoUploading
                    ? 'Lade Logo hoch…'
                    : (kunde.logo_url ? 'Logo ersetzen' : 'Logo hochladen')}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setShowAnfrage(true)}
                  title={kunde.email ? '' : 'Kunden-E-Mail fehlt'}
                  disabled={!kunde.email}
                >
                  Fotos & Logo beim Kunden anfragen
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setShowTermin(true)}
                  title={kunde.email ? '' : 'Kunden-E-Mail fehlt'}
                  disabled={!kunde.email}
                >
                  📅 Termin-Einladung senden
                </button>
              </div>
              {kunde.portal_token && (
                <div style={{
                  marginTop: 10, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #86efac',
                  borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: 13,
                }}>
                  <span>🔗</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 700, letterSpacing: 0.05, textTransform: 'uppercase' }}>Kunden-Dashboard-Link</div>
                    <code style={{ fontSize: 11, color: '#0a0a0a', wordBreak: 'break-all' }}>
                      {`${getBrandBaseUrl(kunde.agentur)}/portal/${kunde.portal_token}`}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${getBrandBaseUrl(kunde.agentur)}/portal/${kunde.portal_token}`;
                      navigator.clipboard.writeText(url).then(() => alert('Portal-Link kopiert'));
                    }}
                    className="btn-ghost btn-sm"
                  >Kopieren</button>
                  <a href={`${window.location.origin}/portal/${kunde.portal_token}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" title="Öffnet mit deiner Mitarbeiter-Session (kein Kunden-Login nötig)">
                    Öffnen ↗
                  </a>
                </div>
              )}
              <PortalAccountsSection kunde={kunde} onKundeUpdated={setKunde} />
            </>
          ) : (
            <div className="kunde-edit">
              <div className="form-grid">
                <label className="field field-full">
                  <span>Firmenname</span>
                  <input value={editForm.firmenname} onChange={e => setEditForm({ ...editForm, firmenname: e.target.value })} />
                </label>
                <label className="field">
                  <span>Ansprechpartner</span>
                  <input value={editForm.ansprechpartner} onChange={e => setEditForm({ ...editForm, ansprechpartner: e.target.value })} />
                </label>
                <label className="field">
                  <span>Branche</span>
                  <input value={editForm.branche} onChange={e => setEditForm({ ...editForm, branche: e.target.value })} />
                </label>
                <label className="field">
                  <span>E-Mail</span>
                  <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>Telefon</span>
                  <input value={editForm.telefon} onChange={e => setEditForm({ ...editForm, telefon: e.target.value })} />
                </label>
                <label className="field field-full">
                  <span>Agentur</span>
                  <select value={editForm.agentur} onChange={e => setEditForm({ ...editForm, agentur: e.target.value })}>
                    <option value="talentone">TalentOne</option>
                    <option value="nowagwirth">Nowag & Wirth</option>
                  </select>
                </label>
                <label className="field field-full">
                  <span>Close Lead ID {editForm.agentur === 'nowagwirth' && <em style={{ color: '#dc2626', fontStyle: 'normal' }}>*</em>}</span>
                  <input
                    value={editForm.close_lead_id}
                    onChange={e => setEditForm({ ...editForm, close_lead_id: e.target.value })}
                    placeholder="lead_XXXXX…"
                  />
                  <small style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
                    Du findest die Lead ID in Close: Lead öffnen → die ID steht in der URL — den Teil ab <code>lead_</code> kopieren.
                  </small>
                </label>
                <label className="field field-full">
                  <span>Notizen</span>
                  <textarea rows={2} value={editForm.notizen} onChange={e => setEditForm({ ...editForm, notizen: e.target.value })} />
                </label>
              </div>
              <div className="form-actions">
                {editMsg && <span className="form-msg" style={{ color: 'var(--danger)' }}>{editMsg}</span>}
                <button className="btn-ghost" onClick={cancelEdit} disabled={editBusy}>Abbrechen</button>
                <button className="btn-primary" onClick={saveEdit} disabled={editBusy || !editForm.firmenname.trim()}>
                  {editBusy ? 'Speichere…' : 'Speichern'}
                </button>
              </div>

              {/* Gefahrenzone — Archivieren + Löschen */}
              <div style={{ marginTop: 20, padding: 14, border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 8 }}>
                  ⚠️ Gefahrenzone
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {!kunde?.archiviert ? (
                    <button className="btn-ghost btn-sm" onClick={archiveKunde} disabled={archiveBusy}>
                      {archiveBusy ? '…' : '📦 Kunde archivieren'}
                    </button>
                  ) : (
                    <button className="btn-ghost btn-sm" onClick={unarchiveKunde} disabled={archiveBusy}>
                      {archiveBusy ? '…' : '↩️ Aus Archiv holen'}
                    </button>
                  )}
                  <button className="btn-ghost btn-sm" style={{ color: '#991b1b', borderColor: '#fca5a5' }}
                    onClick={openDeleteModal}>
                    🗑️ Kunde endgültig löschen
                  </button>
                </div>
                <p style={{ fontSize: 11, color: '#7f1d1d', marginTop: 8, marginBottom: 0 }}>
                  Archivieren blendet den Kunden nur aus der Liste, Daten bleiben. Löschen entfernt Kunde + Jobs + Creatives + Bewerbungen + Funnels + Ad Copies + Referenzbilder + Reviews unwiderruflich. Verknüpfte Projekte bleiben in der Projektübersicht als Historie.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="farben-card">
        <div className="farben-head">
          <div>
            <div className="form-section-title" style={{ marginBottom: 4 }}>Markenfarben</div>
            <div className="motiv-sub">Werden im Creative-Prompt für Text, Tags und Akzente verwendet.</div>
          </div>
          {farbenDirty && (
            <button className="btn-primary btn-sm" onClick={saveFarben} disabled={farbenBusy}>
              {farbenBusy ? 'Speichere…' : 'Speichern'}
            </button>
          )}
          {farbenMsg && <span className="form-msg">{farbenMsg}</span>}
        </div>

        {/* Quellen-Sektion */}
        <div className="farb-quellen">
          <div className="farb-quelle">
            <div className="farb-quelle-label">Aus Logo</div>
            <button
              className="btn-ghost btn-sm"
              onClick={extractFromLogo}
              disabled={!kunde.logo_url || extractBusy === 'logo'}
              title={kunde.logo_url ? '' : 'Kein Logo hinterlegt'}
            >
              {extractBusy === 'logo' ? 'Ermittle…' : 'Logo-Farben ermitteln'}
            </button>
          </div>
          <div className="farb-quelle">
            <div className="farb-quelle-label">Aus Karriereseite / Homepage</div>
            <div className="farb-quelle-row">
              <input
                type="url"
                className="farbe-hex"
                placeholder="https://…"
                value={websiteUrl}
                onChange={e => { setWebsiteUrl(e.target.value); setWebsiteUrlDirty(true); }}
                style={{ flex: 1 }}
              />
              <button
                className="btn-ghost btn-sm"
                onClick={extractFromUrl}
                disabled={!websiteUrl.trim() || extractBusy === 'url'}
              >
                {extractBusy === 'url' ? 'Scrape…' : 'Aus URL ermitteln'}
              </button>
            </div>
          </div>
        </div>

        {extractError && <div className="alert alert-error" style={{ marginTop: 12 }}>{extractError}</div>}

        {/* Vorschau aus Quelle */}
        {farbenPreview && (
          <div className="farb-preview">
            <div className="farb-preview-head">
              <strong>Vorschlag aus {farbenPreview.source === 'logo' ? 'Logo' : 'Website'}:</strong>
              <div className="farb-preview-actions">
                <button className="btn-ghost btn-sm" onClick={() => setFarbenPreview(null)}>Verwerfen</button>
                <button className="btn-primary btn-sm" onClick={applyPreview}>Übernehmen</button>
              </div>
            </div>
            <div className="farb-preview-swatches">
              {['primaer', 'sekundaer', 'akzent'].map(k => (
                <div key={k} className="farb-preview-swatch">
                  <span className="swatch-box" style={{ background: farbenPreview.farben[k] || 'transparent' }} />
                  <span className="swatch-hex">{farbenPreview.farben[k] || '–'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="farben-grid" style={{ marginTop: 14 }}>
          {[
            { key: 'primaer',   label: 'Primär' },
            { key: 'sekundaer', label: 'Sekundär' },
            { key: 'akzent',    label: 'Akzent' },
          ].map(({ key, label }) => (
            <div className="farbe-pick" key={key}>
              <span className="farbe-label">{label}</span>
              <div className="farbe-row">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(farben[key]) ? farben[key] : '#cccccc'}
                  onChange={e => updateFarbe(key, e.target.value)}
                  aria-label={`${label} Farbe`}
                />
                <input
                  type="text"
                  className="farbe-hex"
                  placeholder="#rrggbb"
                  value={farben[key]}
                  onChange={e => updateFarbe(key, e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
        {!kunde.farben?.primaer && !farbenDirty && (
          <div className="farben-hint">
            Noch keine Farben hinterlegt — entweder oben aus Logo oder Website ermitteln, oder manuell unten eintragen.
          </div>
        )}
      </div>

      <div className="ref-strip">
        <div className="ref-strip-title">
          {referenzbilder.length > 0
            ? <>Referenzbilder: {referenzbilder.length} Datei{referenzbilder.length === 1 ? '' : 'en'} ({referenzbilder.filter(r => r.uploaded_via === 'kunde').length} vom Kunden)</>
            : <>Noch keine Referenzbilder hinterlegt.</>}
        </div>
        <div className="ref-strip-grid">
          {referenzbilder.slice(0, 12).map((r, i) => (
            <div key={r.id} className="ref-strip-thumb" title={r.beschreibung || r.typ}>
              <button
                type="button"
                onClick={() => setRefLightboxIndex(i)}
                style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'zoom-in', width: '100%', height: '100%' }}
                title="Klick für Groß-Ansicht"
              >
                <img src={r.bild_url} alt="" />
              </button>
              {r.typ === 'logo' && <span className="ref-strip-badge">Logo</span>}
              <button
                type="button"
                className="ref-strip-del"
                title="Löschen"
                onClick={async () => {
                  if (!confirm('Bild wirklich löschen?')) return;
                  try {
                    await api(`/kunden/referenzbilder/${r.id}`, { method: 'DELETE' });
                    setReferenzbilder(prev => prev.filter(x => x.id !== r.id));
                  } catch (err) { alert(err.message); }
                }}
              >×</button>
            </div>
          ))}
          <MultiPhotoUpload
            kundeId={kundeId}
            onUploaded={(rb) => setReferenzbilder(prev => [rb, ...prev])}
            dropZoneClassName="ref-strip-upload"
            trigger={<span>+ Foto(s)<br/><small>Drag &amp; Drop</small></span>}
          />
        </div>
      </div>

      <ProjektStatusRow projekte={projekte} />
      <ProjektInfoCards projekte={projekte} schritteItems={schritteItems} kundeId={kundeId} />

      <div className="section-head">
        <div>
          <h2 className="section-title">Projekte</h2>
          <p className="section-sub">Stellen / Kampagnen für diesen Kunden.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" /> Neues Projekt
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="card empty">
          <h2>Noch keine Projekte</h2>
          <p>Lege das erste Projekt für {kunde.firmenname} an.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {jobs.map(j => (
            <div key={j.id} style={{ position: 'relative' }}>
              <Link to={`/kunden/${kundeId}/jobs/${j.id}`} className="job-card">
                <div className="job-card-name">{j.stelle || 'Unbenanntes Projekt'}</div>
                <div className="job-card-meta">
                  {j.region && <span>{j.region}</span>}
                  {j.gehalt && <span>{j.gehalt}</span>}
                </div>
                <div className="job-card-foot">
                  Angelegt {new Date(j.created_at).toLocaleDateString('de-DE')}
                </div>
              </Link>
              <button
                title="Projekt löschen"
                onClick={async (e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (!confirm(`Projekt "${j.stelle || 'Unbenannt'}" wirklich löschen?\n\nZugehörige Creatives, Ad Copies, Funnel und Bewerbungen werden mitgelöscht. Der Projekt-Eintrag in der Projektübersicht wird ebenfalls entfernt.`)) return;
                  try {
                    await api(`/jobs/${j.id}`, { method: 'DELETE' });
                    load();
                  } catch (err) { alert('Löschen fehlgeschlagen: ' + err.message); }
                }}
                style={{
                  position: 'absolute', top: 8, right: 8, width: 26, height: 26,
                  borderRadius: 6, border: '1px solid #ececea', background: '#fff',
                  color: '#c1272d', fontSize: 15, lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>×</button>
            </div>
          ))}
        </div>
      )}

      {verwaisteAngebote.length > 0 && (
        <div className="card" style={{ borderColor: '#f59e0b', background: '#fffbeb', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            ⚠️ {verwaisteAngebote.length} nicht zugeordnete{verwaisteAngebote.length === 1 ? 's Angebot' : ' Angebote'} gefunden — jetzt verknüpfen?
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
            Diese Angebote passen per E-Mail oder Firmenname zu diesem Kunden, sind aber noch keinem internen Kunden zugeordnet.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {verwaisteAngebote.map(o => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: '#fff', border: '1px solid #fde68a', borderRadius: 8 }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{o.customer_snapshot?.company_name || '—'}</strong>
                  <span style={{ color: 'var(--ink-4)', marginLeft: 8 }}>{o.status} · {new Date(o.created_at).toLocaleDateString('de-DE')}</span>
                </div>
                <button className="btn-primary btn-sm" disabled={linkBusyId === o.id} onClick={() => linkOrphan(o)}>
                  {linkBusyId === o.id ? 'Verknüpfe…' : 'Verknüpfen'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <OffersSection
        kundeId={kundeId}
        offers={offers}
        onOpenBilling={setBillingOffer}
        onOpenDecline={setDeclineOffer}
        onSendOffer={async offer => {
          try {
            const p = await api(`/offers/${offer.id}/email-preview`);
            setSendOfferPreview({ offerId: offer.id, ...p });
          } catch (e) { alert(e.message); }
        }}
        onSendOrder={async offer => {
          try {
            const p = await api(`/offers/${offer.id}/order-email-preview`);
            setSendOrderPreview({ offerId: offer.id, ...p });
          } catch (e) { alert(e.message); }
        }}
      />

      <InvoicesSection
        kunde={kunde}
        invoices={invoices}
        busy={invoicesBusy}
        syncing={invoicesSyncing}
        onSync={syncInvoicesNow}
        onCreateAdBudget={() => setShowAdBudgetModal(true)}
        onSendInvoice={inv => setSendInvoiceModal(inv)}
      />

      <ActivitySection activity={activity} />

      <StandaloneAdBudgetModal
        open={showAdBudgetModal}
        kunde={kunde}
        onClose={() => setShowAdBudgetModal(false)}
        onCreated={inv => {
          setShowAdBudgetModal(false);
          setInvoices(prev => [inv, ...prev]);
          setSendInvoiceModal(inv); // sofort Versand-Option anbieten
        }}
      />

      <SendInvoiceMailModal
        invoice={sendInvoiceModal}
        kunde={kunde}
        onKundeSaved={setKunde}
        onClose={() => setSendInvoiceModal(null)}
        onSent={() => { setSendInvoiceModal(null); loadInvoices(); loadActivity(); }}
      />

      <SendOfferModal
        preview={sendOfferPreview}
        kunde={kunde}
        onKundeSaved={setKunde}
        onClose={() => setSendOfferPreview(null)}
        onSent={() => { setSendOfferPreview(null); loadOffers(); loadActivity(); }}
      />
      <SendOrderModal
        preview={sendOrderPreview}
        kunde={kunde}
        onKundeSaved={setKunde}
        onClose={() => setSendOrderPreview(null)}
        onSent={() => { setSendOrderPreview(null); loadOffers(); loadActivity(); }}
      />
      <BillingModal
        offer={billingOffer}
        onClose={() => setBillingOffer(null)}
        onChanged={() => { setBillingOffer(null); loadOffers(); loadInvoices(); loadActivity(); }}
      />
      <DeclineModal
        offer={declineOffer}
        onClose={() => setDeclineOffer(null)}
        onDeclined={() => { setDeclineOffer(null); loadOffers(); loadActivity(); }}
      />

      <Modal
        open={showAnfrage}
        onClose={() => !anfrageBusy && setShowAnfrage(false)}
        title={anfrageUmfang === 'logo' ? 'Logo anfragen' : anfrageUmfang === 'fotos' ? 'Fotos anfragen' : 'Fotos & Logo anfragen'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowAnfrage(false)} disabled={anfrageBusy}>Abbrechen</button>
            <button className="btn-primary" onClick={sendAnfrage} disabled={anfrageBusy || !kunde?.email || anredeOffen(kunde)}>
              {anfrageBusy ? 'Sende…' : `Mail an ${kunde?.email || '—'} senden`}
            </button>
          </>
        }
      >
        <div className="field field-full" style={{ marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Was anfragen?</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['beides', 'Logo + Fotos'], ['logo', 'Nur Logo'], ['fotos', 'Nur Fotos']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={anfrageUmfang === val ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => changeAnfrageUmfang(val)}
                disabled={anfrageBusy}
              >{label}</button>
            ))}
          </div>
        </div>
        <p className="pane-hint">
          Wir verschicken eine Mail an <strong>{kunde?.email || '(keine Mail hinterlegt)'}</strong> mit einem persönlichen Upload-Link.
          Der Kunde kann dort {anfrageUmfang === 'logo' ? 'sein Logo' : anfrageUmfang === 'fotos' ? 'seine Fotos' : 'Logo und Fotos'} ohne Login hochladen — die Dateien tauchen automatisch hier oben auf.
        </p>
        <AnredeAbfrage kunde={kunde} onSaved={k => setKunde(k)} />
        <CloseLeadWarnung kunde={kunde} onSaved={(k) => setKunde(k)} />
        <label className="field field-full">
          <span>Persönlicher Text (editierbar)</span>
          <textarea rows={6} value={anfrageText} onChange={e => setAnfrageText(e.target.value)} />
        </label>
        {anfrageMsg && <div className="form-msg" style={{ marginTop: 8 }}>{anfrageMsg}</div>}
      </Modal>

      {refLightboxIndex !== null && referenzbilder.length > 0 && (
        <Lightbox
          items={referenzbilder.map(r => ({ ...r, format: 'quadrat', typ: r.typ === 'logo' ? 'logo' : 'foto' }))}
          index={Math.max(0, Math.min(refLightboxIndex, referenzbilder.length - 1))}
          onClose={() => setRefLightboxIndex(null)}
          onNavigate={setRefLightboxIndex}
          filenameFor={r => (r.beschreibung || r.typ || 'bild').replace(/[^\w-]+/g, '-') + '.png'}
        />
      )}

      <NewProjectModal
        open={showCreate}
        kunde={kunde}
        onClose={() => setShowCreate(false)}
      />

      <TerminEinladungModal
        open={showTermin}
        onClose={() => setShowTermin(false)}
        kunde={kunde}
        kundeId={kundeId}
        onKundeUpdated={setKunde}
      />

      {/* Kunde-Löschen-Modal */}
      <Modal
        open={!!deleteModal}
        onClose={() => !deleteModal?.busy && setDeleteModal(null)}
        title="🗑️ Kunde endgültig löschen"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setDeleteModal(null)} disabled={deleteModal?.busy}>Abbrechen</button>
            <button
              className="btn-primary"
              style={{ background: '#dc2626', borderColor: '#dc2626' }}
              disabled={
                !deleteModal?.preview ||
                deleteModal?.busy ||
                (deleteModal?.typedName || '').trim() !== (deleteModal?.preview?.firmenname || '').trim()
              }
              onClick={confirmDelete}
            >
              {deleteModal?.busy ? 'Lösche…' : 'Endgültig löschen'}
            </button>
          </>
        }
      >
        {!deleteModal ? null : deleteModal.busy && !deleteModal.preview ? (
          <p>Lade Vorschau…</p>
        ) : deleteModal.preview ? (
          <>
            <p style={{ marginTop: 0 }}>
              Kunde <strong>{deleteModal.preview.firmenname || '(ohne Name)'}</strong> wirklich löschen? Damit werden auch gelöscht:
            </p>
            <ul style={{ fontSize: 13, lineHeight: 1.8, background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 20px', borderRadius: 8 }}>
              {(() => {
                const c = deleteModal.preview.counts;
                const rows = [
                  [c.jobs, 'Job(s) / Kampagne(n)'],
                  [c.creatives, 'Creative(s) inkl. Storage-Dateien'],
                  [c.bewerbungen, 'Bewerbung(en) inkl. Feedback + Notizen'],
                  [c.funnels, 'Funnel(s)'],
                  [c.adcopies, 'Ad Copy(s)'],
                  [c.reviews, 'Review(s)'],
                  [c.referenzbilder, 'Referenzbild(er) inkl. Storage'],
                  [c.versand, 'Versand-Historien'],
                  [c.zahlungen, 'Zahlung(en)'],
                  [c.anfragen, 'Kunden-Anfrage(n)'],
                ].filter(r => r[0] > 0);
                return rows.map(([n, l]) => (
                  <li key={l}><strong>{n}</strong> {l}</li>
                ));
              })()}
              {deleteModal.preview.counts.projekte > 0 && (
                <li style={{ color: '#5a5955' }}>
                  <em>{deleteModal.preview.counts.projekte} Projekt(e) in der Übersicht bleiben erhalten</em> (nur die Kunden-Verknüpfung wird entfernt).
                </li>
              )}
            </ul>
            <p style={{ color: '#991b1b', fontWeight: 600, marginBottom: 6 }}>
              Das kann nicht rückgängig gemacht werden.
            </p>
            <p style={{ fontSize: 13, marginBottom: 6, marginTop: 12 }}>
              Zur Bestätigung tippe bitte den Firmennamen ein:
            </p>
            <p style={{ fontSize: 13, fontFamily: 'monospace', background: '#f4f3f0', padding: '6px 10px', borderRadius: 6, marginBottom: 6 }}>
              {deleteModal.preview.firmenname}
            </p>
            <input
              type="text" autoFocus
              value={deleteModal.typedName}
              onChange={e => setDeleteModal(m => ({ ...m, typedName: e.target.value }))}
              placeholder="Firmenname exakt eintippen…"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d4d4d0', borderRadius: 8, fontSize: 14 }}
            />
            {deleteModal.error && (
              <p style={{ color: '#c1272d', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{deleteModal.error}</p>
            )}
          </>
        ) : (
          <p style={{ color: '#c1272d' }}>{deleteModal.error}</p>
        )}
      </Modal>
    </div>
  );
}

function KiFreigabeToggle({ kunde, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function toggle(disallow) {
    setBusy(true);
    try {
      const res = await api(`/kunden/${kunde.id}`, {
        method: 'PATCH', body: { keine_ki_bilder: !!disallow },
      });
      onChanged(res.kunde);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }
  // UI-Semantik: Ja = KI erlaubt, Nein = keine KI (Overlay only)
  const erlaubt = !kunde.keine_ki_bilder;
  return (
    <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 4, cursor: 'pointer' }}
      title={erlaubt ? 'Kunde erlaubt KI-generierte Bilder' : 'Kunde will keine KI-Bilder — nur Overlays / echte Fotos'}>
      <input type="checkbox" checked={erlaubt} disabled={busy}
        onChange={e => toggle(!e.target.checked)} />
      <span style={{ fontSize: 12, color: erlaubt ? 'var(--ink-3)' : '#b45309' }}>
        {erlaubt ? 'ja' : '⚠️ nein (nur Overlays)'}
      </span>
    </label>
  );
}

function PaypalToggle({ kunde, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function toggle(next) {
    setBusy(true);
    try {
      const res = await api(`/kunden/${kunde.id}`, {
        method: 'PATCH', body: { paypal_enabled: !!next },
      });
      onChanged(res.kunde);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }
  return (
    <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 4, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!kunde.paypal_enabled} disabled={busy}
        onChange={e => toggle(e.target.checked)} />
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{kunde.paypal_enabled ? 'aktiv' : 'aus'}</span>
    </label>
  );
}

function CampaignPaymentBanner({ status, kundeId }) {
  if (!status || status === 'ok') return null;
  const meta = status === 'blocked'
    ? { bg: '#fde0e0', color: '#b91c1c',
        title: '⚠ Kampagne blockiert — Werbebudget-Rechnung überfällig',
        detail: 'Der Kunde hat eine Werbebudget-Rechnung seit über 7 Tagen nicht bezahlt. Bitte prüfen: Kampagne pausieren oder Rücksprache halten.' }
    : { bg: '#fff2d4', color: '#a34e00',
        title: '⚠ Kampagne pending — Budget-Rechnung überfällig',
        detail: 'Die aktuelle Budget-Rechnung ist überfällig. Wenn nicht innerhalb von 7 Tagen bezahlt: Status wechselt auf blocked.' };
  return (
    <div style={{ padding: 14, borderRadius: 10, background: meta.bg, color: meta.color, marginBottom: 14, fontSize: 13 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{meta.title}</div>
      <div>{meta.detail}</div>
    </div>
  );
}

/* ═════════════════════ Angebote & Aufträge ═════════════════════ */

const STATUS_META = {
  draft:     { label: 'Draft',    bg: '#eeece7', color: '#5a5955' },
  created:   { label: 'Erstellt', bg: '#e0eaf7', color: '#1f3a72' },
  sent:      { label: 'Versandt', bg: '#e0f5ff', color: '#0068a3' },
  accepted:  { label: 'Angenommen', bg: '#e0f5df', color: '#0a8043' },
  declined:  { label: 'Abgelehnt', bg: '#fde0e0', color: '#b91c1c' },
};

function OffersSection({ kundeId, offers, onOpenBilling, onOpenDecline, onSendOffer, onSendOrder }) {
  return (
    <>
      <div className="section-head">
        <div>
          <h2 className="section-title">Angebote &amp; Aufträge</h2>
          <p className="section-sub">Alle Angebote und Direktaufträge für diesen Kunden.</p>
        </div>
        <Link to={`/angebote/neu?kunde_id=${kundeId}`} className="btn-primary">
          <Icon name="plus" /> Neues Angebot für diesen Kunden
        </Link>
      </div>

      {offers.length === 0 ? (
        <div className="card empty">
          <h2>Noch keine Angebote</h2>
          <p>Über den Button oben ein Angebot für diesen Kunden anlegen.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, width: '100%' }}>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Marke</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Monat 1</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {offers.map(o => {
                  const st = STATUS_META[o.status] || { label: o.status, bg: 'var(--gray-100)', color: 'var(--ink)' };
                  const isDirect = o.status === 'accepted' && !o.easybill_document_id;
                  const phase = o.billing_phase && PHASE_META[o.billing_phase];
                  return (
                    <tr key={o.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(o.created_at).toLocaleDateString('de-DE')}
                      </td>
                      <td>{o.brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne'}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 100, background: st.bg, color: st.color, fontSize: 11, fontWeight: 700 }}>{st.label}</span>
                        {isDirect && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 100, background: '#fff7ed', color: '#9a3412', fontSize: 10, fontWeight: 700, border: '1px dashed #fdba74' }}>Direktauftrag</span>}
                        {phase && (
                          <div style={{ marginTop: 4 }}>
                            <span style={{ padding: '2px 8px', borderRadius: 100, background: phase.bg, color: phase.color, fontSize: 10, fontWeight: 700 }}>{phase.label}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>
                        {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(o.first_month_total) || 0)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {o.easybill_document_id && (
                          <a href={`/api/offers/${o.id}/pdf`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">📄 PDF</a>
                        )}
                        {o.easybill_document_id && (o.status === 'created' || o.status === 'sent') && (
                          <button className="btn-ghost btn-sm" onClick={() => onSendOffer(o)}>✉︎ Angebot senden</button>
                        )}
                        {o.easybill_order_document_id && (
                          <button className="btn-ghost btn-sm" onClick={() => onSendOrder(o)}>📋 AB senden</button>
                        )}
                        {o.status === 'accepted' && (
                          <button className="btn-primary btn-sm" onClick={() => onOpenBilling(o)}>📊 Abrechnung</button>
                        )}
                        {(o.status === 'draft' || o.status === 'created' || o.status === 'sent') && (
                          <button className="btn-ghost btn-sm" onClick={() => onOpenDecline(o)}>❌ Ablehnen</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ═════════════════════ Aktivitäten-Timeline ═════════════════════ */

function ActivitySection({ activity }) {
  if (!activity?.length) {
    return (
      <>
        <div className="section-head">
          <div>
            <h2 className="section-title">Aktivitäten</h2>
            <p className="section-sub">Chronologie aller Vorgänge — neueste zuerst.</p>
          </div>
        </div>
        <div className="card empty">
          <h2>Keine Aktivitäten</h2>
          <p>Sobald Angebote, Rechnungen oder Einstellungen entstehen, tauchen sie hier auf.</p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="section-head">
        <div>
          <h2 className="section-title">Aktivitäten</h2>
          <p className="section-sub">{activity.length} Ereignisse · neueste zuerst</p>
        </div>
      </div>
      <div className="card" style={{ padding: '16px 18px' }}>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {activity.map((ev, i) => (
            <li key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 18 }}>{ev.icon || '·'}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{ev.title}</div>
                {ev.detail && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ev.detail}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                {ev.ts ? new Date(ev.ts).toLocaleString('de-DE') : ''}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/* ═════════════════════ Projekt-Status-Row ═════════════════════
   Zeigt den aktuellen Projekt-Status (aus talentone_projekte via kunde_id-
   Verknüpfung) direkt am Kunden. Erlaubt Redakteur:innen im Kundenbereich
   auf einen Blick zu sehen, ob eine Kampagne live läuft, im Feedback ist etc. */

const PROJEKT_STATUS_META = {
  vorbereitung:      { emoji: '🟠', label: 'Vorbereitung',      bg: '#fee2e2', color: '#991b1b' },
  kickoff_vereinbart:{ emoji: '📅', label: 'Kick-Off vereinbart', bg: '#dbeafe', color: '#1e3a8a' },
  onboarding:        { emoji: '🎯', label: 'Onboarding',        bg: '#ede9fe', color: '#5b21b6' },
  golive_vereinbart: { emoji: '🕐', label: 'Go-Live vereinbart', bg: '#dbeafe', color: '#1e3a8a' },
  warte_auf_go:      { emoji: '⏳', label: 'Warte auf Go',      bg: '#fef3c7', color: '#92400e' },
  feedbackschleife:  { emoji: '🔔', label: 'Feedbackschleife',  bg: '#fef3c7', color: '#92400e' },
  go:                { emoji: '✅', label: 'Go vom Kunden',     bg: '#dcfce7', color: '#166534' },
  live:              { emoji: '🟢', label: 'Live',              bg: '#dcfce7', color: '#166534' },
  pausiert:          { emoji: '⏸', label: 'Pausiert',          bg: '#fee2e2', color: '#991b1b' },
  hold:              { emoji: '🟨', label: 'Hold',              bg: '#fef3c7', color: '#92400e' },
  abgeschlossen:     { emoji: '🏁', label: 'Abgeschlossen',     bg: '#d1fae5', color: '#065f46' },
};

// Kompakte Karten mit den Kern-Vertragsdaten pro Projekt — direkt sichtbar
// unterhalb der Status-Chip-Row, damit man beim Öffnen des Kunden sofort
// die Vertragslage sieht (Migration 025 Felder + Status + Live-Termin).
function ProjektInfoCards({ projekte, schritteItems = [], kundeId }) {
  if (!projekte?.length) return null;
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: 14 }}>
      {projekte.map(p => {
        const meta = PROJEKT_STATUS_META[p.status] || { emoji: '·', label: p.status || '—', bg: '#e5e7eb', color: '#374151' };
        // Passenden Naechster-Schritt-Badge zum Projekt finden (best-effort ueber gesuchte_positionen)
        const badge = schritteItems.find(it =>
          it.stelle && p.gesuchte_positionen && it.stelle.trim() === p.gesuchte_positionen.trim()
        ) || (schritteItems.length === 1 ? schritteItems[0] : null);
        return (
          <Link key={p.id} to="/projekte"
            style={{
              background: '#fff', border: '1px solid var(--line)', borderRadius: 10,
              padding: '10px 12px', textDecoration: 'none', color: 'inherit',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
            title="Zum Projekte-Board"
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.projekt || p.gesuchte_positionen || '—'}
              </strong>
              <span style={{
                padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                background: meta.bg, color: meta.color,
              }}>{meta.emoji} {meta.label}</span>
            </div>
            {badge && (
              <div onClick={e => e.stopPropagation()}>
                <ItemBadge item={badge} kundeId={kundeId} compact />
              </div>
            )}
            {p.projektart && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.projektart}</div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
              {p.projektdauer && (
                <span style={{ background: '#f3f4f6', color: '#374151', padding: '2px 8px', borderRadius: 6 }}>
                  ⏱ {p.projektdauer}
                </span>
              )}
              {p.garantie ? (
                <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 6, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={p.garantie_details || 'Garantie aktiv'}>
                  🛡️ Garantie{p.garantie_details ? `: ${p.garantie_details}` : ''}
                </span>
              ) : (
                <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 6 }}>
                  Ohne Garantie
                </span>
              )}
              {p.zahlung_aufgeteilt && (
                <span style={{ background: '#fef3c7', color: '#78350f', padding: '2px 8px', borderRadius: 6 }}>
                  💰 Zahlung aufgeteilt
                </span>
              )}
              {p.fotograf_noetig && (
                <span style={{ background: '#e0f2fe', color: '#075985', padding: '2px 8px', borderRadius: 6 }}>
                  📸 Fotograf nötig
                </span>
              )}
            </div>
            {p.live_termin && (
              <div style={{ fontSize: 11, color: '#166534' }}>
                🕐 Go-Live: {new Date(p.live_termin).toLocaleDateString('de-DE')}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function ProjektStatusRow({ projekte }) {
  if (!projekte?.length) return null;
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 14, borderRadius: 10,
      background: 'var(--gray-50)', border: '1px solid var(--line)',
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13,
    }}>
      <strong style={{ marginRight: 4 }}>Projekt-Status:</strong>
      {projekte.map(p => {
        const meta = PROJEKT_STATUS_META[p.status] || { emoji: '·', label: p.status || '—', bg: 'var(--gray-100)', color: 'var(--ink-3)' };
        return (
          <Link
            key={p.id} to="/projekte"
            title={`${p.projekt || p.kunde || '—'} — im Projekte-Board öffnen`}
            style={{
              padding: '4px 10px', borderRadius: 100,
              background: meta.bg, color: meta.color, fontSize: 12, fontWeight: 700,
              textDecoration: 'none', display: 'inline-flex', gap: 4, alignItems: 'center',
            }}
          >
            {meta.emoji} {meta.label}
            {p.live_termin && (
              <span style={{ fontSize: 10, opacity: 0.85, marginLeft: 4 }}>
                · Go-Live {new Date(p.live_termin).toLocaleDateString('de-DE')}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}


function PortalAccountsSection({ kunde, onKundeUpdated }) {
  const [accounts, setAccounts] = useState([]);
  const [neu, setNeu] = useState({ email: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const res = await api(`/kunden/${kunde.id}/portal-accounts`);
      setAccounts(res.accounts || []);
    } catch (err) { setMsg(err.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kunde.id]);

  async function toggleMode() {
    const neuerModus = kunde.portal_zugang === 'account' ? 'link' : 'account';
    try {
      await api(`/kunden/${kunde.id}/portal-zugang`, { method: 'PATCH', body: { modus: neuerModus } });
      onKundeUpdated({ ...kunde, portal_zugang: neuerModus });
    } catch (err) { alert(err.message); }
  }

  async function create(e) {
    e.preventDefault();
    if (!neu.email.trim()) return;
    setBusy(true); setMsg('');
    try {
      await api(`/kunden/${kunde.id}/portal-accounts`, {
        method: 'POST', body: { email: neu.email.trim(), name: neu.name.trim() || null },
      });
      setNeu({ email: '', name: '' });
      if (kunde.portal_zugang !== 'account') onKundeUpdated({ ...kunde, portal_zugang: 'account' });
      load();
      alert('Einladung verschickt.');
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  async function resend(a) {
    try {
      await api(`/kunden/${kunde.id}/portal-accounts/${a.id}/einladung-neu`, { method: 'POST' });
      load(); alert('Einladung neu verschickt.');
    } catch (err) { alert(err.message); }
  }
  async function remove(a) {
    if (!confirm(`Zugang für ${a.email} entfernen?`)) return;
    try {
      await api(`/kunden/${kunde.id}/portal-accounts/${a.id}`, { method: 'DELETE' });
      load();
    } catch (err) { alert(err.message); }
  }

  const istAccount = kunde.portal_zugang === 'account';
  return (
    <div style={{ marginTop: 12, padding: 12, background: '#fafaf8', border: '1px solid #ececea', borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>🔑 Portal-Zugänge</strong>
        <span style={{ fontSize: 11, color: '#5a5955' }}>
          {istAccount ? 'Login mit E-Mail + Passwort aktiv' : 'Nur Token-Link (kein Login)'}
        </span>
        <button onClick={toggleMode} className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
          {istAccount ? 'Auf Nur-Link umstellen' : 'Auf Login umstellen'}
        </button>
      </div>

      {istAccount && (
        <>
          <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
            {accounts.length === 0 && (
              <p style={{ fontSize: 12, color: '#9a9994', margin: 0 }}>Noch kein Zugang angelegt.</p>
            )}
            {accounts.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', background: '#fff', border: '1px solid #ececea', borderRadius: 8, fontSize: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.name || a.email}</div>
                  <div style={{ color: '#5a5955' }}>
                    {a.email}
                    {' · '}
                    {a.passwort_gesetzt_at
                      ? `zuletzt eingeloggt: ${a.letzter_login ? new Date(a.letzter_login).toLocaleString('de-DE') : '–'}`
                      : a.einladung_gesendet_at
                        ? `Einladung geschickt am ${new Date(a.einladung_gesendet_at).toLocaleDateString('de-DE')} — noch kein Passwort gesetzt`
                        : 'Kein Passwort'}
                  </div>
                </div>
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#5a5955', cursor: 'pointer' }}
                  title="Erhält E-Mail bei neuen Anfragen/Leads">
                  <input type="checkbox" checked={a.benachrichtige_leads !== false}
                    onChange={async e => {
                      const v = e.target.checked;
                      try {
                        await api(`/kunden/${kunde.id}/portal-accounts/${a.id}`, { method: 'PATCH', body: { benachrichtige_leads: v } });
                        setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, benachrichtige_leads: v } : x));
                      } catch (err) { alert(err.message); }
                    }} />
                  📥 Leads
                </label>
                <button onClick={() => resend(a)} className="btn-ghost btn-sm" disabled={anredeOffen(kunde)}>Einladung neu</button>
                <button onClick={() => remove(a)} className="btn-ghost btn-sm btn-danger">×</button>
              </div>
            ))}
          </div>
          <AnredeAbfrage kunde={kunde} onSaved={onKundeUpdated} />
          <form onSubmit={create} style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Name (optional)" value={neu.name}
              onChange={e => setNeu({ ...neu, name: e.target.value })}
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #ececea', borderRadius: 6, fontSize: 12 }} />
            <input type="email" placeholder="E-Mail-Adresse" value={neu.email}
              onChange={e => setNeu({ ...neu, email: e.target.value })}
              style={{ flex: 2, padding: '6px 10px', border: '1px solid #ececea', borderRadius: 6, fontSize: 12 }} />
            <button type="submit" disabled={busy || !neu.email.trim() || anredeOffen(kunde)} className="btn-primary btn-sm">
              {busy ? '…' : '+ Einladen'}
            </button>
          </form>
          {msg && <div style={{ color: '#c1272d', fontSize: 12, marginTop: 6 }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
