import { useEffect, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { downloadFromUrl } from '../../lib/files.js';
import Modal from '../../components/Modal.jsx';
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
  const { job, kunde } = useJob();
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
  const [anschreibensBusy, setAnschreibensBusy] = useState(false);

  // Versand-Historie + Review
  const [versand, setVersand] = useState([]);
  const [review, setReview] = useState(null);
  const [showKommentare, setShowKommentare] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api(`/jobs/${job.id}/export`),
      api(`/jobs/${job.id}/export/versand`).catch(() => ({ versand: [] })),
      api(`/jobs/${job.id}/export/review`).catch(() => ({ review: null })),
    ])
      .then(([d, v, r]) => {
        setData(d);
        // alle Creatives + alle AdCopies vorausgewählt
        setSelectedCreatives(new Set((d.creatives || []).map(c => c.id)));
        setSelectedAdcopies(new Set((d.adcopies || []).map(a => a.id)));
        setVersand(v.versand || []);
        setReview(r.review);
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
  function openMailModal() {
    setMailForm({
      to: kunde?.email || '',
      betreff: `${kunde?.firmenname || 'Ihre Recruiting-Kampagne'} — Entwürfe zur Freigabe`,
      anschreiben: '',
      include_funnel: !!data?.funnel_url,
    });
    setMailMsg('');
    setShowMail(true);
    // Anschreiben-Vorschlag im Hintergrund laden
    setAnschreibensBusy(true);
    api(`/jobs/${job.id}/export/anschreiben`, { method: 'POST' })
      .then(r => setMailForm(prev => ({ ...prev, anschreiben: r.text || '' })))
      .catch(() => {})
      .finally(() => setAnschreibensBusy(false));
  }

  async function sendMail() {
    if (!mailForm.to.trim()) { setMailMsg('Empfänger-Mail fehlt.'); return; }
    setMailBusy(true);
    setMailMsg('');
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
        },
      });
      setMailMsg('Mail verschickt!');
      // Historie + Review nachladen
      api(`/jobs/${job.id}/export/versand`).then(v => setVersand(v.versand || [])).catch(() => {});
      api(`/jobs/${job.id}/export/review`).then(r => setReview(r.review)).catch(() => {});
      setTimeout(() => setShowMail(false), 1200);
    } catch (err) {
      setMailMsg(err.message);
    } finally {
      setMailBusy(false);
    }
  }

  if (loading) return <div className="card empty">Lade Export…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  const creatives = data?.creatives || [];
  const adcopies = data?.adcopies || [];
  const funnel = data?.funnel;
  const allCreativesSelected = creatives.length > 0 && selectedCreatives.size === creatives.length;

  const letzterVersand = versand[0];
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
      <ZahlungenSection job={job} kunde={kunde} />

      {/* ─────── Versand-Status oben ─────── */}
      {letzterVersand && (
        <div className="versand-status">
          <span>✅ Entwürfe gesendet am <strong>{new Date(letzterVersand.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong> an <strong>{letzterVersand.empfaenger}</strong></span>
          <button className="btn-ghost btn-sm" onClick={openMailModal} disabled={!kunde?.email}>
            Erneut senden
          </button>
        </div>
      )}

      {/* ─────── Review-Status ─────── */}
      {review && (review.status === 'freigegeben' || review.status === 'aenderungen') && (
        <div className={`review-status review-status-${review.status}`}>
          {review.status === 'freigegeben' ? (
            <strong>✅ Kunde hat freigegeben am {new Date(review.updated_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
          ) : (
            <>
              <div className="review-status-head">
                <strong>📝 Kunde hat Änderungswünsche</strong>
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
                    if (key.startsWith('creative_')) {
                      const id = key.slice('creative_'.length);
                      const c = (creatives || []).find(x => x.id === id);
                      return (
                        <li key={key} className="review-k-creative">
                          {c?.bild_url && <img src={c.bild_url} alt="" className="review-k-thumb" />}
                          <div className="review-k-body">
                            <div className="review-k-label">
                              <span className="review-k-pill">{fmtLabels[c?.format] || c?.format || 'Creative'}</span>
                              {c?.typ === 'video' && <span className="review-k-pill review-k-pill-video">Video</span>}
                            </div>
                            <div className="review-k-text">{text}</div>
                          </div>
                        </li>
                      );
                    }
                    if (key.startsWith('adcopy_')) {
                      const id = key.slice('adcopy_'.length);
                      const a = (adcopies || []).find(x => x.id === id);
                      return (
                        <li key={key} className="review-k-adcopy">
                          <div className="review-k-label">
                            <span className="review-k-pill review-k-pill-style">{stilLabels[a?.stil] || a?.stil || 'Ad-Copy'}</span>
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
              {creatives.map(c => {
                const checked = selectedCreatives.has(c.id);
                return (
                  <label key={c.id} className={`export-card ${checked ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCreative(c.id)} />
                    <div className="export-thumb">
                      {c.typ === 'video'
                        ? <video src={c.bild_url} preload="metadata" muted playsInline />
                        : <img src={c.bild_url} alt="" loading="lazy" />}
                      <span className={`format-badge format-${c.format}`}>{badgeFor(c)}</span>
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
        <button className="btn-primary" onClick={openMailModal} disabled={!kunde?.email}>
          Entwürfe an Kunden senden
        </button>
      </div>
      {!kunde?.email && <div className="motiv-sub" style={{ marginTop: 6 }}>Kunden-E-Mail fehlt — bitte erst beim Kunden hinterlegen.</div>}

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
            <button className="btn-primary" onClick={sendMail} disabled={mailBusy || !mailForm.to.trim()}>
              {mailBusy ? 'Sende…' : 'Mail senden'}
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
        {mailMsg && <div className="form-msg" style={{ marginTop: 10 }}>{mailMsg}</div>}
      </Modal>
    </div>
  );
}

/* ═══════════════════ Zahlungen / PayPal ═══════════════════ */

function ZahlungenSection({ job, kunde }) {
  const [zahlungen, setZahlungen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await api(`/zahlungen?job_id=${job.id}`);
      setZahlungen(res.zahlungen || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  // Form-State im Modal (Netto-Eingabe, automatische MwSt-Berechnung)
  const defaultDesc = `Werbebudget ${job.stelle || 'Stelle'} — ${kunde?.firmenname || ''}`.trim();
  const [betragNetto, setBetragNetto] = useState('');
  const [kleinunternehmer, setKleinunternehmer] = useState(false);
  const [leistungszeitraum, setLeistungszeitraum] = useState('');
  const [beschreibung, setBeschreibung] = useState(defaultDesc);
  const [faelligkeit, setFaelligkeit] = useState('');

  function parseNettoCent(input) {
    const s = String(input || '').replace(/\s+/g, '').replace(/€/g, '');
    const num = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : 0;
  }
  const nettoCent  = parseNettoCent(betragNetto);
  const mwstCent   = kleinunternehmer ? 0 : Math.round(nettoCent * 0.19);
  const bruttoCent = nettoCent + mwstCent;
  function fmtLive(c) { return (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

  function openModal() {
    setBetragNetto(''); setKleinunternehmer(false); setLeistungszeitraum('');
    setBeschreibung(defaultDesc); setFaelligkeit('');
    setError(''); setModalOpen(true);
  }

  async function createZahlung() {
    setError(''); setBusy(true);
    try {
      const res = await api(`/zahlungen/job/${job.id}`, {
        method: 'POST',
        body: {
          betrag_netto: betragNetto,
          kleinunternehmer,
          leistungszeitraum: leistungszeitraum || null,
          beschreibung,
          faelligkeit: faelligkeit || null,
        },
      });
      setZahlungen(prev => [res.zahlung, ...prev]);
      setModalOpen(false);
      try { await navigator.clipboard.writeText(res.zahlung.pay_link); } catch { /* noop */ }
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

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

  async function sendMail(z) {
    if (!confirm(`Zahlungslink per Mail an ${kunde?.email || 'Kunden'} senden?`)) return;
    try {
      const res = await api(`/zahlungen/${z.id}/send`, { method: 'POST', body: {} });
      setZahlungen(prev => prev.map(x => x.id === z.id ? res.zahlung : x));
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
      <div className="zahlungen-head">
        <div>
          <div className="zahlungen-title">💳 Zahlungen / Rechnungen (PayPal)</div>
          <p className="zahlungen-hint">Erstelle Zahlungslinks und sende sie direkt an {kunde?.firmenname || 'den Kunden'}.</p>
        </div>
        <button className="btn-primary btn-sm" onClick={openModal}>+ Zahlungslink erstellen</button>
      </div>

      {loading ? <div className="muted">Lade…</div> : (
        zahlungen.length === 0
          ? <div className="muted" style={{ padding: '12px 0' }}>Noch keine Zahlung angelegt.</div>
          : (
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
                        {z.status !== 'bezahlt' && <button className="btn-ghost btn-sm" onClick={() => sendMail(z)}>Mail (Pay)</button>}
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
          )
      )}

      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => !busy && setModalOpen(false)}
          title="Zahlungslink erstellen"
          footer={
            <div className="zahlung-modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)} disabled={busy}>
                Abbrechen
              </button>
              <button type="button" className="btn-zahlung-cta" onClick={createZahlung} disabled={busy || !nettoCent}>
                {busy ? '⏳ Erstelle…' : `💳 ${fmtLive(bruttoCent || 0)} anfordern`}
              </button>
            </div>
          }
        >
          <div className="form-grid">
            <label className="field field-full">
              <span>Netto-Betrag *</span>
              <input type="text" placeholder="z.B. 1500 oder 1.500,00" value={betragNetto} onChange={e => setBetragNetto(e.target.value)} autoFocus />
            </label>

            {/* Live-Brutto-Anzeige */}
            <div className="field field-full">
              <div className="brutto-box">
                <div className="brutto-row">
                  <span>Netto</span>
                  <strong>{fmtLive(nettoCent)}</strong>
                </div>
                <div className="brutto-row">
                  <span>+ 19% MwSt</span>
                  <strong className={kleinunternehmer ? 'muted' : ''}>{kleinunternehmer ? '—' : fmtLive(mwstCent)}</strong>
                </div>
                <div className="brutto-row brutto-row-total">
                  <span>= Brutto (PayPal)</span>
                  <strong>{fmtLive(bruttoCent)}</strong>
                </div>
              </div>
              <label className="checkbox-row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={kleinunternehmer} onChange={e => setKleinunternehmer(e.target.checked)} />
                <span>Kleinunternehmer §19 UStG (keine MwSt)</span>
              </label>
            </div>

            <label className="field">
              <span>Leistungszeitraum</span>
              <input type="text" placeholder="z.B. Juni 2026" value={leistungszeitraum} onChange={e => setLeistungszeitraum(e.target.value)} />
            </label>
            <label className="field">
              <span>Fälligkeit (optional)</span>
              <input type="date" value={faelligkeit} onChange={e => setFaelligkeit(e.target.value)} />
            </label>
            <label className="field field-full">
              <span>Beschreibung</span>
              <input type="text" value={beschreibung} onChange={e => setBeschreibung(e.target.value)} />
            </label>
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
          <p className="pane-hint" style={{ marginTop: 14 }}>
            Der PayPal-Zahlungslink wird über den <strong>Brutto-Betrag</strong> erstellt. Sobald der Kunde bezahlt hat, wird automatisch eine easybill-Rechnung erzeugt — du kannst sie dann als PDF herunterladen oder direkt an {kunde?.email || 'den Kunden'} versenden.
          </p>
        </Modal>
      )}
    </div>
  );
}

function statusLabel(s) {
  return ({
    entwurf: 'Entwurf', offen: '⏳ Offen', bezahlt: '✅ Bezahlt',
    ueberfaellig: '⚠ Überfällig', storniert: 'Storniert',
  })[s] || s;
}
