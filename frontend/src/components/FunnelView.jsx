import { useMemo, useState } from 'react';

/**
 * Wiederverwendbare Funnel-Anzeige — wird im Editor als Live-Vorschau
 * und in der öffentlichen Bewerbungsseite verwendet.
 *
 * Props:
 *  - funnel: { fragen: [{id, text, options}], bilder: {start, frage}, conversion_ziel }
 *  - job:    { stelle, region, gehalt, benefits[] }
 *  - kunde:  { firmenname, branche, logo_url, farben:{primaer,sekundaer,akzent} }
 *  - onSubmit?: ({name,email,telefon,antworten}) => Promise   // für Public, im Editor optional
 *  - frame?:  'phone' | null   (mit phone-frame in Editor)
 *  - readonly?: bool   (im Editor: Klicks fortschalten aber nicht submitten)
 */
export default function FunnelView({ funnel, job, kunde, onSubmit, frame, readonly }) {
  const [step, setStep] = useState(0); // 0 = Start, 1..N = Fragen, N+1 = Kontakt
  const [antworten, setAntworten] = useState({});
  const [contact, setContact] = useState({ name: '', email: '', telefon: '' });
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const fragen = Array.isArray(funnel?.fragen) ? funnel.fragen : [];
  const bilder = funnel?.bilder || {};
  const farben = kunde?.farben || {};
  const primaer = farben.primaer || '#0a0a0a';
  const akzent = farben.akzent || '#d4ff00';

  const totalFragen = fragen.length;
  const isStart = step === 0;
  const isContact = step === totalFragen + 1;
  const fragenIdx = step - 1; // bei step=1 → Frage 0
  const currentFrage = !isStart && !isContact ? fragen[fragenIdx] : null;
  const progress = totalFragen ? Math.min(step / (totalFragen + 1), 1) : 0;

  // Inline-Style mit Brand-Farben — als CSS Custom Properties
  const themeStyle = useMemo(() => ({
    '--fn-primaer': primaer,
    '--fn-akzent': akzent,
  }), [primaer, akzent]);

  function pickOption(option) {
    if (!currentFrage) return;
    setAntworten(prev => ({ ...prev, [currentFrage.id]: option }));
    setStep(step + 1);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readonly) {
      setSubmitDone(true);
      return;
    }
    if (!onSubmit) return;
    if (!contact.email.trim() && !contact.telefon.trim()) {
      setSubmitError('Bitte E-Mail oder Telefonnummer angeben.');
      return;
    }
    setSubmitBusy(true);
    setSubmitError('');
    try {
      const antwortenList = fragen.map(f => ({
        frage_id: f.id, frage_text: f.text, antwort: antworten[f.id] || null,
      }));
      await onSubmit({ ...contact, antworten: antwortenList });
      setSubmitDone(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitBusy(false);
    }
  }

  function reset() {
    setStep(0); setAntworten({}); setContact({ name: '', email: '', telefon: '' }); setSubmitDone(false);
  }

  const wrap = (content) => frame === 'phone'
    ? <div className="phone-frame"><div className="phone-screen">{content}</div></div>
    : <div className="funnel-screen">{content}</div>;

  if (submitDone) {
    return wrap(
      <div className="funnel-page funnel-thanks" style={themeStyle}>
        <div className="funnel-emoji">🎉</div>
        <h1>Vielen Dank!</h1>
        <p>Wir haben deine Bewerbung erhalten und melden uns bei dir.</p>
        {readonly && <button className="btn-ghost btn-sm" onClick={reset}>Vorschau zurücksetzen</button>}
      </div>
    );
  }

  /* Start-Seite */
  if (isStart) {
    const benefits = Array.isArray(job?.benefits) ? job.benefits.slice(0, 5) : [];
    return wrap(
      <div className="funnel-page funnel-start" style={themeStyle}>
        <header className="funnel-header">
          {kunde?.logo_url
            ? <img className="funnel-logo" src={kunde.logo_url} alt={kunde?.firmenname || ''} />
            : <span className="funnel-logo-fallback">{(kunde?.firmenname || '?').slice(0, 1)}</span>}
          <span className="funnel-firma">{kunde?.firmenname || ''}</span>
        </header>
        {bilder.start && (
          <div className="funnel-hero">
            <img src={bilder.start} alt="" />
          </div>
        )}
        <div className="funnel-body">
          <h1 className="funnel-stelle">{job?.stelle || 'Offene Stelle'}</h1>
          {job?.region && <div className="funnel-region">📍 {job.region}</div>}
          {benefits.length > 0 && (
            <ul className="funnel-benefits">
              {benefits.map((b, i) => <li key={i}>✅ {b}</li>)}
            </ul>
          )}
          <button
            className="funnel-cta"
            onClick={() => setStep(1)}
            disabled={totalFragen === 0 && !contact}
          >
            Jetzt in 1 Minute bewerben →
          </button>
        </div>
      </div>
    );
  }

  /* Frage-Screen */
  if (currentFrage) {
    return wrap(
      <div className="funnel-page funnel-question" style={themeStyle}>
        <header className="funnel-header funnel-header-mini">
          {kunde?.logo_url && <img className="funnel-logo-mini" src={kunde.logo_url} alt="" />}
          <span className="funnel-firma-mini">{kunde?.firmenname}</span>
        </header>
        <div className="funnel-progress">
          <div className="funnel-progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="funnel-progress-label">Frage {step} von {totalFragen}</div>
        {bilder.frage && (
          <div className="funnel-image-mini"><img src={bilder.frage} alt="" /></div>
        )}
        <div className="funnel-body">
          <h2 className="funnel-q">{currentFrage.text}</h2>
          <div className="funnel-options">
            {(currentFrage.options || []).map((opt, i) => (
              <button key={i} type="button" className="funnel-option" onClick={() => pickOption(opt)}>
                {opt}
              </button>
            ))}
          </div>
          <button type="button" className="funnel-back" onClick={() => setStep(step - 1)}>← zurück</button>
        </div>
      </div>
    );
  }

  /* Kontakt-Screen */
  return wrap(
    <div className="funnel-page funnel-contact" style={themeStyle}>
      <header className="funnel-header funnel-header-mini">
        {kunde?.logo_url && <img className="funnel-logo-mini" src={kunde.logo_url} alt="" />}
        <span className="funnel-firma-mini">{kunde?.firmenname}</span>
      </header>
      <div className="funnel-progress"><div className="funnel-progress-bar" style={{ width: '100%' }} /></div>
      <div className="funnel-body">
        <h2 className="funnel-q">Wie können wir dich erreichen?</h2>
        <p className="funnel-q-sub">Wir melden uns innerhalb von 24 h bei dir.</p>
        <form onSubmit={handleSubmit} className="funnel-contact-form">
          <label>
            <span>Name (optional)</span>
            <input type="text" value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} />
          </label>
          <label>
            <span>E-Mail</span>
            <input type="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} placeholder="du@beispiel.de" />
          </label>
          <label>
            <span>Telefon</span>
            <input type="tel" value={contact.telefon} onChange={e => setContact({ ...contact, telefon: e.target.value })} placeholder="0151 …" />
          </label>
          <p className="funnel-q-hint">Mindestens E-Mail oder Telefon angeben.</p>
          {submitError && <div className="funnel-error">{submitError}</div>}
          <button type="submit" className="funnel-cta" disabled={submitBusy}>
            {submitBusy ? 'Sende…' : (funnel?.conversion_ziel || 'Bewerbung abschicken')}
          </button>
        </form>
        <button type="button" className="funnel-back" onClick={() => setStep(step - 1)}>← zurück</button>
      </div>
    </div>
  );
}
