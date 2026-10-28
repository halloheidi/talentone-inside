import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Lightbox from '../components/Lightbox.jsx';
import KriterienEditor from '../components/KriterienEditor.jsx';
import KriterienKachel from '../components/KriterienKachel.jsx';
import { BewerberListe, ampelVerteilung, AMPELN, bearbeitungStatus } from '../components/BewerberListe.jsx';
import { personenGruppen, anzahlPersonen } from '../lib/dubletten.js';
import AnfragenKanban from '../components/AnfragenKanban.jsx';
import { supabase } from '../lib/supabase.js';
import { t } from '../lib/anrede.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Recruiting-/Lead-Stellen fürs Portal; interne Hilfs-Typen (sonstiges, video) nicht zeigen.
const NICHT_PORTAL_TYP = new Set(['sonstiges', 'video']);
function istPortalJob(j) { return !NICHT_PORTAL_TYP.has(j?.projekttyp || ''); }

// Wenn ein interner Mitarbeiter das Portal oeffnet, ist er in Supabase eingeloggt.
// Wir schicken den Access-Token als Bearer mit, damit das Backend den Kunden-Login
// ueberspringen kann. Wichtig: fuer echte externe Kunden ist keine Session da.
async function getStaffBearer() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

const BRAND = {
  talentone:  { name: 'TalentOne',    primary: '#0a0a0a', accent: '#d4ff00', accentInk: '#0a0a0a' },
  nowagwirth: { name: 'Nowag & Wirth', primary: '#0a0a0a', accent: '#980000', accentInk: '#ffffff' },
};

