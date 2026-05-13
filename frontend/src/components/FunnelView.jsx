import { useEffect, useMemo, useState } from 'react';

/**
 * Wiederverwendbare Funnel-Anzeige — wird im Editor als Live-Vorschau
 * und in der öffentlichen Bewerbungsseite verwendet.
 *
 * Props:
 *  - funnel: { screens: [...], conversion_ziel }
 *  - job:    { stelle, region, gehalt, benefits[] }
 *  - kunde:  { firmenname, branche, logo_url, farben:{primaer,sekundaer,akzent} }
 *  - onSubmit?: ({name,email,telefon,antworten}) => Promise   // Public, optional
 *  - frame?:  'phone' | null
 *  - readonly?: bool
 *  - jumpToIndex?: number   // im Editor: zeigt diesen Screen direkt an
 */
export default function FunnelView({ funnel, job, kunde, onSubmit, frame, readonly, jumpToIndex }) {
  const screens = Array.isArray(funnel?.screens) ? funnel.screens : [];
  const [step, setStep] = useState(0);
  const [antworten, setAntworten] = useState({});
  const [contact, setContact] = useState({ name: '', email: '', telefon: '' });
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Editor-Sprung: bei jumpToIndex-Änderung sofort dorthin springen
  useEffect(() => {
    if (typeof jumpToIndex === 'number') setStep(Math.max(0, Math.min(jumpToIndex, screens.length - 1)));
  }, [jumpToIndex, screens.length]);

  const farben = kunde?.farben || {};
  const primaer = farben.primaer || '#0a0a0a';
  const akzent = farben.akzent || '#d4ff00';
  const themeStyle = useMemo(() => ({ '--fn-primaer': primaer, '--fn-akzent': akzent }), [primaer, akzent]);

  const screen = screens[step] || screens[0];

  // Fortschritt nur ab dem ersten Question-Screen, bezogen auf die verbleibenden Frage+Contact-Steps
  const questionIndices = screens.map((s, i) => s.type === 'question' ? i : -1).filter(i => i >= 0);
  const contactIndex = screens.findIndex(s => s.type === 'contact');
  const totalSteps = questionIndices.length + (contactIndex >= 0 ? 1 : 0);
  const stepInProgress = (() => {
    if (!screen) return 0;
    if (screen.type === 'question') return questionIndices.indexOf(step) + 1;
    if (screen.type === 'contact')   return totalSteps;
    return 0;
  })();
  const showProgress = screen?.type === 'question' || screen?.type === 'contact';

  function next() { setStep(s => Math.min(s + 1, screens.length - 1)); }
  function back() { setStep(s => Math.max(0, s - 1)); }

  function pickOption(opt) {
    if (screen?.type !== 'question') return;
    setAntworten(prev => ({ ...prev, [screen.id]: opt }));
    next();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readonly) { setSubmitDone(true); return; }
    if (!onSubmit) return;
    if (!contact.email.trim() && !contact.telefon.trim()) {
      setSubmitError('Bitte E-Mail oder Telefonnummer angeben.'); return;
    }
    setSubmitBusy(true); setSubmitError('');
    try {
      const antwortenList = screens
        .filter(s => s.type === 'question')
        .map(s => ({ frage_id: s.id, frage_text: s.text, antwort: antworten[s.id] || null }));
      await onSubmit({ ...contact, antworten: antwortenList });
      setSubmitDone(true);
    } catch (err) { setSubmitError(err.message); }
    finally { setSubmitBusy(false); }
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

  if (!screen) {
    return wrap(
      <div className="funnel-page funnel-empty" style={themeStyle}>
        <p>Noch keine Screens konfiguriert.</p>
      </div>
    );
  }

  // ───────── Header (klein, ohne Hero-Bild — nur Logo/Firma) ─────────
  const headerCompact = screen.type !== 'intro';

  return wrap(
    <div className={`funnel-page funnel-${screen.type}`} style={themeStyle} lang="de">
      <header className={`funnel-header ${headerCompact ? 'funnel-header-mini' : ''}`}>
        {kunde?.logo_url
          ? <img className={headerCompact ? 'funnel-logo-mini' : 'funnel-logo'} src={kunde.logo_url} alt="" />
          : <span className="funnel-logo-fallback">{(kunde?.firmenname || '?').slice(0, 1)}</span>}
        <span className={headerCompact ? 'funnel-firma-mini' : 'funnel-firma'}>{kunde?.firmenname || ''}</span>
      </header>

      {showProgress && (
        <>
          <div className="funnel-progress">
            <div className="funnel-progress-bar" style={{ width: `${(stepInProgress / Math.max(totalSteps, 1)) * 100}%` }} />
          </div>
          <div className="funnel-progress-label">
            {screen.type === 'contact' ? 'Letzter Schritt' : `Frage ${stepInProgress} von ${questionIndices.length}`}
          </div>
        </>
      )}

      {/* Bild — 16:9 für intro/benefits/tasks/question wenn gesetzt */}
      {screen.image_url && (
        <div className={screen.type === 'intro' ? 'funnel-hero-169' : 'funnel-image-mini'}>
          <img src={screen.image_url} alt="" />
        </div>
      )}

      <div className="funnel-body">
        {/* INTRO — neue Reihenfolge: Headline → 2 Buttons → Body → Großer CTA */}
        {screen.type === 'intro' && (
          <>
            <h1 className="funnel-h1">
              <IntroHeadline
                teaser={screen.teaser || screen.headline || `Neugierig welche Vorteile dich als ${job?.stelle || 'Mitarbeiter:in'} bei uns erwarten?`}
                stelle={job?.stelle}
              />
            </h1>
            <div className="funnel-dual">
              <button className="funnel-cta" onClick={next}>{screen.yes_button || 'Ja klar! 🚀'}</button>
              <button className="funnel-cta funnel-cta-soft" onClick={next}>{screen.info_button || 'Mehr Infos bitte ℹ️'}</button>
            </div>
            {screen.body && (
              <div className="funnel-company">
                <h2 className="funnel-company-h">Über uns</h2>
                <p className="funnel-text">{screen.body}</p>
              </div>
            )}
            <button className="funnel-cta" onClick={next}>Zu den Vorteilen →</button>
          </>
        )}

        {/* BENEFITS — vertikale Liste mit Emoji-Badges */}
        {screen.type === 'benefits' && (
          <>
            <h1 className="funnel-h1">{screen.headline || 'Das erwartet dich bei uns'}</h1>
            {screen.body && <p className="funnel-text">{screen.body}</p>}
            <ul className="funnel-benefit-list">
              {(Array.isArray(screen.benefits) && screen.benefits.length > 0
                ? screen.benefits
                : (Array.isArray(job?.benefits) ? job.benefits : [])
              ).map((b, i) => (
                <li key={i} className="funnel-benefit-row">
                  <span className="funnel-benefit-badge">{benefitEmoji(b)}</span>
                  <span className="funnel-benefit-text">{b}</span>
                </li>
              ))}
              <li className="funnel-benefit-row funnel-benefit-row-more">
                <span className="funnel-benefit-badge">➕</span>
                <span className="funnel-benefit-text">u.v.m.</span>
              </li>
            </ul>
            {screen.quote && <blockquote className="funnel-quote">{screen.quote}</blockquote>}
            <button className="funnel-cta" onClick={next}>{screen.next_button || 'Und was sind deine Aufgaben? →'}</button>
            <button className="funnel-back" onClick={back}>← zurück</button>
          </>
        )}

        {/* TASKS */}
        {screen.type === 'tasks' && (
          <>
            <h1 className="funnel-h1">{screen.headline || 'Deine Aufgaben'}</h1>
            {screen.intro && <p className="funnel-text">{screen.intro}</p>}
            <ul className="funnel-tasks">
              {(Array.isArray(screen.aufgaben) ? screen.aufgaben : []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <button className="funnel-cta" onClick={next}>{screen.next_button || 'Weiter →'}</button>
            <button className="funnel-back" onClick={back}>← zurück</button>
          </>
        )}

        {/* QUESTION */}
        {screen.type === 'question' && (
          <>
            <h2 className="funnel-q">{screen.text || ''}</h2>
            <div className="funnel-options">
              {(screen.options || []).map((opt, i) => (
                <button key={i} type="button" className="funnel-option" onClick={() => pickOption(opt)}>
                  {opt}
                </button>
              ))}
            </div>
            <button className="funnel-back" onClick={back}>← zurück</button>
          </>
        )}

        {/* CONTACT */}
        {screen.type === 'contact' && (
          <>
            <h2 className="funnel-q">{screen.headline || 'Wie können wir dich erreichen?'}</h2>
            {screen.body && <p className="funnel-q-sub">{screen.body}</p>}
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
                {submitBusy ? 'Sende…' : (screen.submit_button || funnel?.conversion_ziel || 'Bewerbung abschicken')}
              </button>
            </form>
            <button type="button" className="funnel-back" onClick={back}>← zurück</button>
          </>
        )}
      </div>

      {/* TalentOne-Footer — auf jedem Screen ganz unten */}
      <footer className="funnel-foot">
        Made with ❤️ by <a href="https://talent-one.de" target="_blank" rel="noreferrer">TalentOne</a>
      </footer>
    </div>
  );
}

// Trennt den Geschlechtskürzel-Suffix vom Kern: "Bauhelfer (m/w/d)" → { core: "Bauhelfer", modifier: "(m/w/d)" }
function stripModifier(stelle) {
  if (!stelle) return { core: '', modifier: null };
  const m = stelle.match(/^(.+?)\s*(\([mwfdivx\/\s\-]+\))\s*$/i);
  if (m) return { core: m[1].trim(), modifier: m[2].trim() };
  return { core: stelle, modifier: null };
}

// Headline für den Intro-Screen: Pre (klein) → Stellenname (groß) → optional Geschlechtskürzel (klein) → Post (klein).
function IntroHeadline({ teaser, stelle }) {
  if (!teaser) return null;
  const { core, modifier } = stripModifier(stelle || '');
  if (!core) return <span className="funnel-h1-line">{teaser}</span>;
  const idx = teaser.toLowerCase().indexOf(core.toLowerCase());
  if (idx < 0) return <span className="funnel-h1-line">{teaser}</span>;
  let pre = teaser.slice(0, idx).trim();
  let post = teaser.slice(idx + core.length).trim();
  // Wenn der teaser zufällig schon den Modifier enthält, aus post entfernen
  if (modifier) {
    const mLower = modifier.toLowerCase();
    const postLower = post.toLowerCase();
    if (postLower.startsWith(mLower)) post = post.slice(modifier.length).trim();
  }
  return (
    <>
      {pre && <span className="funnel-h1-small">{pre}</span>}
      <span className="funnel-h1-job">{core}</span>
      {modifier && <span className="funnel-h1-mod">{modifier}</span>}
      {post && <span className="funnel-h1-small">{post}</span>}
    </>
  );
}

// Heuristisches Emoji-Mapping fürs Benefit
function benefitEmoji(b = '') {
  const s = b.toLowerCase();
  if (/urlaub/.test(s)) return '🏖️';
  if (/firmenwagen|tankkarte|auto|leasing/.test(s)) return '🚗';
  if (/jobrad|fahrrad|bike/.test(s)) return '🚴';
  if (/altersvorsorge|bav|rente/.test(s)) return '🏦';
  if (/home.?office|remote/.test(s)) return '🏠';
  if (/zeit|gleitzeit|flexibel/.test(s)) return '⏰';
  if (/weiterbildung|fortbildung|akademie|schulung/.test(s)) return '📚';
  if (/4.?tage|viertage/.test(s)) return '🗓️';
  if (/gehalt|bonus|prämie|provision/.test(s)) return '💰';
  if (/getränk|obst|kaffee|snack/.test(s)) return '🥤';
  if (/team|kollegen|event/.test(s)) return '🤝';
  if (/fitness|sport|gym/.test(s)) return '💪';
  if (/gesundheit|massage/.test(s)) return '🩺';
  if (/onboarding|einstieg/.test(s)) return '🚀';
  return '✨';
}
