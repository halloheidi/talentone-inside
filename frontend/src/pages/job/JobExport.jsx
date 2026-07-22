import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { downloadFromUrl } from '../../lib/files.js';
import Modal from '../../components/Modal.jsx';
import Lightbox from '../../components/Lightbox.jsx';
import EntwurfPreflightModal from '../../components/EntwurfPreflightModal.jsx';
import CloseLeadWarnung from '../../components/CloseLeadWarnung.jsx';
import TerminEinladungModal from '../../components/TerminEinladungModal.jsx';
import StandaloneAdBudgetModal from '../../components/StandaloneAdBudgetModal.jsx';
import InvoicesSection, { SendInvoiceMailModal } from '../../components/InvoicesSection.jsx';
import AnredeAbfrage from '../../components/AnredeAbfrage.jsx';
import { anrede, t, anredeOffen } from '../../lib/anrede.js';
import { getBrandBaseUrl } from '../../lib/branding.js';

const STYLE_LABEL = {
  emotional: 'Emotional / Story',
  benefit:   'Benefit-fokussiert',
  kompakt:   'Knackig / Hook',
};

function badgeFor(c) {
  if (c.typ === 'video') return 'REEL';
  return c.format === 'story' ? '9:16' : '1:1';
}

export default function JobExport() {
  const { job, kunde, reload } = useJob();
  const [showPreflight, setShowPreflight] = useState(false);
  const [showGoLive, setShowGoLive] = useState(false);
  const [goLiveBusy, setGoLiveBusy] = useState(false);
  // Entwurfs-Reminder + Manuell-Antwort
  const [showReminder, setShowReminder] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminderBusy, setReminderBusy] = useState(false);
  const [showManuell, setShowManuell] = useState(false);
  const [manuellForm, setManuellForm] = useState({ status: 'freigegeben', notiz: '' });
  const [manuellBusy, setManuellBusy] = useState(false);
  const [showTermin, setShowTermin] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCreatives, setSelectedCreatives] = useState(new Set());
  const [selectedAdcopies, setSelectedAdcopies] = useState(new Set());
  const [busy, setBusy] = useState(null); // 'zip' | 'pdf' | 'alles' | null
  const [copiedId, setCopiedId] = useState(null);

  // Mail-Modal
  const [showMail, setShowMail] = useState(false);
  const [mailForm, setMailForm] = useState({
    to: '', betreff: '', anschreiben: '', include_funnel: true,
  });
  const [mailBusy, setMailBusy] = useState(false);
  const [mailMsg, setMailMsg] = useState('');
  const [mailErr, setMailErr] = useState(false); // Fehler (rot) vs. Erfolg (neutral)
  const [anschreibensBusy, setAnschreibensBusy] = useState(false);

  // Versand-Historie + Review
  const [versand, setVersand] = useState([]);
  const [review, setReview] = useState(null);
  const [runden, setRunden] = useState([]);
  const [showKommentare, setShowKommentare] = useState(false);

  // Reaktivierungs-Modal
  const [showReak, setShowReak] = useState(false);
  const [reakForm, setReakForm] = useState({
    to: '', customText: '', create_close_task: true, selected: new Set(),
  });
  const [reakBusy, setReakBusy] = useState(false);
  const [reakMsg, setReakMsg] = useState('');

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api(`/jobs/${job.id}/export`),
      api(`/jobs/${job.id}/export/versand`).catch(() => ({ versand: [] })),
      api(`/jobs/${job.id}/export/review`).catch(() => ({ review: null, runden: [] })),
    ])
      .then(([d, v, r]) => {
        setData(d);
        // alle Creatives + alle AdCopies vorausgewählt
        setSelectedCreatives(new Set((d.creatives || []).map(c => c.id)));
        setSelectedAdcopies(new Set((d.adcopies || []).map(a => a.id)));
        setVersand(v.versand || []);
        setReview(r.review);
        setRunden(r.runden || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  function toggleCreative(id) {
    setSelectedCreatives(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAdcopy(id) {
    setSelectedAdcopies(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAllCreatives() {
    if (!data?.creatives) return;
    if (selectedCreatives.size === data.creatives.length) {
      setSelectedCreatives(new Set());
    } else {
      setSelectedCreatives(new Set(data.creatives.map(c => c.id)));
    }
  }

  async function downloadZip() {
    if (selectedCreatives.size === 0) return;
    setBusy('zip');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/jobs/${job.id}/export/zip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await (await import('../../lib/supabase.js')).supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ creative_ids: Array.from(selectedCreatives) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'creatives.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(`Download fehlgeschlagen: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (selectedAdcopies.size === 0) return;
    setBusy('pdf');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/jobs/${job.id}/export/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await (await import('../../lib/supabase.js')).supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ adcopy_ids: Array.from(selectedAdcopies) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'adcopies.pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(`Download fehlgeschlagen: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadAlles() {
    setBusy('alles');
    try {
      if (selectedCreatives.size > 0) await downloadZip();
      if (selectedAdcopies.size > 0) await downloadPdf();
      // Funnel-URL als Textdatei
      if (data?.funnel_url) {
        const txt = `Bewerbungs-Funnel\n${kunde?.firmenname || ''} — ${job.stelle || ''}\n\n${data.funnel_url}\n`;
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'funnel-link.txt'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyAdcopy(a) {
    try {
      await navigator.clipboard.writeText(a.text || '');
      setCopiedId(a.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      alert('Kopieren fehlgeschlagen.');
    }
  }

  /* ───── Mail-Modal ───── */
  // mode = 'first' | 'same_round' | 'new_round'
  // Die drei Modi entsprechen den drei Mail-Varianten im Backend. Das Backend
  // leitet die Variante zusaetzlich aus dem echten Zustand ab (Erstversand
  // gewinnt, neue Runde nur mit echter Kundenreaktion) — der Modus hier ist nur
  // die Absicht der UI, nicht die alleinige Wahrheit.
  function openMailModal(mode = 'first') {
    const istResend = mode === 'same_round';
    const istNeueRunde = mode === 'new_round';
    const anschreibenDefault = istResend
      ? t(kunde,
          `Hallo ${kunde?.ansprechpartner || 'zusammen'},\n\nhier nochmal deine Entwürfe zur Freigabe — falls die letzte Mail bei dir untergegangen ist.\n\nDu kannst auf der Review-Seite wieder kommentieren oder direkt freigeben.`,
          `${anrede(kunde)},\n\nhier nochmal Ihre Entwürfe zur Freigabe — falls die letzte Mail bei Ihnen untergegangen ist.\n\nSie können auf der Review-Seite wieder kommentieren oder direkt freigeben.`)
      : '';
    setMailForm({
      to: kunde?.email || '',
      betreff: istNeueRunde
        ? t(kunde, `Deine überarbeiteten Entwürfe — Runde ${(Number(review?.runde) || 1) + 1}`, `Ihre überarbeiteten Entwürfe — Runde ${(Number(review?.runde) || 1) + 1}`)
        : t(kunde, 'Deine Entwürfe sind fertig 🎨', 'Ihre Entwürfe sind fertig 🎨'),
      anschreiben: anschreibenDefault,
      include_funnel: !!data?.funnel_url,
      resend_mode: mode,
    });
    setMailMsg('');
    setMailErr(false);
    setShowMail(true);
    if (!istResend) {
      // KI-Anschreiben-Vorschlag für Erstversand + neue Runde
      setAnschreibensBusy(true);
      api(`/jobs/${job.id}/export/anschreiben`, { method: 'POST' })
        .then(r => setMailForm(prev => ({ ...prev, anschreiben: r.text || prev.anschreiben })))
        .catch(() => {})
        .finally(() => setAnschreibensBusy(false));
    }
  }

  async function sendMail() {
    if (!mailForm.to.trim()) { setMailErr(true); setMailMsg('Empfänger-Mail fehlt.'); return; }
    setMailBusy(true);
    setMailMsg('');
    setMailErr(false);
    try {
      await api(`/jobs/${job.id}/export/email`, {
        method: 'POST',
        body: {
          to: mailForm.to,
          betreff: mailForm.betreff,
          anschreiben: mailForm.anschreiben,
          creative_ids: Array.from(selectedCreatives),
          adcopy_ids: Array.from(selectedAdcopies),
          include_funnel: mailForm.include_funnel,
          resend_mode: mailForm.resend_mode || undefined,
        },
      });
      setMailErr(false);
      setMailMsg('Mail verschickt!');
      // Historie + Review nachladen
      api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
      api(`/jobs/${job.id}/export/review`).then(r => { setReview(r.review); setRunden(r.runden || []); }).catch(() => {});
      setTimeout(() => setShowMail(false), 1200);
    } catch (err) {
      // Fehler sichtbar machen (rot) + Button wieder freigeben. Der stumme
      // Zustand "es passiert nichts" ist selbst ein Bug.
      setMailErr(true);
      setMailMsg(`Versand fehlgeschlagen: ${err.body?.error || err.message || 'Unbekannter Fehler.'}`);
    } finally {
      setMailBusy(false);
    }
  }

  /* ───── Reaktivierungs-Modal ───── */
  // Vorbelegter Mail-Text — folgt der am Kunden gesetzten Anrede (Du/Sie).
  function buildReakText(k) {
    const stelle = job?.stelle || 'eure offene Stelle';
    const calLink = 'https://calendly.com/andrea-saltaleggio/drafts';
    return `${anrede(k)},

wir haben spannende Neuigkeiten: Mit unserer neuen KI-Technologie haben wir frische Werbeanzeigen für ${t(k, 'deine', 'Ihre')} offene Stelle als ${stelle} erstellt — und das Ergebnis kann sich sehen lassen!

Unser Vorschlag: ${t(k, 'Geh', 'Gehen Sie')} nochmal für 30 Tage online — ${t(k, 'du zahlst', 'Sie zahlen')} nur die Betreuungspauschale, die Erstellung der neuen Creatives ist inklusive.

Sollen wir kurz telefonieren? ${t(k, 'Antworte', 'Antworten Sie')} einfach auf diese Mail oder ${t(k, 'buch dir', 'buchen Sie sich')} direkt einen Termin (unverbindlich): ${calLink}`;
  }

  function openReakModal() {
    const defaultText = buildReakText(kunde);
    // Standardmäßig nur Bild-Creatives vorausgewählt (Videos werden in der Mail eh nicht eingebettet)
    const bildIds = (data?.creatives || [])
      .filter(c => c.typ !== 'video' && c.bild_url)
      .slice(0, 6)
      .map(c => c.id);
    setReakForm({
      to: kunde?.email || '',
      customText: defaultText,
      create_close_task: true,
      selected: new Set(bildIds),
    });
    setReakMsg('');
    setShowReak(true);
  }

  function toggleReakCreative(id) {
    setReakForm(prev => {
      const n = new Set(prev.selected);
      n.has(id) ? n.delete(id) : n.add(id);
      return { ...prev, selected: n };
    });
  }

  async function sendReak() {
    if (!reakForm.to.trim()) { setReakMsg('Empfänger-Mail fehlt.'); return; }
    if (reakForm.selected.size === 0) { setReakMsg('Mindestens ein Creative auswählen.'); return; }
    setReakBusy(true);
    setReakMsg('');
    try {
      const res = await api(`/jobs/${job.id}/export/reaktivierung`, {
        method: 'POST',
        body: {
          to: reakForm.to,
          customText: reakForm.customText,
          creative_ids: Array.from(reakForm.selected),
          create_close_task: reakForm.create_close_task,
        },
      });
      const closeInfo = res.close ? ' · Close-Task angelegt' : (reakForm.create_close_task ? ' · Close-Task nicht erstellt (Lead nicht gefunden)' : '');
      setReakMsg(`Mail verschickt!${closeInfo}`);
      api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
      setTimeout(() => setShowReak(false), 1400);
    } catch (err) {
      setReakMsg(err.message);
    } finally {
      setReakBusy(false);
    }
  }

  if (loading) return <div className="card empty">Lade Export…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  const creatives = data?.creatives || [];
  const adcopies = data?.adcopies || [];
  const funnel = data?.funnel;
  const allCreativesSelected = creatives.length > 0 && selectedCreatives.size === creatives.length;

  const letzterVersand = versand.find(v => v.typ !== 'reaktivierung' && v.typ !== 'kampagne_live' && v.typ !== 'entwurf_reminder' && v.typ !== 'kampagne_pause') || versand[0];
  const letzterEntwurfsVersand = versand.find(v => (v.typ || '').startsWith('entwurf_runde_'));
  const letzterReminderVersand = versand.find(v => v.typ === 'entwurf_reminder');
  const letzteReaktivierung = versand.find(v => v.typ === 'reaktivierung');
  const letzteKampagneLive  = versand.find(v => v.typ === 'kampagne_live');
  const letzteKampagnePause = versand.find(v => v.typ === 'kampagne_pause');
  // Reminder ist zulaessig, wenn Entwuerfe raus sind und weder Freigabe noch
  // Aenderungswuensche noch manuelle Antwort erfasst wurden.
  const kannReminderSenden = !!letzterEntwurfsVersand
    && (!review || (review.status !== 'freigegeben' && review.status !== 'aenderungen' && !review.manuell_beantwortet));
  const kommentarEntries = review?.kommentare && typeof review.kommentare === 'object'
    ? Object.entries(review.kommentare).filter(([, v]) => (v || '').trim())
    : [];

  const bewerbungenUrl = job?.bewerbungen_token
    ? `${getBrandBaseUrl(kunde?.agentur)}/bewerbungen/${job.bewerbungen_token}`
    : null;

  return (
    <div className="export-tab">
      {/* ─────── Bewerberliste-Link für den Kunden ─────── */}
      {bewerbungenUrl && (
        <div className="bewerbungen-link-box">
          <div className="bewerbungen-link-title">📋 Bewerberliste für den Kunden</div>
          <div className="bewerbungen-link-row">
            <code className="bewerbungen-link-url">{bewerbungenUrl}</code>
            <button type="button" className="btn-ghost btn-sm" onClick={async () => {
              try { await navigator.clipboard.writeText(bewerbungenUrl); } catch { /* noop */ }
            }}>Kopieren</button>
            <a className="btn-ghost btn-sm" href={bewerbungenUrl} target="_blank" rel="noreferrer">Öffnen</a>
          </div>
          <p className="bewerbungen-link-hint">
            Diesen Link an den Kunden weitergeben — er zeigt alle Bewerbungen in Echtzeit
            (Branding nach Agentur-Einstellung, Status/Termin/Notizen können vom Kunden eingetragen werden).
          </p>
        </div>
      )}

      {/* ─────── Zahlungen (PayPal) ─────── */}
      <ZahlungenSection job={job} kunde={kunde} onKundeUpdated={() => reload?.()} />

      {/* ─────── Versand-Status oben ─────── */}
      {letzterVersand && (
        <div className="versand-status">
          <span>✅ Entwürfe gesendet am <strong>{new Date(letzterVersand.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong> an <strong>{letzterVersand.empfaenger}</strong></span>
          <button className="btn-ghost btn-sm" onClick={() => openMailModal('same_round')} disabled={!kunde?.email}
            title="Gleiche Runde nochmal — Kunde kann wieder kommentieren">
            ↩️ Erneut senden (gleiche Runde)
          </button>
          {kannReminderSenden && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                const grus = kunde?.ansprechpartner || 'zusammen';
                setReminderText(`Hallo ${grus},\n\nvor ein paar Tagen haben wir dir die Entwürfe für deine Recruiting-Kampagne geschickt. Hast du schon reinschauen können?\n\nDamit wir zeitnah live gehen können, brauchen wir noch dein Feedback.\n\nBei Fragen melde dich gerne jederzeit!`);
                setShowReminder(true);
              }}
              disabled={!kunde?.email}
              title="Freundlichen Reminder mit Review-Link senden"
            >🔔 Reminder senden</button>
          )}
          {letzterEntwurfsVersand && (!review || (review.status !== 'freigegeben' && review.status !== 'aenderungen' && !review.manuell_beantwortet)) && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => { setManuellForm({ status: 'freigegeben', notiz: '' }); setShowManuell(true); }}
              title="Kunde hat per Telefon/Mail geantwortet — Review-Status manuell setzen"
            >✓ Kunde hat anderweitig geantwortet</button>
          )}
        </div>
      )}

      {/* Reminder-Info */}
      {letzterReminderVersand && (
        <div className="versand-status" style={{ background: '#fef3c7', color: '#78350f', borderColor: '#fde68a' }}>
          <span>🔔 Reminder gesendet am <strong>{new Date(letzterReminderVersand.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong></span>
        </div>
      )}

      {/* Manuell-Antwort-Info */}
      {review?.manuell_beantwortet && (
        <div className="versand-status" style={{ background: '#e0f2fe', color: '#075985', borderColor: '#bae6fd' }}>
          <span>
            ✓ Kunde hat manuell geantwortet (Runde {review.runde || 1}) — <strong>{review.status === 'freigegeben' ? 'Freigabe' : 'Änderungswünsche'}</strong>
            {review.manuell_notiz ? ` · „${review.manuell_notiz}"` : ''}
          </span>
        </div>
      )}

      {/* ─────── Timeline der Runden (Versand + Feedback) ─────── */}
      <RundenTimeline versand={versand} runden={runden} />

      {/* ─────── Review-Status ─────── */}
      {review && (review.status === 'freigegeben' || review.status === 'aenderungen') && (
        <div className={`review-status review-status-${review.status}`}>
          {review.status === 'freigegeben' ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>✅ Kunde hat freigegeben (Runde {review.runde || 1}) am {new Date(review.updated_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={async () => {
                  if (!confirm('Kommentierung wieder freischalten? Der Kunde sieht beim nächsten Öffnen der Review-URL wieder ein leeres Kommentarfeld einer neuen Runde. Für den Fall, dass er versehentlich freigegeben hat.')) return;
                  try {
                    await api(`/jobs/${job.id}/export/review-reset`, { method: 'POST' });
                    api(`/jobs/${job.id}/export/review`).then(r => { setReview(r.review); setRunden(r.runden || []); }).catch(() => {});
                    api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
                    alert('Kommentierung wieder freigeschaltet. Der Kunde kann jetzt erneut Feedback geben.');
                  } catch (err) { alert(err.message); }
                }}
                title="Legt eine frische offene Review-Runde an — der Kunde kann wieder kommentieren"
              >🔓 Kommentierung wieder freischalten</button>
            </div>
          ) : (
            <>
              <div className="review-status-head">
                <strong>📝 Runde {review.runde || 1}: Kunde hat Änderungswünsche</strong>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  {new Date(review.updated_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {kommentarEntries.length > 0 && (
                  <button className="btn-ghost btn-sm" onClick={() => setShowKommentare(v => !v)}>
                    {showKommentare ? 'Kommentare ausblenden' : `${kommentarEntries.length} Kommentar${kommentarEntries.length === 1 ? '' : 'e'} ansehen`}
                  </button>
                )}
              </div>
              {showKommentare && kommentarEntries.length > 0 && (
                <ul className="review-kommentar-list">
                  {kommentarEntries.map(([key, text]) => {
                    const stilLabels = { emotional: 'Emotional', benefit: 'Benefits', kompakt: 'Knackig' };
                    const fmtLabels  = { quadrat: '1:1', story: '9:16' };
                    const snap = review?.kommentare_snapshot?.[key];
                    if (key.startsWith('creative_')) {
                      const id = key.slice('creative_'.length);
                      // Snapshot zuerst, dann Live-DB
                      const c = (snap && snap.bild_url) ? snap : (creatives || []).find(x => x.id === id);
                      return (
                        <li key={key} className="review-k-creative">
                          {c?.bild_url
                            ? <img src={c.bild_url} alt="" className="review-k-thumb" />
                            : <div className="review-k-thumb review-k-thumb-missing" title="Bild nicht mehr verfügbar">—</div>}
                          <div className="review-k-body">
                            <div className="review-k-label">
                              <span className="review-k-pill">{fmtLabels[c?.format] || c?.format || 'Creative'}</span>
                              {c?.typ === 'video' && <span className="review-k-pill review-k-pill-video">Video</span>}
                              {!c?.bild_url && <span className="review-k-warning">⚠ Bild nicht mehr verfügbar</span>}
                            </div>
                            <div className="review-k-text">{text}</div>
                          </div>
                        </li>
                      );
                    }
                    if (key.startsWith('adcopy_')) {
                      const id = key.slice('adcopy_'.length);
                      const stil = snap?.stil || (adcopies || []).find(x => x.id === id)?.stil;
                      return (
                        <li key={key} className="review-k-adcopy">
                          <div className="review-k-label">
                            <span className="review-k-pill review-k-pill-style">{stilLabels[stil] || stil || 'Ad-Copy'}</span>
                          </div>
                          <div className="review-k-text">{text}</div>
                        </li>
                      );
                    }
                    const label = key === 'funnel' ? 'Funnel' : key === 'allgemein' ? 'Allgemein' : key;
                    return (
                      <li key={key}>
                        <span className="review-k-label">{label}:</span>
                        <span className="review-k-text">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* ─────── Creatives ─────── */}
      <fieldset className="formular-section">
        <legend>Creatives ({creatives.length})</legend>
        {creatives.length === 0 ? (
          <div className="motiv-sub">Keine Creatives für dieses Projekt.</div>
        ) : (
          <>
            <label className="export-select-all">
              <input type="checkbox" checked={allCreativesSelected} onChange={toggleAllCreatives} />
              <span>Alle auswählen ({selectedCreatives.size}/{creatives.length})</span>
            </label>
            <div className="export-grid">
              {creatives.map((c, i) => {
                const checked = selectedCreatives.has(c.id);
                return (
                  <label key={c.id} className={`export-card ${checked ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCreative(c.id)} />
                    <div
                      className="export-thumb"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setLightboxIndex(i); }}
                      style={{ cursor: 'zoom-in', position: 'relative' }}
                      title="Klicken für Groß-Ansicht"
                    >
                      {c.typ === 'video'
                        ? <video src={c.bild_url} preload="metadata" muted playsInline />
                        : <img src={c.bild_url} alt="" loading="lazy" />}
                      <span className={`format-badge format-${c.format}`}>{badgeFor(c)}</span>
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute', bottom: 6, right: 6,
                          background: 'rgba(0,0,0,0.6)', color: '#fff',
                          padding: '2px 6px', borderRadius: 100, fontSize: 10,
                          pointerEvents: 'none',
                        }}
                      >🔍 Groß-Ansicht</span>
                    </div>
                    <div className="export-date">
                      {new Date(c.created_at).toLocaleDateString('de-DE')}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </fieldset>

      {/* ─────── Ad Copies ─────── */}
      <fieldset className="formular-section">
        <legend>Ad Copies ({adcopies.length})</legend>
        {adcopies.length === 0 ? (
          <div className="motiv-sub">Keine Ad-Copies generiert. Wechsle zum „Ad Copies"-Tab und generiere sie zuerst.</div>
        ) : (
          <div className="export-adcopies">
            {['emotional', 'benefit', 'kompakt'].map(stil => {
              const a = adcopies.find(x => x.stil === stil);
              if (!a) return null;
              const checked = selectedAdcopies.has(a.id);
              return (
                <div key={a.id} className={`export-adcopy ${checked ? 'is-checked' : ''}`}>
                  <label className="export-adcopy-head">
                    <input type="checkbox" checked={checked} onChange={() => toggleAdcopy(a.id)} />
                    <strong>{STYLE_LABEL[a.stil]}</strong>
                    {a.bearbeitet && <span className="adcopy-edited-badge">bearbeitet</span>}
                    <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.preventDefault(); copyAdcopy(a); }}>
                      {copiedId === a.id ? '✓ Kopiert' : 'Kopieren'}
                    </button>
                  </label>
                  <pre className="export-adcopy-text">{a.text}</pre>
                </div>
              );
            })}
          </div>
        )}
      </fieldset>

      {/* ─────── Funnel ─────── */}
      <fieldset className="formular-section">
        <legend>Funnel</legend>
        {!funnel ? (
          <div className="motiv-sub">Kein Funnel angelegt.</div>
        ) : (
          <div className="export-funnel">
            <div className="funnel-publish-status" style={{ marginBottom: 8 }}>
              <span className={`funnel-status-dot ${funnel.veroeffentlicht ? 'is-live' : ''}`} />
              <strong>{funnel.veroeffentlicht ? 'Live' : 'Entwurf'}</strong>
            </div>
            {data?.funnel_url && (
              <a href={data.funnel_url} target="_blank" rel="noreferrer" className="funnel-url-link">{data.funnel_url}</a>
            )}
          </div>
        )}
      </fieldset>

      {/* ─────── Download-Buttons ─────── */}
      <div className="export-actions">
        <button className="btn-ghost" onClick={downloadZip} disabled={busy || selectedCreatives.size === 0}>
          {busy === 'zip' ? 'Erstelle ZIP…' : `Creatives als ZIP (${selectedCreatives.size})`}
        </button>
        <button className="btn-ghost" onClick={downloadPdf} disabled={busy || selectedAdcopies.size === 0}>
          {busy === 'pdf' ? 'Erstelle PDF…' : `Ad Copies als PDF (${selectedAdcopies.size})`}
        </button>
        <button className="btn-ghost" onClick={downloadAlles} disabled={busy || (selectedCreatives.size === 0 && selectedAdcopies.size === 0)}>
          {busy === 'alles' ? 'Lade alles…' : 'Alles herunterladen'}
        </button>
        <button className="btn-ghost" onClick={() => setShowTermin(true)} disabled={!kunde?.email}>
          📅 Termin-Einladung senden
        </button>
        {/* Kontextabhaengige Send-Buttons:
            - Wenn noch NIE ein Entwurfsversand raus ist → nur "Entwuerfe senden" (Runde 1)
            - Sonst: "Erneut senden" IMMER + "Ueberarbeitete Runde" NUR wenn Kunde
              reagiert hat (freigegeben oder aenderungen) */}
        {(() => {
          const hatteVersand = !!letzterEntwurfsVersand;
          const hatKundenReaktion = review && (review.status === 'freigegeben' || review.status === 'aenderungen' || review.manuell_beantwortet);
          if (!hatteVersand) {
            // Erstversand — eigener Modus, KEIN 'new_round' (sonst geht die Mail
            // als "überarbeitete Entwürfe Runde 1" raus).
            return (
              <button className="btn-primary" onClick={() => openMailModal('first')} disabled={!kunde?.email}>
                Entwürfe an Kunden senden
              </button>
            );
          }
          return (
            <>
              <button
                className={hatKundenReaktion ? 'btn-ghost' : 'btn-primary'}
                onClick={() => openMailModal('same_round')}
                disabled={!kunde?.email}
                title="Gleiche Entwürfe nochmal — Kunde kann wieder kommentieren"
              >
                ↩️ Erneut senden (Runde {Number(review?.runde) || 1})
              </button>
              {hatKundenReaktion && (
                <button
                  className="btn-primary"
                  onClick={() => openMailModal('new_round')}
                  disabled={!kunde?.email}
                  title="Nach Überarbeitung — startet Feedbackrunde X+1"
                >
                  📤 Überarbeitete Entwürfe senden (Runde {(Number(review?.runde) || 1) + 1})
                </button>
              )}
            </>
          );
        })()}
        <span
          style={{ display: 'block', flexBasis: '100%', fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}
        >
          {letzterEntwurfsVersand
            ? '↩️ Erneut senden = gleiche Runde, Kunde kann wieder kommentieren · 📤 Überarbeitete Runde = frische Runde nach Anpassungen'
            : ''}
        </span>
      </div>
      {!kunde?.email && <div className="motiv-sub" style={{ marginTop: 6 }}>Kunden-E-Mail fehlt — bitte erst beim Kunden hinterlegen.</div>}

      {/* ─────── Kampagne ist Live melden ─────── */}
      <fieldset className="formular-section" style={{ marginTop: 22 }}>
        <legend>Kampagne live melden</legend>
        {letzteKampagneLive ? (
          <div className="versand-status" style={{ marginBottom: 10 }}>
            <span>🚀 „Kampagne ist live"-Mail gesendet am <strong>{new Date(letzteKampagneLive.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong> an <strong>{letzteKampagneLive.empfaenger}</strong> · <em>Bereits gemeldet — erneut senden überschreibt diesen Hinweis</em></span>
          </div>
        ) : (
          <p className="pane-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Sobald die Kampagne tatsächlich online ist, dem Kunden Bescheid geben — er bekommt eine kurze Mail mit Link zur Bewerberliste. Das Projekt wird automatisch auf Status <strong>Live</strong> gesetzt.
          </p>
        )}
        <button
          className={letzteKampagneLive ? 'btn-ghost' : 'btn-primary'}
          onClick={() => setShowGoLive(true)}
          disabled={!kunde?.email}
        >
          🚀 Kampagne als Live melden
        </button>
        {!kunde?.email && <div className="motiv-sub" style={{ marginTop: 6 }}>Kunden-E-Mail fehlt — bitte erst beim Kunden hinterlegen.</div>}
      </fieldset>

      {/* ─────── Kampagne pausiert melden ─────── */}
      <PauseFieldset
        kunde={kunde}
        job={job}
        letzteKampagnePause={letzteKampagnePause}
        onKundeUpdated={() => reload?.()}
        onSent={() => api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {})}
      />

      {/* ─────── Kunden-Reaktivierung ─────── */}
      <fieldset className="formular-section" style={{ marginTop: 22 }}>
        <legend>Kunden-Reaktivierung</legend>
        {letzteReaktivierung ? (
          <div className="versand-status" style={{ marginBottom: 10 }}>
            <span>🔄 Reaktivierungs-Mail gesendet am <strong>{new Date(letzteReaktivierung.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong> an <strong>{letzteReaktivierung.empfaenger}</strong></span>
          </div>
        ) : (
          <p className="pane-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Sende frische KI-Creatives an den Kunden, um ihn nach Kampagnen-Ende zu reaktivieren.
            Im Modal kannst du den Text anpassen, Creatives auswählen und optional einen Task in Close anlegen.
          </p>
        )}
        <button
          className="btn-primary"
          onClick={openReakModal}
          disabled={!kunde?.email || (data?.creatives || []).filter(c => c.typ !== 'video' && c.bild_url).length === 0}
        >
          🔄 Neue Creatives zur Reaktivierung schicken
        </button>
        {(data?.creatives || []).filter(c => c.typ !== 'video' && c.bild_url).length === 0 && (
          <div className="motiv-sub" style={{ marginTop: 6 }}>Keine Bild-Creatives vorhanden — bitte zuerst generieren.</div>
        )}
      </fieldset>

      {/* ─────── Versand-Historie ─────── */}
      {versand.length > 0 && (
        <fieldset className="formular-section" style={{ marginTop: 22 }}>
          <legend>Versand-Historie ({versand.length})</legend>
          <div className="bewerbungen-list">
            {versand.map(v => (
              <div key={v.id} className="bewerbung-row">
                <strong>{v.empfaenger}</strong>
                <span>{v.betreff || ''}</span>
                <span className="bewerbung-date">{new Date(v.created_at).toLocaleString('de-DE')}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {/* ─────── Mail-Modal ─────── */}
      <Modal
        open={showMail}
        onClose={() => !mailBusy && setShowMail(false)}
        title="Entwürfe an Kunden senden"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowMail(false)} disabled={mailBusy}>Abbrechen</button>
            <button className="btn-primary" onClick={() => setShowPreflight(true)} disabled={mailBusy || !mailForm.to.trim()}>
              {mailBusy ? 'Sende…' : 'Weiter zum Check…'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Mail mit den ausgewählten Creatives ({selectedCreatives.size}), Ad-Copies ({selectedAdcopies.size})
          {mailForm.include_funnel && funnel?.veroeffentlicht ? ' und Funnel-Link' : ''} wird an den Kunden gesendet.
        </p>
        <div className="form-grid">
          <label className="field field-full">
            <span>An</span>
            <input type="email" value={mailForm.to} onChange={e => setMailForm({ ...mailForm, to: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Betreff</span>
            <input value={mailForm.betreff} onChange={e => setMailForm({ ...mailForm, betreff: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Anschreiben {anschreibensBusy && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>(KI generiert…)</span>}</span>
            <textarea rows={5} value={mailForm.anschreiben} onChange={e => setMailForm({ ...mailForm, anschreiben: e.target.value })} />
          </label>
          {data?.funnel_url && (
            <label className="field-checkbox">
              <input type="checkbox" checked={mailForm.include_funnel} onChange={e => setMailForm({ ...mailForm, include_funnel: e.target.checked })} />
              <span>Funnel-Link „Vorschau ansehen" mit einbinden</span>
            </label>
          )}
        </div>
        {mailMsg && (
          <div className={`form-msg${mailErr ? ' alert alert-error' : ''}`}
            style={{ marginTop: 10, ...(mailErr ? { color: '#b00020', fontWeight: 600 } : {}) }}>
            {mailErr ? '⚠️ ' : ''}{mailMsg}
          </div>
        )}
      </Modal>

      {/* ─────── Lightbox für Creative-Auswahl ─────── */}
      {lightboxIndex !== null && creatives.length > 0 && (
        <Lightbox
          items={creatives}
          index={Math.max(0, Math.min(lightboxIndex, creatives.length - 1))}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          isSelected={c => selectedCreatives.has(c.id)}
          onToggleSelect={c => toggleCreative(c.id)}
          filenameFor={c => `creative-${c.format}-${c.id.slice(0, 8)}.${c.typ === 'video' ? 'mp4' : 'png'}`}
        />
      )}

      {/* ─────── Termin-Einladung ─────── */}
      <TerminEinladungModal
        open={showTermin}
        onClose={() => setShowTermin(false)}
        kunde={kunde}
        jobId={job?.id}
        onKundeUpdated={() => reload?.()}
        onSent={() => api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {})}
      />

      {/* ─────── Reminder-Modal ─────── */}
      <Modal
        open={showReminder}
        onClose={() => !reminderBusy && setShowReminder(false)}
        title="🔔 Reminder an Kunden senden"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowReminder(false)} disabled={reminderBusy}>Abbrechen</button>
            <button className="btn-primary" disabled={reminderBusy || !kunde?.email}
              onClick={async () => {
                setReminderBusy(true);
                try {
                  await api(`/jobs/${job.id}/export/entwurf-reminder`, {
                    method: 'POST',
                    body: { to: kunde?.email, customText: reminderText.trim() || null },
                  });
                  api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
                  setShowReminder(false);
                } catch (err) { alert(`Senden fehlgeschlagen: ${err.message}`); }
                finally { setReminderBusy(false); }
              }}
            >
              {reminderBusy ? 'Sende…' : 'Reminder senden'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Kurze Nachfrage an <strong>{kunde?.email}</strong>. Enthält den Review-Link zur Freigabe.
        </p>
        <CloseLeadWarnung kunde={kunde} onSaved={() => reload?.()} />
        <label className="field field-full">
          <span>Text (Du-Form, editierbar)</span>
          <textarea rows={9} value={reminderText} onChange={e => setReminderText(e.target.value)} />
        </label>
      </Modal>

      {/* ─────── Kunde hat manuell geantwortet ─────── */}
      <Modal
        open={showManuell}
        onClose={() => !manuellBusy && setShowManuell(false)}
        title="✓ Kunde hat anderweitig geantwortet"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowManuell(false)} disabled={manuellBusy}>Abbrechen</button>
            <button className="btn-primary" disabled={manuellBusy}
              onClick={async () => {
                setManuellBusy(true);
                try {
                  await api(`/jobs/${job.id}/export/review-manuell`, {
                    method: 'POST',
                    body: { status: manuellForm.status, notiz: manuellForm.notiz.trim() || null },
                  });
                  // Review + Historie neu laden
                  api(`/jobs/${job.id}/export/review`).then(r => { setReview(r.review); setRunden(r.runden || []); }).catch(() => {});
                  api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
                  setShowManuell(false);
                } catch (err) { alert(`Fehler: ${err.message}`); }
                finally { setManuellBusy(false); }
              }}
            >
              {manuellBusy ? 'Speichere…' : 'Ergebnis übernehmen'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Der Kunde hat telefonisch oder per Mail geantwortet. Setze den Review-Status, damit die 7-Tage-Erinnerung stoppt und der Projekt-Status entsprechend springt.
        </p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: manuellForm.status === 'freigegeben' ? '#dcfce7' : '#f4f3f0', borderRadius: 8, cursor: 'pointer' }}>
            <input type="radio" checked={manuellForm.status === 'freigegeben'}
              onChange={() => setManuellForm(f => ({ ...f, status: 'freigegeben' }))} />
            <span><strong>✅ Freigegeben</strong> (telefonisch / per Mail) — Projekt geht auf „Go"</span>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: manuellForm.status === 'aenderungen' ? '#fef3c7' : '#f4f3f0', borderRadius: 8, cursor: 'pointer' }}>
            <input type="radio" checked={manuellForm.status === 'aenderungen'}
              onChange={() => setManuellForm(f => ({ ...f, status: 'aenderungen' }))} />
            <span><strong>📝 Änderungswünsche</strong> (telefonisch / per Mail) — Projekt geht auf „Feedbackschleife"</span>
          </label>
        </div>
        <label className="field field-full">
          <span>Notiz (optional) — was hat der Kunde gesagt?</span>
          <textarea rows={3} value={manuellForm.notiz}
            onChange={e => setManuellForm(f => ({ ...f, notiz: e.target.value }))}
            placeholder="z. B. „Am Telefon freigegeben, wir starten am Montag." />
        </label>
      </Modal>

      {/* ─────── Go-Live-Modal ─────── */}
      <Modal
        open={showGoLive}
        onClose={() => !goLiveBusy && setShowGoLive(false)}
        title="🚀 Kampagne als Live melden"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowGoLive(false)} disabled={goLiveBusy}>Abbrechen</button>
            <button
              className="btn-primary"
              disabled={goLiveBusy || !kunde?.email}
              onClick={async () => {
                setGoLiveBusy(true);
                try {
                  await api(`/jobs/${job.id}/export/kampagne-live`, { method: 'POST', body: { to: kunde?.email } });
                  api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
                  setShowGoLive(false);
                  alert('Mail verschickt + Projekt auf Live gesetzt.');
                } catch (err) {
                  alert(`Senden fehlgeschlagen: ${err.message}`);
                } finally { setGoLiveBusy(false); }
              }}
            >
              {goLiveBusy ? 'Sende…' : 'Jetzt live melden'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          {letzteKampagneLive
            ? <>Bereits am <strong>{new Date(letzteKampagneLive.created_at).toLocaleDateString('de-DE')}</strong> gemeldet — beim erneuten Senden wird die Meldung überschrieben.</>
            : <>Die „🚀 Deine Kampagne ist live!"-Mail geht an <strong>{kunde?.email}</strong>. Das Projekt wird automatisch auf Status <strong>Live</strong> gesetzt (start_phase1 = heute, ende_phase1 = +30 Tage).</>}
        </p>
        <CloseLeadWarnung kunde={kunde} onSaved={() => reload?.()} />
      </Modal>

      {/* ─────── Preflight-Check-Modal ─────── */}
      <EntwurfPreflightModal
        open={showPreflight}
        onClose={() => !mailBusy && setShowPreflight(false)}
        kunde={kunde}
        creatives={(data?.creatives || []).filter(c => selectedCreatives.has(c.id))}
        jobStelle={job?.stelle}
        isRunde={mailForm.resend_mode === 'new_round'}
        istResend={mailForm.resend_mode === 'same_round'}
        onKundeUpdated={() => reload?.()}
        onConfirm={async () => {
          setShowPreflight(false);
          await sendMail();
        }}
      />

      {/* ─────── Reaktivierungs-Modal ─────── */}
      <Modal
        open={showReak}
        onClose={() => !reakBusy && setShowReak(false)}
        title="🔄 Neue Creatives zur Reaktivierung schicken"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowReak(false)} disabled={reakBusy}>Abbrechen</button>
            <button
              className="btn-primary"
              onClick={sendReak}
              disabled={reakBusy || !reakForm.to.trim() || reakForm.selected.size === 0 || anredeOffen(kunde)}
            >
              {reakBusy ? 'Sende…' : 'Absenden'}
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Die Mail enthält nur die ausgewählten Creatives (max. 6 Bilder) und einen Termin-Button.
          Kein Funnel, keine Ad-Copies, keine Review-Seite.
        </p>

        <CloseLeadWarnung kunde={kunde} onSaved={() => reload?.()} />
        <AnredeAbfrage kunde={kunde} onSaved={(k) => {
          reload?.();
          // Vorbelegten Text auf die frisch gesetzte Anrede umstellen.
          setReakForm(prev => ({ ...prev, customText: buildReakText(k) }));
        }} />

        {/* Creatives auswählen */}
        <div className="form-grid">
          <div className="field field-full">
            <span>Creatives ({reakForm.selected.size} ausgewählt)</span>
            <div className="export-grid" style={{ marginTop: 8 }}>
              {(data?.creatives || []).filter(c => c.typ !== 'video' && c.bild_url).map(c => {
                const checked = reakForm.selected.has(c.id);
                return (
                  <label key={c.id} className={`export-card ${checked ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleReakCreative(c.id)} />
                    <div className="export-thumb">
                      <img src={c.bild_url} alt="" loading="lazy" />
                      <span className={`format-badge format-${c.format}`}>{badgeFor(c)}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            {reakForm.selected.size > 6 && (
              <div className="motiv-sub" style={{ marginTop: 6, color: 'var(--warn, #c87)' }}>
                In der Mail werden maximal 6 Bilder eingebettet — der Rest wird ignoriert.
              </div>
            )}
          </div>

          <label className="field field-full">
            <span>An</span>
            <input type="email" value={reakForm.to} onChange={e => setReakForm({ ...reakForm, to: e.target.value })} />
          </label>

          <label className="field field-full">
            <span>Mail-Text (Du-Form, bearbeitbar)</span>
            <textarea rows={10} value={reakForm.customText} onChange={e => setReakForm({ ...reakForm, customText: e.target.value })} />
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={reakForm.create_close_task}
              onChange={e => setReakForm({ ...reakForm, create_close_task: e.target.checked })}
            />
            <span>Task in Close anlegen (Daniel Nowag, fällig in 7 Tagen) + Note am Lead</span>
          </label>
        </div>

        {reakMsg && <div className="form-msg" style={{ marginTop: 10 }}>{reakMsg}</div>}
      </Modal>
    </div>
  );
}

/* ═══════════════════ Zahlungen / PayPal ═══════════════════ */

function ZahlungenSection({ job, kunde, onKundeUpdated }) {
  const [zahlungen, setZahlungen] = useState([]);   // Alt-Bestand (PayPal-Zahlungen)
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState(null); // Alt-Zahlung für Send-Modal

  // Rechnungen des verknüpften Kunden — gleiche Ansicht wie auf der Kundenseite
  const [invoices, setInvoices] = useState([]);
  const [invoicesBusy, setInvoicesBusy] = useState(false);
  const [invoicesSyncing, setInvoicesSyncing] = useState(false);
  const [sendInvoiceModal, setSendInvoiceModal] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api(`/zahlungen?job_id=${job.id}`);
      setZahlungen(res.zahlungen || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  async function loadInvoices() {
    if (!kunde?.id) return;
    setInvoicesBusy(true);
    try {
      const res = await api(`/invoices?customer_id=${kunde.id}`);
      setInvoices(res.invoices || []);
    } catch (err) { console.error(err); }
    finally { setInvoicesBusy(false); }
  }
  useEffect(() => { loadInvoices(); /* eslint-disable-next-line */ }, [kunde?.id]);

  async function syncInvoicesNow() {
    setInvoicesSyncing(true);
    try {
      await api('/invoices/sync', { method: 'POST' });
      await loadInvoices();
    } catch (err) { alert(err.message); }
    finally { setInvoicesSyncing(false); }
  }

  // Vorbelegung fürs einheitliche Werbekosten-Modal
  const defaultLabel = `Werbebudget ${job.stelle || 'Stelle'}`.trim();

  async function createEasybillManually(z) {
    if (!confirm('easybill-Rechnung jetzt erstellen?')) return;
    try {
      const res = await api(`/zahlungen/${z.id}/easybill/manual`, { method: 'POST', body: {} });
      setZahlungen(prev => prev.map(x => x.id === z.id ? res.zahlung : x));
    } catch (err) { alert(err.message); }
  }
  async function sendRechnung(z) {
    if (!confirm(`Rechnung als PDF an ${kunde?.email || 'Kunden'} senden?`)) return;
    try {
      await api(`/zahlungen/${z.id}/rechnung/send`, { method: 'POST', body: {} });
      alert('Rechnung verschickt.');
    } catch (err) { alert(err.message); }
  }
  function openPdf(z) {
    // PDF-Endpoint braucht Auth → wir laden mit fetch+Bearer und öffnen Blob
    (async () => {
      const sup = (await import('../../lib/supabase.js')).supabase;
      const token = (await sup.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/zahlungen/${z.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert('PDF konnte nicht geladen werden.'); return; }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    })();
  }

  async function sendMailConfirmed(z) {
    try {
      const res = await api(`/zahlungen/${z.id}/send`, { method: 'POST', body: {} });
      setZahlungen(prev => prev.map(x => x.id === z.id ? res.zahlung : x));
      setSendTarget(null);
    } catch (err) { alert(err.message); }
  }
  async function refreshStatus(z) {
    try {
      const res = await api(`/zahlungen/${z.id}/refresh`, { method: 'POST', body: {} });
      setZahlungen(prev => prev.map(x => x.id === z.id ? res.zahlung : x));
    } catch (err) { alert(err.message); }
  }
  async function deleteZahlung(z) {
    if (!confirm('Zahlung lokal entfernen? (Die PayPal-Rechnung bleibt bei PayPal bestehen.)')) return;
    try {
      await api(`/zahlungen/${z.id}`, { method: 'DELETE' });
      setZahlungen(prev => prev.filter(x => x.id !== z.id));
    } catch (err) { alert(err.message); }
  }

  function fmtEur(cent) {
    return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  return (
    <div className="zahlungen-section">
      {/* Rechnungen des verknüpften Kunden — dieselbe Komponente wie auf der
          Kundenseite, nur kompakter. */}
      <InvoicesSection
        compact
        kunde={kunde}
        invoices={invoices}
        busy={invoicesBusy}
        syncing={invoicesSyncing}
        onSync={syncInvoicesNow}
        onCreateAdBudget={() => setModalOpen(true)}
        onSendInvoice={inv => setSendInvoiceModal(inv)}
      />

      {!kunde?.id && (
        <div className="muted" style={{ padding: '12px 0' }}>
          Kein Kunde mit diesem Projekt verknüpft — Rechnungen können nicht geladen werden.
        </div>
      )}

      {/* Alt-Bestand: PayPal-Zahlungen aus dem früheren Zahlungslink-Flow.
          Bleiben inkl. aller Aktionen erhalten — hier hängen echte Zahlungsdaten dran. */}
      {(loading || zahlungen.length > 0) && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>
            Ältere Zahlungen{zahlungen.length ? ` (${zahlungen.length})` : ''} — früherer PayPal-Zahlungslink-Flow
          </summary>
          <div style={{ marginTop: 10 }}>
            {loading ? <div className="muted">Lade…</div> : (
            <table className="zahlungen-table">
              <thead><tr>
                <th>Datum</th><th>Netto</th><th>MwSt</th><th>Brutto</th><th>Status</th><th>easybill</th><th>Aktionen</th>
              </tr></thead>
              <tbody>
                {zahlungen.map(z => {
                  const netto  = z.betrag_netto  ?? Math.round((z.betrag_cent || 0) / 1.19);
                  const mwst   = z.betrag_mwst   ?? ((z.betrag_cent || 0) - netto);
                  const brutto = z.betrag_brutto ?? z.betrag_cent ?? 0;
                  return (
                    <tr key={z.id} className={`status-row-${z.status}`}>
                      <td>{new Date(z.created_at).toLocaleDateString('de-DE')}</td>
                      <td>{fmtEur(netto)}</td>
                      <td className="muted">{z.kleinunternehmer ? '—' : fmtEur(mwst)}</td>
                      <td><strong>{fmtEur(brutto)}</strong></td>
                      <td><span className={`zahlung-status zahlung-${z.status}`}>{statusLabel(z.status)}{z.bezahlt_am ? ' · ' + new Date(z.bezahlt_am).toLocaleDateString('de-DE') : ''}</span></td>
                      <td>
                        {z.easybill_invoice_number
                          ? <span className="zahlung-status zahlung-bezahlt" title={z.easybill_id}>{z.easybill_invoice_number}</span>
                          : z.easybill_status?.startsWith('fehler')
                            ? <span className="zahlung-status zahlung-ueberfaellig" title={z.easybill_status}>⚠ Fehler</span>
                            : z.status === 'bezahlt'
                              ? <span className="muted">⏳ wird erstellt</span>
                              : <span className="muted">—</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-ghost btn-sm" onClick={() => refreshStatus(z)} title="PayPal-Status aktualisieren">↻</button>
                        {z.pay_link && z.status !== 'bezahlt' && (
                          <button className="btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(z.pay_link); } catch {} }}>Pay-Link</button>
                        )}
                        {z.status !== 'bezahlt' && <button className="btn-ghost btn-sm" onClick={() => setSendTarget(z)}>Mail (Pay)</button>}
                        {z.status === 'bezahlt' && !z.easybill_id && (
                          <button className="btn-ghost btn-sm" onClick={() => createEasybillManually(z)}>Rechnung erstellen</button>
                        )}
                        {z.easybill_id && (
                          <>
                            <button className="btn-ghost btn-sm" onClick={() => openPdf(z)}>PDF</button>
                            <button className="btn-ghost btn-sm" onClick={() => sendRechnung(z)}>Mail (RE)</button>
                          </>
                        )}
                        <button className="btn-ghost btn-sm btn-danger" onClick={() => deleteZahlung(z)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </details>
      )}

      {/* Einheitliches Werbekosten-Modal — identisch zur Kundenseite, hier nur
          mit vorbelegtem Kontext (Kunde aus dem Job, Bezeichnung mit Stelle). */}
      <StandaloneAdBudgetModal
        open={modalOpen}
        kunde={kunde}
        defaultLabel={defaultLabel}
        onClose={() => setModalOpen(false)}
        onCreated={(invoice) => {
          setModalOpen(false);
          setInvoices(prev => [invoice, ...prev]);
          setSendInvoiceModal(invoice); // sofort Versand-Option anbieten (wie auf der Kundenseite)
        }}
      />

      <SendInvoiceMailModal
        invoice={sendInvoiceModal}
        kunde={kunde}
        onKundeSaved={() => reload?.()}
        onClose={() => setSendInvoiceModal(null)}
        onSent={() => { setSendInvoiceModal(null); loadInvoices(); }}
      />

      {/* Zahlungslink-Send-Modal mit Close-Lead-Warnung */}
      <Modal
        open={!!sendTarget}
        onClose={() => setSendTarget(null)}
        title="Zahlungslink per Mail senden"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setSendTarget(null)}>Abbrechen</button>
            <button className="btn-primary" onClick={() => sendMailConfirmed(sendTarget)} disabled={!kunde?.email}>
              Senden
            </button>
          </>
        }
      >
        <p className="pane-hint">
          Der Zahlungslink wird an <strong>{kunde?.email || '(keine Mail hinterlegt)'}</strong> gesendet.
          {sendTarget && (
            <> Betrag: <strong>{fmtEur(sendTarget.betrag_brutto ?? sendTarget.betrag_cent ?? 0)}</strong>.</>
          )}
        </p>
        <CloseLeadWarnung kunde={kunde} onSaved={onKundeUpdated} />
      </Modal>
    </div>
  );
}

function statusLabel(s) {
  return ({
    entwurf: 'Entwurf', offen: '⏳ Offen', bezahlt: '✅ Bezahlt',
    ueberfaellig: '⚠ Überfällig', storniert: 'Storniert',
  })[s] || s;
}

/* Pausen-Mail: Modal + Sende-Fluss. Setzt beim Versand automatisch Projekt-
   Status auf „Pausiert" und legt einen automatischen Kommentar an. */
function PauseFieldset({ kunde, job, letzteKampagnePause, onSent, onKundeUpdated }) {
  const defaultText = `Hallo ${kunde?.ansprechpartner || 'du'},\n\nwir müssen dich kurz informieren: Deine Kampagne ist aktuell aufgrund technischer Probleme pausiert. Wir arbeiten bereits an der Lösung und melden uns, sobald sie wieder live ist.\n\nDie Pausenzeit wird selbstverständlich hinten angehängt — dir entsteht kein Nachteil.`;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!kunde?.email) return;
    setBusy(true);
    try {
      await api(`/jobs/${job.id}/export/kampagne-pause`, {
        method: 'POST',
        body: { to: kunde.email, customText: text },
      });
      setOpen(false);
      onSent?.();
      alert('Pausen-Mail verschickt + Projekt auf „Pausiert" gesetzt.');
    } catch (err) {
      alert(`Senden fehlgeschlagen: ${err.message}`);
    } finally { setBusy(false); }
  }

  return (
    <fieldset className="formular-section" style={{ marginTop: 22 }}>
      <legend>Kampagne pausieren melden</legend>
      {letzteKampagnePause ? (
        <div className="versand-status" style={{ marginBottom: 10 }}>
          <span>⏸ Pausen-Mail gesendet am <strong>{new Date(letzteKampagnePause.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong> an <strong>{letzteKampagnePause.empfaenger}</strong></span>
        </div>
      ) : (
        <p className="pane-hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Bei technischen Problemen dem Kunden Bescheid geben — das Projekt wird automatisch auf Status <strong>Pausiert</strong> gesetzt (mit heutigem Datum) und ein Kommentar wird angelegt.
        </p>
      )}
      <button
        className={letzteKampagnePause ? 'btn-ghost' : 'btn-primary'}
        onClick={() => { setText(defaultText); setOpen(true); }}
        disabled={!kunde?.email}
      >
        ⏸ Kampagne als pausiert melden
      </button>
      {!kunde?.email && <div className="motiv-sub" style={{ marginTop: 6 }}>Kunden-E-Mail fehlt.</div>}

      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 640, maxWidth: '100%' }}>
            <h3 style={{ margin: '0 0 6px' }}>Pausen-Mail an {kunde?.email}</h3>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 12px' }}>
              Text ist editierbar. Absender + BCC laufen wie bei den Kampagnen-Mails.
            </p>
            <CloseLeadWarnung kunde={kunde} onSaved={onKundeUpdated} />
            <textarea
              rows={12} value={text} onChange={e => setText(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, lineHeight: 1.55, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>
              <button className="btn-primary" onClick={send} disabled={busy}>
                {busy ? 'Sende…' : '⏸ Jetzt senden'}
              </button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Kompakte Timeline der Runden: pro Runde je zwei Ereignisse — Versand
 * (aus talentone_versand.typ='entwurf_runde_N') und Feedback (aus
 * talentone_reviews.runde). Sortiert absteigend, kompakter Chip-Look.
 */
function RundenTimeline({ versand, runden }) {
  const events = [];
  for (const v of versand || []) {
    const m = (v.typ || '').match(/^entwurf_runde_(\d+)$/);
    if (!m && v.typ === null && v.betreff) {
      // Legacy-Versand vor Runden-Feld: als Runde 1 werten
      events.push({
        kind: 'versand', runde: 1, ts: v.created_at,
        label: `📤 Runde 1 gesendet · ${v.empfaenger || ''}`,
      });
    } else if (m) {
      const n = Number(m[1]);
      events.push({
        kind: 'versand', runde: n, ts: v.created_at,
        label: `📤 Runde ${n} gesendet · ${v.empfaenger || ''}`,
      });
    }
  }
  for (const r of runden || []) {
    if (r.status === 'aenderungen') {
      events.push({ kind: 'feedback', runde: r.runde || 1, ts: r.updated_at, label: `📝 Feedback erhalten (Runde ${r.runde || 1})` });
    } else if (r.status === 'freigegeben') {
      events.push({ kind: 'freigabe', runde: r.runde || 1, ts: r.updated_at, label: `✅ Freigegeben (Runde ${r.runde || 1})` });
    }
  }
  if (events.length === 0) return null;
  events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return (
    <div className="runden-timeline" style={{
      padding: '10px 14px', marginBottom: 12, borderRadius: 8,
      background: 'var(--gray-50)', border: '1px solid var(--line)',
      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12,
    }}>
      <strong style={{ marginRight: 4 }}>Verlauf:</strong>
      {events.map((e, i) => (
        <span
          key={i}
          title={new Date(e.ts).toLocaleString('de-DE')}
          style={{
            padding: '3px 8px', borderRadius: 100,
            background: e.kind === 'freigabe' ? '#dcfce7' : e.kind === 'feedback' ? '#fef3c7' : '#e0eaf7',
            color:      e.kind === 'freigabe' ? '#166534' : e.kind === 'feedback' ? '#92400e' : '#1e3a8a',
            fontSize: 11, fontWeight: 600,
          }}
        >
          {e.label} · {new Date(e.ts).toLocaleDateString('de-DE')}
        </span>
      ))}
    </div>
  );
}