async function api(path, init = {}) {
  const bearer = await getStaffBearer();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Fehler');
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

// „Bevor es losgeht" — AVV-Annahme vor dem ersten Portal-Zugang (account-Modus).
function AvvGate({ token, data, onDone }) {
  const brand = BRAND[data.kunde?.agentur] || BRAND.nowagwirth;
  const [name, setName] = useState(data.kunde?.ansprechpartner || '');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setError('');
    if (!name.trim()) { setError(t(data.kunde, 'Bitte deinen Namen eingeben.', 'Bitte Ihren Namen eingeben.')); return; }
    if (!checked) { setError('Bitte den Auftragsverarbeitungsvertrag akzeptieren.'); return; }
    setBusy(true);
    try {
      await api(`/public/avv/${token}/akzeptieren`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 560, width: '100%', padding: 28, boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Bevor es losgeht</h1>
        <p style={{ fontSize: 14, color: '#5a5955', margin: '0 0 18px', lineHeight: 1.6 }}>
          {t(data.kunde,
            'Bitte bestätige einmalig den Auftragsverarbeitungsvertrag (AVV), damit wir mit deiner Kampagne starten dürfen.',
            'Bitte bestätigen Sie einmalig den Auftragsverarbeitungsvertrag (AVV), damit wir mit Ihrer Kampagne starten dürfen.')}
        </p>
        {data.avv?.pdf_url && (
          <div style={{ border: '1px solid #ececea', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            <iframe src={data.avv.pdf_url} title="Auftragsverarbeitungsvertrag" style={{ width: '100%', height: 360, border: 'none', display: 'block' }} />
          </div>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5, cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Ich habe den <a href={data.avv?.pdf_url} target="_blank" rel="noreferrer" style={{ color: brand.primary }}>Auftragsverarbeitungsvertrag (PDF)</a> gelesen und akzeptiere ihn im Namen von <strong>{data.kunde?.firmenname}</strong>.</span>
        </label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t(data.kunde, 'Dein Name (zur Bestätigung)', 'Ihr Name (zur Bestätigung)')}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #ececea', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
        {error && <div style={{ color: '#980000', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <button onClick={accept} disabled={busy} style={{ background: brand.accent, color: brand.accentInk, border: 'none', padding: '12px 20px', borderRadius: 100, fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' }}>
          {busy ? 'Wird bestätigt…' : 'Akzeptieren & fortfahren'}
        </button>
      </div>
    </div>
  );
}

export default function PublicPortal() {
  const { token } = useParams();
  const [search, setSearch] = useSearchParams();
  const einladungsToken = search.get('einladung');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [akteBewId, setAkteBewId] = useState(null);
  const bewerbungParam = search.get('bewerbung');

  async function load() {
    try {
      const res = await api(`/public/portal/${token}`);
      setData(res); setNeedsLogin(false); setError('');
    } catch (err) {
      if (err.status === 401) { setNeedsLogin(true); setData(null); setError(''); }
      else setError(err.message);
    }
  }

  // Portal zeigt nur „echte" Stellen — interne Typen (sonstiges, video) raus.
  const portalJobs = (data?.jobs || []).filter(istPortalJob);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);
  // Default-Tab = Stelle mit der jüngsten Bewerbung (ohne ?bewerbung-Parameter).
  useEffect(() => {
    if (!portalJobs.length || activeJobId) return;
    const latest = (data?.bewerbungen || [])
      .filter(b => portalJobs.some(j => j.id === b.job_id))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    setActiveJobId(latest?.job_id || portalJobs[0].id);
  }, [data, activeJobId]); // eslint-disable-line
  // ?bewerbung=<id>: zur richtigen Stelle springen + Akte markieren.
  useEffect(() => {
    if (!data || !bewerbungParam) return;
    const b = (data.bewerbungen || []).find(x => x.id === bewerbungParam);
    if (b) { setActiveJobId(b.job_id); setAkteBewId(b.id); }
  }, [data, bewerbungParam]);

  // Wenn Einladungs-Token in der URL: Setup-Modus zeigen (unabhaengig von needsLogin)
  if (einladungsToken) {
    return <PasswortSetzen token={token} einladung={einladungsToken}
      onDone={() => { setSearch({}); load(); }} />;
  }
  if (needsLogin) return <LoginForm token={token} onLogin={load} />;
  if (error) return <FullMsg text={error} />;
  if (!data) return <FullMsg text="Dashboard wird geladen…" />;
  if (data.avv?.erforderlich) return <AvvGate token={token} data={data} onDone={load} />;

  const brand = BRAND[data.kunde?.agentur] || BRAND.nowagwirth;
  const primary = data.kunde?.farben?.primaer || brand.accent;
  const primaryInk = brand.accentInk;

  const activeJob = portalJobs.find(j => j.id === activeJobId) || portalJobs[0];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', color: '#0a0a0a', fontFamily: '-apple-system, sans-serif' }}>
      <style>{`@media(max-width:640px){.pp-main{padding:16px 16px 40px!important}.pp-header{padding:14px 16px!important}.pp-meta{display:none!important}}`}</style>
      <header className="pp-header" style={{ background: brand.primary, color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: `3px solid ${primary}` }}>
        {data.kunde?.logo_url && (
          <img src={data.kunde.logo_url} alt="" style={{ height: 52, maxHeight: 52, maxWidth: 160, objectFit: 'contain', background: '#fff', borderRadius: 10, padding: '6px 10px' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{brand.name}</div>
          <div style={{ fontSize: 20, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.kunde?.firmenname || t(data.kunde, 'Dein Dashboard', 'Ihr Dashboard')}
          </div>
        </div>
        <div className="pp-meta" style={{ fontSize: 12, opacity: 0.75, textAlign: 'right' }}>
          <div>{t(data.kunde, 'Dein Kampagnen-Dashboard', 'Ihr Kampagnen-Dashboard')}</div>
          <div>Live-Daten · aktualisiert vor wenigen Sekunden</div>
        </div>
        <button
          onClick={async () => {
            try { await api(`/public/portal/${token}/logout`, { method: 'POST' }); } catch {}
            setData(null); setNeedsLogin(true);
          }}
          style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                   padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
          title="Abmelden"
        >Abmelden</button>
      </header>

      {portalJobs.length > 1 && (
        <div style={{ padding: '12px 24px 0', background: '#fff', borderBottom: '1px solid #ececea' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.05, color: '#9a9994', marginBottom: 8 }}>{t(data.kunde, 'Deine Stellen', 'Ihre Stellen')}</div>
          <nav style={{ display: 'flex', gap: 8, paddingBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {portalJobs.map(j => {
              const aktiv = j.id === activeJobId;
              const jbew = (data.bewerbungen || []).filter(b => b.job_id === j.id);
              // Zähler = eindeutige Personen; „neu" = Personen, deren jüngster Eingang „neu" ist.
              const jgruppen = personenGruppen(jbew);
              const personen = jgruppen.length;
              const neu = jgruppen.filter(g => {
                const letzter = g.reduce((m, r) => new Date(r.created_at) > new Date(m.created_at) ? r : m, g[0]);
                return bearbeitungStatus(letzter).key === 'neu';
              }).length;
              return (
                <button key={j.id} onClick={() => setActiveJobId(j.id)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: aktiv ? primary : '#fff', color: aktiv ? primaryInk : '#0a0a0a',
                  border: aktiv ? 'none' : '1px solid #e4e4e1', padding: '9px 16px', borderRadius: 12, cursor: 'pointer',
                  fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                  boxShadow: aktiv ? `0 4px 14px ${primary}44` : 'none',
                }}>
                  {aktiv && data.kunde?.logo_url
                    ? <img src={data.kunde.logo_url} alt="" style={{ height: 20, maxWidth: 40, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: '1px 3px' }} />
                    : <span>{j.projekttyp === 'neukundengewinnung' ? '🎯' : '📋'}</span>}
                  <span>{j.stelle || 'Stelle'}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: aktiv ? 0.85 : 0.55 }} title={personen !== jbew.length ? `${jbew.length} Eingänge` : undefined}>· {personen}</span>
                  {neu > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 100, background: aktiv ? 'rgba(255,255,255,0.25)' : '#eef2ff', color: aktiv ? primaryInk : '#1e40af' }}>{neu} neu</span>}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      <main className="pp-main" style={{ width: '100%', padding: '20px 24px 40px', boxSizing: 'border-box' }}>
        {(() => {
          const neu = bewerbungParam ? (data.bewerbungen || []).find(x => x.id === bewerbungParam) : null;
          if (!neu) return null;
          const njob = data.jobs.find(j => j.id === neu.job_id);
          return (
            <div style={{ background: `linear-gradient(100deg, ${primary}, ${primary}cc)`, color: primaryInk, borderRadius: 14, padding: '16px 18px', marginBottom: 18, display: 'flex', gap: 14, alignItems: 'center', boxShadow: `0 6px 20px ${primary}40` }}>
              <span style={{ fontSize: 26 }}>📨</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.06, opacity: 0.85 }}>Neu eingegangen</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{neu.name || 'Neue Bewerbung'} · {njob?.stelle || 'Stelle'}</div>
              </div>
              <button onClick={() => setAkteBewId(neu.id)} style={{ background: primaryInk, color: primary, border: 'none', borderRadius: 100, padding: '9px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>Akte öffnen →</button>
            </div>
          );
        })()}
        {activeJob && (
          <JobBlock
            key={activeJob.id}
            job={activeJob}
            token={token}
            kunde={data.kunde}
            brand={brand}
            primary={primary}
            primaryInk={primaryInk}
            anfragen={data.anfragen.filter(a => a.job_id === activeJob.id)}
            bewerbungen={data.bewerbungen.filter(b => b.job_id === activeJob.id)}
            creatives={data.creatives.filter(c => c.job_id === activeJob.id)}
            adcopies={data.adcopies.filter(a => a.job_id === activeJob.id)}
            onReload={() => api(`/public/portal/${token}`).then(setData).catch(() => {})}
            akteBewId={akteBewId}
            onAkte={setAkteBewId}
          />
        )}
      </main>
    </div>
  );
}

function FullMsg({ text }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: '-apple-system, sans-serif' }}>{text}</div>;
}

function AuthCard({ title, subtitle, children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 420, maxWidth: '100%', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22 }}>{title}</h1>
        {subtitle && <p style={{ color: '#5a5955', margin: '0 0 20px', fontSize: 14 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function LoginForm({ token, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await api(`/public/portal/${token}/login`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      onLogin();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  return (
    <AuthCard title="🔑 Anmeldung Kunden-Portal" subtitle="Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.">
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <input type="email" required placeholder="E-Mail" value={email} onChange={e => setEmail(e.target.value)}
          autoFocus style={{ padding: '10px 12px', border: '1px solid #ececea', borderRadius: 8, fontSize: 14 }} />
        <input type="password" required placeholder="Passwort" value={password} onChange={e => setPassword(e.target.value)}
          style={{ padding: '10px 12px', border: '1px solid #ececea', borderRadius: 8, fontSize: 14 }} />
        {msg && <div style={{ color: '#c1272d', fontSize: 13 }}>{msg}</div>}
        <button type="submit" disabled={busy || !email || !password}
          style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Prüfe…' : 'Anmelden'}
        </button>
        <p style={{ fontSize: 12, color: '#5a5955', margin: 0 }}>
          Kein Zugang? Frag dein Team, es kann eine Einladung schicken.
        </p>
      </form>
    </AuthCard>
  );
}

function PasswortSetzen({ token, einladung, onDone }) {
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (pwd1.length < 8) { setMsg('Mindestens 8 Zeichen.'); return; }
    if (pwd1 !== pwd2) { setMsg('Passwörter stimmen nicht überein.'); return; }
    setBusy(true); setMsg('');
    try {
      await api(`/public/portal/${token}/passwort-setzen`, {
        method: 'POST', body: JSON.stringify({ einladungs_token: einladung, password: pwd1 }),
      });
      onDone();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  return (
    <AuthCard title="🔑 Passwort setzen" subtitle="Willkommen! Setz dir ein Passwort — danach bist du direkt eingeloggt.">
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <input type="password" required placeholder="Neues Passwort (min. 8 Zeichen)"
          value={pwd1} onChange={e => setPwd1(e.target.value)} autoFocus
          style={{ padding: '10px 12px', border: '1px solid #ececea', borderRadius: 8, fontSize: 14 }} />
        <input type="password" required placeholder="Passwort wiederholen"
          value={pwd2} onChange={e => setPwd2(e.target.value)}
          style={{ padding: '10px 12px', border: '1px solid #ececea', borderRadius: 8, fontSize: 14 }} />
        {msg && <div style={{ color: '#c1272d', fontSize: 13 }}>{msg}</div>}
        <button type="submit" disabled={busy || !pwd1 || !pwd2}
          style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Speichere…' : 'Passwort setzen & einloggen'}
        </button>
      </form>
    </AuthCard>
  );
}

/* ══════════════════════ JobBlock ══════════════════════ */

function JobBlock({ job, token, kunde, brand, primary, primaryInk, anfragen, bewerbungen, creatives, adcopies, onReload, akteBewId, onAkte }) {
  const istNeukunden = job.projekttyp === 'neukundengewinnung';
  const [ampelFilter, setAmpelFilter] = useState(null);
  async function saveKriterien(wert) {
    await api(`/public/portal/${token}/job/${job.id}/kriterien-struktur`, { method: 'PUT', body: JSON.stringify({ kriterien: wert }) });
    onReload?.();
  }
  const feedbackFor = (bewId, patch) => api(`/public/portal/${token}/bewerbung/${bewId}/feedback`, { method: 'PATCH', body: JSON.stringify(patch) });
  const kommentarFor = (bewId, text) => api(`/public/portal/${token}/bewerbung/${bewId}/kommentar`, { method: 'POST', body: JSON.stringify({ text }) });
  const spalteFor = (bewId, spalteId, wert) => api(`/public/portal/${token}/bewerbung/${bewId}/spalte/${spalteId}`, { method: 'PUT', body: JSON.stringify({ wert }) });
  const vorqualFor = (bewId, feld, wert) => api(`/public/portal/${token}/bewerbung/${bewId}/vorqual`, { method: 'PUT', body: JSON.stringify({ feld, wert }) });
  return (
    <section style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {!istNeukunden && (
        <PortalKacheln job={job} token={token} kunde={kunde} primary={primary} bewerbungen={bewerbungen} onReload={onReload}
          ampelFilter={ampelFilter} onAmpelFilter={setAmpelFilter} />
      )}
      {job.funnel_url && (
        <div style={{ background: '#fff', padding: '14px 16px', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>🔗</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#5a5955', fontWeight: 600, letterSpacing: 0.03, textTransform: 'uppercase' }}>{t(kunde, 'Deine Landingpage', 'Ihre Landingpage')}</div>
            <a href={job.funnel_url} target="_blank" rel="noreferrer" style={{ color: '#0a0a0a', wordBreak: 'break-all', fontSize: 13 }}>{job.funnel_url}</a>
          </div>
          <button onClick={() => navigator.clipboard.writeText(job.funnel_url).catch(() => {})}
            style={{ background: '#f4f3f0', border: '1px solid #ececea', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            Kopieren
          </button>
        </div>
      )}

      {istNeukunden ? (
        <LeadsSection
          job={job} token={token} kunde={kunde} primary={primary} primaryInk={primaryInk}
          anfragen={anfragen} onReload={onReload}
        />
      ) : (
        <>
          <KriterienKachel
            value={job.kriterien_struktur}
            onSave={saveKriterien}
            accent={primary}
            titel={t(kunde, 'Worauf wir für dich achten', 'Worauf wir für Sie achten')}
            hinweis="Ausschlusskriterien berücksichtigen wir sofort bei der Vorqualifizierung."
          />
          <BewerberListe job={job} bewerbungen={bewerbungen} kunde={kunde} primary={primary} modus="kunde"
            ampelFilter={ampelFilter} onAmpelFilter={setAmpelFilter} akteBewId={akteBewId} onAkte={onAkte}
            onFeedback={feedbackFor} onKommentar={kommentarFor} onSpalte={spalteFor} onVorqual={vorqualFor} onReload={onReload} />
          <MitarbeiterstimmenPortalKachel token={token} kunde={kunde} primary={primary} />
        </>
      )}

      {istNeukunden
        ? (creatives.length > 0 || adcopies.length > 0) && (
            <CreativePaareSection creatives={creatives} adcopies={adcopies} kunde={kunde} />
          )
        : creatives.length > 0 && (
            <CreativesSection
              creatives={creatives} token={token} kunde={kunde} primary={primary} primaryInk={primaryInk}
              onSaved={onReload}
            />
          )}
    </section>
  );
}

/* ══════════════════════ Creative + Copy als Paar (Neukundengewinnung) ══════════════════════ */

function CreativePaareSection({ creatives, adcopies, kunde }) {
  const [lightbox, setLightbox] = useState(null);
  const adcopyById = id => adcopies.find(a => a.id === id) || null;
  const zugeordneteIds = new Set(creatives.map(c => c.adcopy_id).filter(Boolean));
  const freieCopies = adcopies.filter(a => !zugeordneteIds.has(a.id));

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>🎨 {t(kunde, 'Deine', 'Ihre')} Anzeigen</h2>

      {creatives.length > 0 && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {creatives.map((c, i) => {
            const a = adcopyById(c.adcopy_id);
            const u = a?.ueberschriften || [];
            return (
              <div key={c.id} style={{ border: '1px solid #ececea', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                <button onClick={() => setLightbox(i)} title="Groß-Ansicht"
                  style={{ background: '#000', border: 'none', padding: 0, cursor: 'zoom-in', width: '100%', display: 'block', aspectRatio: c.format === 'story' ? '9 / 16' : c.format === 'feed' ? '4 / 5' : '1 / 1' }}>
                  {c.typ === 'video'
                    ? <video src={c.bild_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={c.bild_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </button>
                {a && (
                  <div style={{ padding: '10px 12px' }}>
                    {a.text && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: (u[0] || u[1]) ? 8 : 0 }}>{a.text}</div>}
                    {u[0] && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{u[0]}</div>}
                    {u[1] && <div style={{ fontSize: 12.5, color: '#5a5955', marginTop: 2 }}>{u[1]}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {freieCopies.length > 0 && (
        <div style={{ marginTop: creatives.length > 0 ? 20 : 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>Allgemeine Textvarianten</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {freieCopies.map(a => {
              const u = a.ueberschriften || [];
              return (
                <div key={a.id} style={{ border: '1px solid #ececea', borderRadius: 10, padding: '10px 12px', background: '#fafaf8' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.05, color: '#5a5955', marginBottom: 4 }}>{a.stil || 'Textvariante'}</div>
                  {a.text && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: (u[0] || u[1]) ? 8 : 0 }}>{a.text}</div>}
                  {u[0] && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{u[0]}</div>}
                  {u[1] && <div style={{ fontSize: 12.5, color: '#5a5955', marginTop: 2 }}>{u[1]}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lightbox !== null && creatives.length > 0 && (
        <Lightbox items={creatives} index={Math.max(0, Math.min(lightbox, creatives.length - 1))}
          onClose={() => setLightbox(null)} onNavigate={setLightbox}
          filenameFor={c => `creative-${c.format}-${c.id.slice(0, 8)}.${c.typ === 'video' ? 'mp4' : 'png'}`} />
      )}
    </div>
  );
}


/* ══════════════════════ "Das ist uns wichtig" (Kunde pflegt die Prüf-Kriterien) ══════════════════════ */

function KriterienPortalSection({ job, token, kunde, primary, primaryInk, onReload }) {
  const [entwurf, setEntwurf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const kriterien = Array.isArray(job.wichtige_kriterien) ? job.wichtige_kriterien : [];
  const felder = Array.isArray(job.vorqual_spalten) ? job.vorqual_spalten.map(s => ({ name: s.name })) : [];

  // Nur relevant, wenn wir fuer diese Stelle wirklich vorqualifizieren.
  if (!job.vorqualifizierung) return null;

  async function speichern() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch(`${API_BASE}/public/portal/${token}/job/${job.id}/kriterien`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kriterien: entwurf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
      setEntwurf(null);
      setMsg('Gespeichert — danke! Wir prüfen das ab sofort bei jedem Bewerber.');
      setTimeout(() => setMsg(''), 4000);
      onReload?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>⭐ Das ist uns wichtig</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#5a5955' }}>
        Worauf sollen wir bei der telefonischen Vorqualifizierung achten? Diese Punkte prüfen wir
        bei jedem Bewerber und tragen das Ergebnis in die Liste unten ein.
      </p>

      {entwurf == null ? (
        <>
          {kriterien.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9a9994', margin: '0 0 12px' }}>
              {t(kunde,
                'Noch nichts festgelegt — sag uns gern, worauf es dir ankommt.',
                'Noch nichts festgelegt — sagen Sie uns gern, worauf es Ihnen ankommt.')}
            </p>
          ) : (
            <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {kriterien.map((k, i) => (
                <li key={i} style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ width: 14 }}>{k.pflicht ? '❗' : '·'}</span>
                  <span>
                    <strong>{k.kriterium}</strong>
                    {k.anforderung && <span style={{ color: '#5a5955' }}> — {k.anforderung}</span>}
                    {k.pflicht && <span style={{ color: '#9a9994', fontSize: 11 }}> (Pflicht)</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setEntwurf(kriterien.map(k => ({ ...k })))}
            style={{ background: primary, color: primaryInk, border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            {kriterien.length ? 'Anpassen' : 'Kriterien festlegen'}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: '#166534' }}>{msg}</div>}
        </>
      ) : (
        <>
          <KriterienEditor kriterien={entwurf} felder={felder} onChange={setEntwurf} disabled={busy} />
          {err && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={speichern} disabled={busy}
              style={{ background: primary, color: primaryInk, border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
            <button onClick={() => { setEntwurf(null); setErr(''); }} disabled={busy}
              style={{ background: '#f1f1ee', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
              Abbrechen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════ Lead-Pipeline (Neukunden) ══════════════════════ */

function LeadsSection({ job, token, kunde, primary, primaryInk, anfragen, onReload }) {
  const [view, setView] = useState('pipeline'); // 'pipeline' | 'tabelle'
  const [selected, setSelected] = useState(null);
  const [showPipelineEdit, setShowPipelineEdit] = useState(false);
  const stufen = job.pipeline_stufen || [];

  async function moveLead(anfrageId, stufeId) {
    try {
      await api(`/public/portal/${token}/anfrage/${anfrageId}`, { method: 'PATCH', body: JSON.stringify({ status: stufeId }) });
      onReload();
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🎯 {t(kunde, 'Deine', 'Ihre')} Anfragen ({anfragen.length})</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {job.anfragen_token && (
            <a href={`/anfragen/${job.anfragen_token}`} target="_blank" rel="noreferrer"
              style={{ ...pillStyle(false, primary, primaryInk), textDecoration: 'none' }}
              title="Fokussierte Anfragenliste in neuem Tab öffnen">↗ {t(kunde, 'Zu deinen Anfragen', 'Zu Ihren Anfragen')}</a>
          )}
          <button onClick={() => setView('pipeline')}
            style={pillStyle(view === 'pipeline', primary, primaryInk)}>Pipeline</button>
          <button onClick={() => setView('tabelle')}
            style={pillStyle(view === 'tabelle', primary, primaryInk)}>Tabelle</button>
          <button onClick={() => setShowPipelineEdit(true)}
            style={{ background: 'transparent', border: '1px solid #ececea', padding: '5px 10px', borderRadius: 100, cursor: 'pointer', fontSize: 12 }}>
            ⚙ Pipeline anpassen
          </button>
        </div>
      </div>

      {anfragen.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#9a9994' }}>Noch keine Anfragen eingegangen.</div>
      ) : view === 'pipeline' ? (
        <AnfragenKanban stufen={stufen} anfragen={anfragen} onOpen={setSelected} onMove={moveLead} />
      ) : (
        <LeadsTabelle stufen={stufen} anfragen={anfragen} token={token} onOpen={setSelected} onReload={onReload} />
      )}

      {selected && (
        <LeadSlideOver
          anfrage={selected} stufen={stufen} token={token} kunde={kunde}
          felderConfig={Array.isArray(job.anfragen_felder) ? job.anfragen_felder : null}
          onClose={() => setSelected(null)} onReload={onReload}
        />
      )}

      {showPipelineEdit && (
        <PipelineEditor
          job={job} token={token}
          onClose={() => setShowPipelineEdit(false)}
          onSaved={() => { setShowPipelineEdit(false); onReload(); }}
        />
      )}
    </div>
  );
}

function pillStyle(aktiv, primary, primaryInk) {
  return {
    background: aktiv ? primary : 'transparent',
    color: aktiv ? primaryInk : '#0a0a0a',
    border: '1px solid ' + (aktiv ? primary : '#ececea'),
    padding: '5px 12px', borderRadius: 100, cursor: 'pointer',
    fontSize: 12, fontWeight: 600,
  };
}

function LeadsTabelle({ stufen, anfragen, token, onOpen, onReload }) {
  const dynKeys = useMemo(() => {
    const s = new Set();
    for (const a of anfragen) for (const k of Object.keys(a.daten || {})) if (k !== 'zustaendiger') s.add(k);
    return Array.from(s).slice(0, 8);
  }, [anfragen]);
  const [sortBy, setSortBy] = useState('created_at');
  const sorted = useMemo(() => {
    return [...anfragen].sort((a, b) => {
      const av = a[sortBy] || a.daten?.[sortBy] || '';
      const bv = b[sortBy] || b.daten?.[sortBy] || '';
      return String(bv).localeCompare(String(av));
    });
  }, [anfragen, sortBy]);

  async function setStatus(id, status) {
    try {
      await api(`/public/portal/${token}/anfrage/${id}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      onReload();
    } catch (err) { alert(err.message); }
  }

  function exportCsv() {
    const headers = ['datum', 'name', 'telefon', 'email', 'status', 'notizen', 'zustaendiger', ...dynKeys];
    const rows = sorted.map(a => [
      new Date(a.created_at).toISOString().slice(0, 10),
      a.name || '', a.telefon || '', a.email || '', a.status || '',
      (a.notizen || '').replace(/\n/g, ' '),
      a.daten?.zustaendiger || '',
      ...dynKeys.map(k => String(a.daten?.[k] ?? '')),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={exportCsv} style={{ background: '#f4f3f0', border: '1px solid #ececea', padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
          ⬇ CSV-Export
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafaf8', borderBottom: '1px solid #ececea' }}>
              <th onClick={() => setSortBy('created_at')} style={thStyle}>Datum</th>
              <th onClick={() => setSortBy('name')} style={thStyle}>Name</th>
              <th style={thStyle}>Telefon</th>
              <th style={thStyle}>E-Mail</th>
              <th style={thStyle}>Status</th>
              {dynKeys.map(k => <th key={k} style={thStyle}>{k}</th>)}
              <th style={thStyle}>Zuständig</th>
              <th style={thStyle}>Notizen</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => (
              <tr key={a.id} onClick={() => onOpen(a)} style={{ borderBottom: '1px solid #ececea', cursor: 'pointer' }}>
                <td style={tdStyle}>{new Date(a.created_at).toLocaleDateString('de-DE')}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{a.name || '—'}</td>
                <td style={tdStyle}>{a.telefon || '—'}</td>
                <td style={tdStyle}>{a.email || '—'}</td>
                <td style={tdStyle} onClick={e => e.stopPropagation()}>
                  <select value={a.status || ''} onChange={e => setStatus(a.id, e.target.value)}
                    style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 4, padding: '3px 6px', fontSize: 12 }}>
                    {stufen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                {dynKeys.map(k => <td key={k} style={tdStyle}>{String(a.daten?.[k] ?? '—').slice(0, 40)}</td>)}
                <td style={tdStyle}>{a.daten?.zustaendiger || '—'}</td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.notizen || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const thStyle = { padding: '8px 10px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955', cursor: 'pointer', whiteSpace: 'nowrap' };
const tdStyle = { padding: '8px 10px', fontSize: 12, verticalAlign: 'top' };

function LeadSlideOver({ anfrage, stufen, token, kunde, felderConfig, onClose, onReload }) {
  const [status, setStatus] = useState(anfrage.status || '');
  const [notizen, setNotizen] = useState(anfrage.notizen || '');
  const [zustaendiger, setZustaendiger] = useState(anfrage.daten?.zustaendiger || '');
  const [name, setName] = useState(anfrage.name || '');
  const [email, setEmail] = useState(anfrage.email || '');
  const [telefon, setTelefon] = useState(anfrage.telefon || '');
  const [neuerKomm, setNeuerKomm] = useState('');
  const [saving, setSaving] = useState(false);

  // Alle daten-Felder ausser "zustaendiger" (dafuer eigenes Feld)
  const [datenLocal, setDatenLocal] = useState(() => {
    const d = { ...(anfrage.daten || {}) };
    delete d.zustaendiger;
    return d;
  });

  async function save(patch) {
    setSaving(true);
    try {
      await api(`/public/portal/${token}/anfrage/${anfrage.id}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      onReload();
    } catch (err) { alert(err.message); } finally { setSaving(false); }
  }

  function saveDatenField(key, value) {
    setDatenLocal(prev => ({ ...prev, [key]: value }));
    save({ daten_patch: { [key]: value } });
  }
  function removeDatenField(key) {
    if (!confirm(`Feld "${key}" wirklich entfernen?`)) return;
    setDatenLocal(prev => { const c = { ...prev }; delete c[key]; return c; });
    save({ daten_patch: { [key]: '__delete__' } });
  }
  function addDatenField() {
    const key = (prompt('Neuer Feldname (z. B. "Adresse", "Größe der Fläche"):') || '').trim();
    if (!key) return;
    if (datenLocal[key] !== undefined) { alert('Feld existiert bereits.'); return; }
    setDatenLocal(prev => ({ ...prev, [key]: '' }));
  }
  async function addKomm() {
    const text = neuerKomm.trim();
    if (!text) return;
    try {
      await api(`/public/portal/${token}/anfrage/${anfrage.id}/kommentar`, {
        method: 'POST', body: JSON.stringify({ text }),
      });
      setNeuerKomm('');
      onReload();
    } catch (err) { alert(err.message); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: 480, maxWidth: '100%', height: '100%', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{anfrage.name || 'Lead'}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ color: '#9a9994', fontSize: 12, margin: '0 0 14px' }}>
          Eingegangen {new Date(anfrage.created_at).toLocaleString('de-DE')}
        </p>

        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', letterSpacing: 0.05, marginBottom: 6 }}>Kontakt</div>
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          <input placeholder="Name" value={name} onChange={e => setName(e.target.value)}
            onBlur={() => name !== (anfrage.name || '') && save({ name })} style={inputStyle} />
          <input type="tel" placeholder="Telefon" value={telefon} onChange={e => setTelefon(e.target.value)}
            onBlur={() => telefon !== (anfrage.telefon || '') && save({ telefon })} style={inputStyle} />
          <input type="email" placeholder="E-Mail" value={email} onChange={e => setEmail(e.target.value)}
            onBlur={() => email !== (anfrage.email || '') && save({ email })} style={inputStyle} />
        </div>

        <label style={labelStyle}>Status</label>
        <select value={status} onChange={e => { setStatus(e.target.value); save({ status: e.target.value }); }}
          disabled={saving} style={inputStyle}>
          {stufen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label style={labelStyle}>Zuständiger Vertriebler</label>
        <input value={zustaendiger} onChange={e => setZustaendiger(e.target.value)}
          onBlur={() => save({ zustaendiger })} placeholder="Name" style={inputStyle} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 4 }}>
          <span style={{ ...labelStyle, marginTop: 0, marginBottom: 0, flex: 1 }}>Details</span>
          <button type="button" onClick={addDatenField}
            style={{ background: '#fafaf8', border: '1px solid #ececea', padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
            + Feld hinzufügen
          </button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {(() => {
            const configKeys = new Set((felderConfig || []).map(f => f.key));
            const configured = (felderConfig || []);
            const extras = Object.keys(datenLocal).filter(k => !configKeys.has(k) && k !== '_airtable_id');
            const items = [
              ...configured.map(f => ({ ...f, custom: false })),
              ...extras.map(k => ({ key: k, label: k, typ: 'text', custom: true })),
            ];
            if (items.length === 0) return (
              <p style={{ fontSize: 12, color: '#9a9994', margin: 0 }}>{t(kunde,
                'Keine zusätzlichen Details. Über „+ Feld hinzufügen" kannst du eigene Felder anlegen (Adresse, Größe, Bundesland, …).',
                'Keine zusätzlichen Details. Über „+ Feld hinzufügen" können Sie eigene Felder anlegen (Adresse, Größe, Bundesland, …).')}</p>
            );
            return items.map(f => {
              const v = datenLocal[f.key] ?? '';
              const commit = e => e.target.value !== (anfrage.daten?.[f.key] ?? '') && saveDatenField(f.key, e.target.value);
              const set = val => setDatenLocal(prev => ({ ...prev, [f.key]: val }));
              return (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 4, alignItems: 'start' }}>
                  <label style={{ fontSize: 11, color: '#5a5955', fontWeight: 600, paddingTop: 8 }} title={f.key}>{f.label || f.key}</label>
                  {f.typ === 'textarea' ? (
                    <textarea rows={2} value={v} onChange={e => set(e.target.value)} onBlur={commit}
                      style={{ ...inputStyle, marginBottom: 0, resize: 'vertical', fontFamily: 'inherit' }} />
                  ) : f.typ === 'select' && Array.isArray(f.optionen) ? (
                    <select value={v} onChange={e => { set(e.target.value); saveDatenField(f.key, e.target.value); }}
                      style={{ ...inputStyle, marginBottom: 0 }}>
                      <option value="">— nicht angegeben —</option>
                      {f.optionen.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.typ === 'date' ? (
                    <input type="date" value={v} onChange={e => set(e.target.value)} onBlur={commit} style={{ ...inputStyle, marginBottom: 0 }} />
                  ) : (
                    <input value={v} onChange={e => set(e.target.value)} onBlur={commit} style={{ ...inputStyle, marginBottom: 0 }} />
                  )}
                  {f.custom ? (
                    <button type="button" title="Feld entfernen" onClick={() => removeDatenField(f.key)}
                      style={{ background: 'transparent', border: 'none', color: '#c1272d', fontSize: 15, cursor: 'pointer', width: 24 }}>×</button>
                  ) : <span style={{ width: 24 }} />}
                </div>
              );
            });
          })()}
        </div>

        <label style={labelStyle}>Notizen</label>
        <textarea rows={4} value={notizen} onChange={e => setNotizen(e.target.value)}
          onBlur={() => save({ notizen })} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', letterSpacing: 0.05, marginBottom: 6 }}>Kommentare</div>
          <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 10 }}>
            {(anfrage.kommentare || []).map(k => (
              <div key={k.id} style={{ padding: 10, background: '#fafaf8', borderRadius: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <strong>{k.autor}</strong>
                  <span style={{ fontSize: 10, color: '#9a9994' }}>{new Date(k.created_at).toLocaleString('de-DE')}</span>
                  {k.quelle === 'airtable_import' && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, background: '#fef3c7', color: '#78350f', padding: '1px 6px', borderRadius: 4 }}>
                      Aus Airtable
                    </span>
                  )}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{k.text}</div>
              </div>
            ))}
            {(!anfrage.kommentare || anfrage.kommentare.length === 0) && (
              <p style={{ fontSize: 12, color: '#9a9994', margin: 0 }}>Noch keine Kommentare.</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea rows={2} value={neuerKomm} onChange={e => setNeuerKomm(e.target.value)}
              placeholder="Neuer Kommentar…" style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
            <button onClick={addKomm} disabled={!neuerKomm.trim()}
              style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              Senden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5a5955', letterSpacing: 0.05, marginBottom: 4, marginTop: 12 };
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13, marginBottom: 4, background: '#fff' };

function PipelineEditor({ job, token, onClose, onSaved }) {
  const [stufen, setStufen] = useState(() => JSON.parse(JSON.stringify(job.pipeline_stufen || [])));
  const [saving, setSaving] = useState(false);
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= stufen.length) return;
    const copy = [...stufen];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    copy.forEach((s, k) => s.reihenfolge = (k + 1) * 10);
    setStufen(copy);
  }
  function add() {
    const id = `stufe_${Date.now().toString(36)}`;
    setStufen([...stufen, { id, name: 'Neue Stufe', farbe: '#6b7280', reihenfolge: (stufen.length + 1) * 10 }]);
  }
  async function save() {
    setSaving(true);
    try {
      await api(`/public/portal/${token}/pipeline/${job.id}`, {
        method: 'PUT', body: JSON.stringify({ stufen }),
      });
      onSaved();
    } catch (err) { alert(err.message); } finally { setSaving(false); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>⚙ Pipeline anpassen</h2>
        <p style={{ fontSize: 13, color: '#5a5955' }}>Stufen umbenennen, hinzufügen, umsortieren. Änderungen gelten sofort für dieses Projekt.</p>
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {stufen.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 6, background: '#fafaf8', borderRadius: 6 }}>
              <input type="color" value={s.farbe} onChange={e => { const c = [...stufen]; c[i].farbe = e.target.value; setStufen(c); }}
                style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }} />
              <input value={s.name} onChange={e => { const c = [...stufen]; c[i].name = e.target.value; setStufen(c); }}
                style={{ flex: 1, padding: '5px 8px', border: '1px solid #ececea', borderRadius: 6, fontSize: 13 }} />
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>↑</button>
              <button onClick={() => move(i, +1)} disabled={i === stufen.length - 1} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>↓</button>
              <button onClick={() => setStufen(stufen.filter((_, k) => k !== i))}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#dc2626' }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={add} style={{ background: 'transparent', border: '1px dashed #d4d4d0', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, width: '100%', marginBottom: 12 }}>
          + Stufe hinzufügen
        </button>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #ececea', padding: '8px 14px', borderRadius: 8, cursor: 'pointer' }}>Abbrechen</button>
          <button onClick={save} disabled={saving || stufen.length === 0}
            style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, cursor: 'pointer' }}>
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ Creatives-Galerie ══════════════════════ */

function CreativesSection({ creatives, token, kunde, onSaved }) {
  const [lightbox, setLightbox] = useState(null);
  const [ueberarbeit, setUeberarbeit] = useState(null); // { creative, text }

  async function submitUeberarbeitung() {
    if (!ueberarbeit?.creative || !ueberarbeit.text.trim()) return;
    try {
      await api(`/public/portal/${token}/creative/${ueberarbeit.creative.id}/ueberarbeitung`, {
        method: 'POST', body: JSON.stringify({ text: ueberarbeit.text.trim() }),
      });
      alert(t(kunde, 'Danke — dein Änderungswunsch ist beim Team.', 'Danke — Ihr Änderungswunsch ist beim Team.'));
      setUeberarbeit(null);
      onSaved();
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>🎨 {t(kunde, 'Deine', 'Ihre')} Creatives</h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {creatives.map((c, i) => (
          <div key={c.id} style={{ background: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
            <button onClick={() => setLightbox(i)} title="Groß-Ansicht"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'zoom-in', width: '100%', display: 'block', aspectRatio: c.format === 'story' ? '9 / 16' : c.format === 'feed' ? '4 / 5' : '1 / 1' }}>
              {c.typ === 'video'
                ? <video src={c.bild_url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={c.bild_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </button>
            <button onClick={() => setUeberarbeit({ creative: c, text: '' })}
              style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 100, fontSize: 10, cursor: 'pointer' }}>
              ✏ Änderung wünschen
            </button>
          </div>
        ))}
      </div>

      {lightbox !== null && (
        <Lightbox items={creatives} index={Math.max(0, Math.min(lightbox, creatives.length - 1))}
          onClose={() => setLightbox(null)} onNavigate={setLightbox}
          filenameFor={c => `creative-${c.format}-${c.id.slice(0, 8)}.${c.typ === 'video' ? 'mp4' : 'png'}`} />
      )}

      {ueberarbeit && (
        <div onClick={() => setUeberarbeit(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 20, width: 460, maxWidth: '100%' }}>
            <h3 style={{ marginTop: 0 }}>✏ Änderungswunsch</h3>
            <p style={{ fontSize: 13, color: '#5a5955', margin: '0 0 10px' }}>
              Was soll bei diesem Creative angepasst werden? Der Wunsch landet direkt beim Team.
            </p>
            <img src={ueberarbeit.creative.bild_url} alt="" style={{ width: 120, borderRadius: 8, marginBottom: 10 }} />
            <textarea rows={5} value={ueberarbeit.text}
              onChange={e => setUeberarbeit(u => ({ ...u, text: e.target.value }))}
              placeholder="z. B. „Text unten links kleiner, Farbe des Buttons in gelb"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => setUeberarbeit(null)}
                style={{ background: 'transparent', border: '1px solid #ececea', padding: '8px 14px', borderRadius: 8, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={submitUeberarbeitung} disabled={!ueberarbeit.text.trim()}
                style={{ background: '#0a0a0a', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, cursor: 'pointer' }}>Senden</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ B2: Dashboard-Kacheln (Laufzeit + Bewerbungen) ══════════════════════ */
function LaufzeitKachel({ job, token, kunde, primary, bewerbungen = [], onReload }) {
  const lz = job.laufzeit;
  const [modal, setModal] = useState(false);
  const card = { background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
  if (!lz) return (
    <div style={card}>
      <div style={kLabel}>Laufzeit</div>
      <div style={{ color: '#5a5955', fontSize: 13, marginTop: 6 }}>Laufzeit wird aktualisiert.</div>
    </div>
  );
  const WARN = ['keine_meta_verbindung', 'meta_daten_fehlen', 'start_datum_fehlt'];
  const ueberlauf = (lz.hinweise || []).includes('ueberlaufzeit');
  const openEnd = lz.modell === 'abo' && lz.soll == null;   // ohne feste Laufzeit; nach außen keine Vertragsende-Wortwahl
  // "wird aktualisiert" nur bei echten Problemen; Open End ist ein gültiger Zustand (soll=null).
  const wirdAktualisiert = (lz.hinweise || []).some(h => WARN.includes(h)) || (!openEnd && (lz.verbraucht == null || lz.soll == null));
  const pct = ueberlauf ? 100 : (lz.soll ? Math.min(100, Math.round((lz.verbraucht / lz.soll) * 100)) : 0);
  const einheitWort = lz.einheit === 'monate' ? 'Monat' : 'Tag';
  const offenePause = (lz.pausen || []).find(p => p.quelle === 'kunde' && !p.bestaetigt_am);
  const barBg = `linear-gradient(90deg, ${primary}, ${primary}bb)`;
  // Garantie je Typ. Einstellung → Zähler = Kandidaten mit eingestellt='ja'; Bewerbungen →
  // eindeutige Personen. Jeweils seit start_datum. X = Ziel.
  const gArt = lz.garantie_art || (lz.garantie ? 'einstellung' : null);
  const garX = gArt ? (lz.garantie_ziel ?? (gArt === 'einstellung' ? 1 : null)) : null;
  const garSeitStart = gArt ? (lz.start_datum ? bewerbungen.filter(b => new Date(b.created_at) >= new Date(lz.start_datum)) : bewerbungen) : [];
  const garRows = gArt === 'einstellung' ? garSeitStart.filter(b => b.notiz?.eingestellt === 'ja') : garSeitStart;
  const garY = gArt ? anzahlPersonen(garRows) : null;
  const garEingaenge = garRows.length;
  const garPct = garX ? Math.min(100, Math.round((garY / garX) * 100)) : 0;
  const garBadge = gArt === 'einstellung'
    ? `🛡️ Einstellungsgarantie${garX != null ? ` · ${garY} von ${garX} eingestellt` : ''}`
    : gArt === 'bewerbungen' ? `🛡️ Garantie${garX != null ? ` · ${garY} von ${garX} Bewerbungen` : ''}` : '';
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={kLabel}>Laufzeit</div>
        {gArt && <span style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>{garBadge}</span>}
      </div>
      {wirdAktualisiert ? (
        <div style={{ color: '#5a5955', fontSize: 13, marginTop: 8 }}>Laufzeit wird aktualisiert.</div>
      ) : openEnd ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{lz.online_tage ?? 0}</span>
            <span style={{ fontSize: 13, color: '#5a5955' }}>Tage online</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#5a5955', marginTop: 8 }}>Monatliche Abrechnung</div>
          {lz.start_datum && <div style={{ fontSize: 12, color: '#5a5955', marginTop: 4 }}>Start: {new Date(lz.start_datum).toLocaleDateString('de-DE')}</div>}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{einheitWort} {lz.verbraucht}</span>
            <span style={{ fontSize: 13, color: '#5a5955' }}>von {lz.soll}</span>
          </div>
          <div style={{ height: 10, background: '#eef0f2', borderRadius: 100, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: barBg, borderRadius: 100, transition: 'width .4s ease' }} />
          </div>
          {ueberlauf && <div style={{ fontSize: 12, color: '#b26b00', marginTop: 4, fontWeight: 600 }}>Läuft weiter</div>}
          {lz.modell === 'abo' && <div style={{ fontSize: 12, color: '#5a5955', marginTop: 6 }}>Monatliche Abrechnung</div>}
          {lz.start_datum && <div style={{ fontSize: 12, color: '#5a5955', marginTop: 4 }}>Start: {new Date(lz.start_datum).toLocaleDateString('de-DE')}{lz.ende_voraussichtlich ? ` · vsl. Ende: ${new Date(lz.ende_voraussichtlich).toLocaleDateString('de-DE')}` : ''}</div>}
        </>
      )}
      {garX != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#5a5955', marginBottom: 4 }}><strong>{garY}</strong> von {garX} {gArt === 'einstellung' ? 'eingestellt' : 'Bewerbungen erreicht'}{gArt === 'bewerbungen' && garEingaenge !== garY && <span style={{ color: '#9a9994' }}> · {garEingaenge} Eingänge</span>}</div>
          <div style={{ height: 8, background: '#eef0f2', borderRadius: 100, overflow: 'hidden' }}>
            <div style={{ width: `${garPct}%`, height: '100%', background: '#16a34a', borderRadius: 100, transition: 'width .4s ease' }} />
          </div>
        </div>
      )}
      {(lz.pausen || []).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#5a5955' }}>
          Pausen: {lz.pausen.map((p, i) => `${new Date(p.von).toLocaleDateString('de-DE')}–${p.bis ? new Date(p.bis).toLocaleDateString('de-DE') : (p.bestaetigt_am ? 'offen' : 'beantragt')}`).join(' · ')}
        </div>
      )}
      {lz.modell === 'abo' && (
        offenePause
          ? <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: '#b26b00' }}>⏸ Pause beantragt — in Prüfung</div>
          : <button onClick={() => setModal(true)} style={{ marginTop: 12, background: 'transparent', border: `1.5px solid ${primary}`, color: primary, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Pause beantragen</button>
      )}
      {modal && <PauseModal job={job} token={token} primary={primary} onClose={() => setModal(false)} onDone={() => { setModal(false); onReload?.(); }} />}
    </div>
  );
}

function PauseModal({ job, token, primary, onClose, onDone }) {
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [grund, setGrund] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    if (!von) { setErr('Bitte ein Startdatum angeben.'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/public/portal/${token}/projekt-pause`, { method: 'POST', body: JSON.stringify({ job_id: job.id, von, bis: bis || null, grund: grund || null }) });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 110, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 420, width: '100%' }}>
        <h3 style={{ margin: '0 0 12px' }}>Pause beantragen</h3>
        {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Ab wann<input type="date" value={von} onChange={e => setVon(e.target.value)} style={inp} /></label>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Bis wann (optional)<input type="date" value={bis} onChange={e => setBis(e.target.value)} style={inp} /></label>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 12 }}>Grund (optional)<textarea value={grund} onChange={e => setGrund(e.target.value)} rows={2} style={inp} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #ececea', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>Abbrechen</button>
          <button onClick={submit} disabled={busy} style={{ background: primary, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 700 }}>{busy ? 'Sende…' : 'Pause beantragen'}</button>
        </div>
      </div>
    </div>
  );
}

function BewerbungenKachel({ bewerbungen, kunde, primary, ampelFilter, onAmpelFilter }) {
  // Eindeutige Personen (gleiche E-Mail/Telefon = eine Person); „(N Eingänge)" wenn abweichend.
  const gruppen = personenGruppen(bewerbungen);
  const gesamt = gruppen.length;
  const eingaengeGesamt = bewerbungen.length;
  const vor7 = Date.now() - 7 * 86400000;
  const letzte7 = gruppen.filter(g => g.some(b => new Date(b.created_at).getTime() >= vor7)).length;
  const eingaenge7 = bewerbungen.filter(b => new Date(b.created_at).getTime() >= vor7).length;
  const vert = ampelVerteilung(bewerbungen);
  // Sparkline (area + line): letzte 14 Tage
  const tage = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); tage.push({ d, n: 0 }); }
  const idx = Object.fromEntries(tage.map((t, i) => [t.d, i]));
  for (const b of bewerbungen) { const d = String(b.created_at).slice(0, 10); if (d in idx) tage[idx[d]].n++; }
  const max = Math.max(1, ...tage.map(t => t.n));
  const W = 240, H = 42, step = W / (tage.length - 1);
  const pts = tage.map((t, i) => `${(i * step).toFixed(1)},${(H - (t.n / max) * (H - 4) - 2).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const gid = `spark-${primary.replace('#', '')}`;
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div style={kLabel}>Bewerbungen</div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', marginTop: 6 }}>
        <div><div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{gesamt}</div><div style={{ fontSize: 11, color: '#5a5955', marginTop: 3 }}>gesamt{eingaengeGesamt !== gesamt && <span style={{ color: '#9a9994' }}> · {eingaengeGesamt} Eingänge</span>}</div></div>
        <div><div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{letzte7}</div><div style={{ fontSize: 11, color: '#5a5955', marginTop: 3 }}>letzte 7 Tage{eingaenge7 !== letzte7 && <span style={{ color: '#9a9994' }}> · {eingaenge7} Eingänge</span>}</div></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ marginTop: 10, display: 'block' }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={primary} stopOpacity="0.22" /><stop offset="100%" stopColor={primary} stopOpacity="0" />
        </linearGradient></defs>
        <polygon points={area} fill={`url(#${gid})`} />
        <polyline points={line} fill="none" stroke={primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {/* Ampel-Verteilung — Klick filtert die Liste darunter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {AMPELN.map(a => {
          const aktiv = ampelFilter === a.key;
          return (
            <button key={a.key} onClick={() => onAmpelFilter?.(aktiv ? null : a.key)} title={`Nach ${a.label} filtern`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, cursor: 'pointer',
                border: aktiv ? `1.5px solid ${a.color}` : '1px solid #ececea', background: aktiv ? `${a.color}18` : '#fff', color: '#0a0a0a' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: a.color }} />
              {a.label} <strong>{vert[a.key]}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PortalKacheln({ job, token, kunde, primary, bewerbungen, onReload, ampelFilter, onAmpelFilter }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, alignItems: 'start', minWidth: 0 }}>
      <LaufzeitKachel job={job} token={token} kunde={kunde} primary={primary} bewerbungen={bewerbungen} onReload={onReload} />
      <BewerbungenKachel bewerbungen={bewerbungen} kunde={kunde} primary={primary} ampelFilter={ampelFilter} onAmpelFilter={onAmpelFilter} />
    </div>
  );
}
/* B2: Mitarbeiterstimmen-Kachel (Portal, Quelle kunde, Freigabe Pflicht) */
function MitarbeiterstimmenPortalKachel({ token, kunde, primary }) {
  const [stimmen, setStimmen] = useState([]);
  const [neu, setNeu] = useState({ name: '', rolle: '', dabei_seit: '', zitat: '', freigabe: false });
  const [busy, setBusy] = useState(false);
  async function load() { try { const r = await api(`/public/portal/${token}/mitarbeiterstimmen`); setStimmen(r.stimmen || []); } catch {} }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);
  async function add() {
    if (!neu.zitat.trim() && !neu.name.trim()) return;
    setBusy(true);
    try { await api(`/public/portal/${token}/mitarbeiterstimmen`, { method: 'POST', body: JSON.stringify(neu) }); setNeu({ name: '', rolle: '', dabei_seit: '', zitat: '', freigabe: false }); await load(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  async function toggleFreigabe(s) { try { await api(`/public/portal/${token}/mitarbeiterstimmen/${s.id}`, { method: 'PATCH', body: JSON.stringify({ freigabe: !s.freigabe }) }); await load(); } catch (e) { alert(e.message); } }
  async function del(s) { if (!confirm('Stimme löschen?')) return; try { await api(`/public/portal/${token}/mitarbeiterstimmen/${s.id}`, { method: 'DELETE' }); await load(); } catch (e) { alert(e.message); } }
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>💬 {t(kunde, 'Eure', 'Ihre')} Mitarbeiterstimmen</h2>
      <p style={{ fontSize: 12.5, color: '#5a5955', margin: '0 0 12px' }}>Nur mit gesetztem Freigabe-Haken nutzen wir eine Stimme in Funnel &amp; Anzeigen.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stimmen.map(s => (
          <div key={s.id} style={{ border: '1px solid #ececea', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>„{s.zitat || '—'}"</div>
              <div style={{ fontSize: 11, color: '#5a5955' }}>{[s.name, s.rolle, s.dabei_seit && `seit ${s.dabei_seit}`].filter(Boolean).join(' · ')}</div>
              <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 4, fontWeight: 600, color: s.freigabe ? '#166534' : '#b91c1c' }}>
                <input type="checkbox" checked={!!s.freigabe} onChange={() => toggleFreigabe(s)} /> Freigabe zur Nutzung
              </label>
            </div>
            <button onClick={() => del(s)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 13 }}>Löschen</button>
          </div>
        ))}
      </div>
      <div style={{ border: '1px dashed #ececea', borderRadius: 8, padding: 10, marginTop: 10, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input placeholder="Name" value={neu.name} onChange={e => setNeu(s => ({ ...s, name: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 100 }} />
          <input placeholder="Rolle" value={neu.rolle} onChange={e => setNeu(s => ({ ...s, rolle: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 100 }} />
          <input placeholder="dabei seit" value={neu.dabei_seit} onChange={e => setNeu(s => ({ ...s, dabei_seit: e.target.value }))} style={{ ...inp, width: 110 }} />
        </div>
        <textarea placeholder="Zitat" value={neu.zitat} onChange={e => setNeu(s => ({ ...s, zitat: e.target.value }))} rows={2} style={inp} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={neu.freigabe} onChange={e => setNeu(s => ({ ...s, freigabe: e.target.checked }))} /> Freigabe</label>
          <button onClick={add} disabled={busy} style={{ marginLeft: 'auto', background: primary, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 }}>+ Stimme</button>
        </div>
      </div>
    </div>
  );
}

const kLabel = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955' };
const inp = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #ececea', fontSize: 13, marginTop: 2, fontFamily: 'inherit' };
