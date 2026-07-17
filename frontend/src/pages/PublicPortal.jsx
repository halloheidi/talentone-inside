import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Lightbox from '../components/Lightbox.jsx';
import KriterienEditor from '../components/KriterienEditor.jsx';
import { supabase } from '../lib/supabase.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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
    if (!name.trim()) { setError('Bitte Ihren Namen eingeben.'); return; }
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
          Bitte bestätigen Sie einmalig den Auftragsverarbeitungsvertrag (AVV), damit wir mit Ihrer Kampagne starten dürfen.
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
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ihr Name (zur Bestätigung)"
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

  async function load() {
    try {
      const res = await api(`/public/portal/${token}`);
      setData(res); setNeedsLogin(false); setError('');
    } catch (err) {
      if (err.status === 401) { setNeedsLogin(true); setData(null); setError(''); }
      else setError(err.message);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);
  useEffect(() => {
    if (data?.jobs?.length && !activeJobId) setActiveJobId(data.jobs[0].id);
  }, [data, activeJobId]);

  // Wenn Einladungs-Token in der URL: Setup-Modus zeigen (unabhaengig von needsLogin)
  if (einladungsToken) {
    return <PasswortSetzen token={token} einladung={einladungsToken}
      onDone={() => { setSearch({}); load(); }} />;
  }
  if (needsLogin) return <LoginForm token={token} onLogin={load} />;
  if (error) return <FullMsg text={error} />;
  if (!data) return <FullMsg text="Lade dein Dashboard…" />;
  if (data.avv?.erforderlich) return <AvvGate token={token} data={data} onDone={load} />;

  const brand = BRAND[data.kunde?.agentur] || BRAND.nowagwirth;
  const primary = data.kunde?.farben?.primaer || brand.accent;
  const primaryInk = brand.accentInk;

  const activeJob = data.jobs.find(j => j.id === activeJobId) || data.jobs[0];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', color: '#0a0a0a', fontFamily: '-apple-system, sans-serif' }}>
      <header style={{ background: brand.primary, color: '#fff', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        {data.kunde?.logo_url && (
          <img src={data.kunde.logo_url} alt="" height={44} style={{ background: '#fff', borderRadius: 8, padding: '4px 8px' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{brand.name}</div>
          <div style={{ fontSize: 18, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.kunde?.firmenname || 'Dein Dashboard'}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, textAlign: 'right' }}>
          <div>Dein Kampagnen-Dashboard</div>
          <div>Live-Daten · aktualisiert vor wenigen Sekunden</div>
        </div>
        <button
          onClick={async () => {
            try { await api(`/public/portal/${token}/logout`, { method: 'POST' }); } catch {}
            setData(null); setNeedsLogin(true);
          }}
          style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                   padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          title="Abmelden"
        >Abmelden</button>
      </header>

      {data.jobs.length > 1 && (
        <nav style={{ display: 'flex', gap: 4, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #ececea', overflowX: 'auto' }}>
          {data.jobs.map(j => {
            const aktiv = j.id === activeJobId;
            return (
              <button key={j.id} onClick={() => setActiveJobId(j.id)} style={{
                background: aktiv ? primary : 'transparent',
                color: aktiv ? primaryInk : '#0a0a0a',
                border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {j.projekttyp === 'neukundengewinnung' ? '🎯' : '👥'} {j.stelle || 'Projekt'}
              </button>
            );
          })}
        </nav>
      )}

      <main style={{ width: '100%', padding: '20px 24px 40px' }}>
        {activeJob && (
          <JobBlock
            key={activeJob.id}
            job={activeJob}
            token={token}
            brand={brand}
            primary={primary}
            primaryInk={primaryInk}
            anfragen={data.anfragen.filter(a => a.job_id === activeJob.id)}
            bewerbungen={data.bewerbungen.filter(b => b.job_id === activeJob.id)}
            creatives={data.creatives.filter(c => c.job_id === activeJob.id)}
            adcopies={data.adcopies.filter(a => a.job_id === activeJob.id)}
            onReload={() => api(`/public/portal/${token}`).then(setData).catch(() => {})}
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

function JobBlock({ job, token, brand, primary, primaryInk, anfragen, bewerbungen, creatives, adcopies, onReload }) {
  const istNeukunden = job.projekttyp === 'neukundengewinnung';
  return (
    <section style={{ display: 'grid', gap: 20 }}>
      {job.funnel_url && (
        <div style={{ background: '#fff', padding: '14px 16px', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>🔗</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#5a5955', fontWeight: 600, letterSpacing: 0.03, textTransform: 'uppercase' }}>Deine Landingpage</div>
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
          job={job} token={token} primary={primary} primaryInk={primaryInk}
          anfragen={anfragen} onReload={onReload}
        />
      ) : (
        <>
          <KriterienPortalSection job={job} token={token} primary={primary} primaryInk={primaryInk} onReload={onReload} />
          <BewerbungenSection job={job} bewerbungen={bewerbungen} primary={primary} primaryInk={primaryInk} />
        </>
      )}

      {creatives.length > 0 && (
        <CreativesSection
          creatives={creatives} token={token} primary={primary} primaryInk={primaryInk}
          onSaved={onReload}
        />
      )}
    </section>
  );
}


/* ══════════════════════ "Das ist uns wichtig" (Kunde pflegt die Prüf-Kriterien) ══════════════════════ */

function KriterienPortalSection({ job, token, primary, primaryInk, onReload }) {
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
              Noch nichts festgelegt — sag uns gern, worauf es dir ankommt.
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

function LeadsSection({ job, token, primary, primaryInk, anfragen, onReload }) {
  const [view, setView] = useState('pipeline'); // 'pipeline' | 'tabelle'
  const [selected, setSelected] = useState(null);
  const [showPipelineEdit, setShowPipelineEdit] = useState(false);
  const stufen = job.pipeline_stufen || [];

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🎯 Deine Anfragen ({anfragen.length})</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
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
        <PipelineKanban stufen={stufen} anfragen={anfragen} token={token} onOpen={setSelected} onReload={onReload} />
      ) : (
        <LeadsTabelle stufen={stufen} anfragen={anfragen} token={token} onOpen={setSelected} onReload={onReload} />
      )}

      {selected && (
        <LeadSlideOver
          anfrage={selected} stufen={stufen} token={token}
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

function PipelineKanban({ stufen, anfragen, token, onOpen, onReload }) {
  const [dragId, setDragId] = useState(null);
  const grouped = {};
  for (const s of stufen) grouped[s.id] = [];
  const catchAllKey = stufen[0]?.id || 'neu';
  for (const a of anfragen) {
    const bucket = stufen.find(s => s.id === a.status) ? a.status : catchAllKey;
    (grouped[bucket] ||= []).push(a);
  }

  async function move(anfrageId, stufeId) {
    try {
      await api(`/public/portal/${token}/anfrage/${anfrageId}`, {
        method: 'PATCH', body: JSON.stringify({ status: stufeId }),
      });
      onReload();
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${stufen.length}, minmax(180px, 1fr))`, overflowX: 'auto' }}>
      {stufen.map(s => (
        <div key={s.id}
          onDragOver={e => e.preventDefault()}
          onDrop={() => dragId && move(dragId, s.id)}
          style={{ background: '#fafaf8', borderRadius: 8, padding: 8, minHeight: 200 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 100, background: s.farbe }} />
            <strong style={{ fontSize: 12, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>{s.name}</strong>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9a9994' }}>{(grouped[s.id] || []).length}</span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {(grouped[s.id] || []).map(a => {
              const d = a.daten || {};
              const pick = (...keys) => { for (const k of keys) { const v = d[k]; if (v != null && String(v).trim() !== '') return String(v); } return null; };
              const projektname = pick('Projektname', 'projektname');
              const standort    = pick('Standort Freiflaeche', 'Standort Freifläche', 'Adresse', 'standort');
              const groesse     = pick('Groesse der Flaeche', 'Größe der Fläche', 'größe', 'groesse');
              const anmerkung   = pick('Anmerkung', 'bemerkung');
              const gemeinde    = pick('Gemeinde', 'gemeinde');
              const plz         = pick('Postleitzahl', 'plz');
              const title = projektname || a.name || '—';
              return (
                <div key={a.id}
                  draggable
                  onDragStart={() => setDragId(a.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(a)}
                  style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 8, padding: 10, fontSize: 12, cursor: 'grab' }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
                  {projektname && a.name && <div style={{ fontSize: 11, color: '#5a5955' }}>👤 {a.name}</div>}
                  {a.telefon && <div style={{ color: '#5a5955' }}>📞 {a.telefon}</div>}
                  {standort && <div style={{ color: '#5a5955', marginTop: 2 }}>📍 {[plz, gemeinde].filter(Boolean).join(' ') || standort}</div>}
                  {groesse && <div style={{ color: '#0a0a0a', marginTop: 2, fontWeight: 500 }}>📐 {groesse}</div>}
                  {anmerkung && (
                    <div style={{ color: '#5a5955', marginTop: 4, fontSize: 11, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      „{anmerkung}"
                    </div>
                  )}
                  <div style={{ color: '#9a9994', fontSize: 10, marginTop: 6 }}>{new Date(a.created_at).toLocaleDateString('de-DE')}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
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

function LeadSlideOver({ anfrage, stufen, token, felderConfig, onClose, onReload }) {
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
              <p style={{ fontSize: 12, color: '#9a9994', margin: 0 }}>Keine zusätzlichen Details. Über „+ Feld hinzufügen" kannst du eigene Felder anlegen (Adresse, Größe, Bundesland, …).</p>
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

/* ══════════════════════ Bewerbungen (Recruiting) ══════════════════════ */

function BewerbungenSection({ job, bewerbungen }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>👥 Deine Bewerbungen ({bewerbungen.length})</h2>
      {bewerbungen.length === 0 ? (
        <p style={{ color: '#9a9994' }}>Noch keine Bewerbungen eingegangen.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafaf8', borderBottom: '1px solid #ececea' }}>
                <th style={thStyle}>Datum</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>E-Mail</th>
                <th style={thStyle}>Telefon</th>
                <th style={thStyle}>Quelle</th>
                {/* Vorqualifizierung: befüllte Felder + wichtige Kriterien (immer) */}
                {(job.vorqual_spalten || []).map(sp => (
                  <th key={`vq-${sp.name}`} style={{ ...thStyle, background: '#f4f7ff', whiteSpace: 'nowrap' }}
                    title={sp.wichtig ? 'Wichtiges Prüf-Kriterium' : 'Vorqualifizierung'}>
                    {sp.wichtig ? '⭐ ' : ''}{sp.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bewerbungen.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid #ececea', opacity: b.ko_kriterium ? 0.55 : 1 }}>
                  <td style={tdStyle}>{new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{b.name || '—'}</td>
                  <td style={tdStyle}>{b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : '—'}</td>
                  <td style={tdStyle}>{b.telefon ? <a href={`tel:${b.telefon}`}>{b.telefon}</a> : '—'}</td>
                  <td style={tdStyle}>{b.quelle || 'funnel'}</td>
                  {(job.vorqual_spalten || []).map(sp => {
                    const v = b.vorqualifizierung_werte?.[sp.name];
                    const hat = v != null && String(v).trim() !== '';
                    return (
                      <td key={`vq-${sp.name}`} style={{ ...tdStyle, background: '#fbfcff', color: hat ? undefined : '#9a9994' }}>
                        {hat ? String(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {job.bewerbungen_token && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#5a5955' }}>
          Detail-Ansicht: <a href={`/bewerbungen/${job.bewerbungen_token}`}>öffnen ↗</a>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ Creatives-Galerie ══════════════════════ */

function CreativesSection({ creatives, token, onSaved }) {
  const [lightbox, setLightbox] = useState(null);
  const [ueberarbeit, setUeberarbeit] = useState(null); // { creative, text }

  async function submitUeberarbeitung() {
    if (!ueberarbeit?.creative || !ueberarbeit.text.trim()) return;
    try {
      await api(`/public/portal/${token}/creative/${ueberarbeit.creative.id}/ueberarbeitung`, {
        method: 'POST', body: JSON.stringify({ text: ueberarbeit.text.trim() }),
      });
      alert('Danke — dein Änderungswunsch ist beim Team.');
      setUeberarbeit(null);
      onSaved();
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>🎨 Deine Creatives</h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {creatives.map((c, i) => (
          <div key={c.id} style={{ background: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
            <button onClick={() => setLightbox(i)} title="Groß-Ansicht"
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'zoom-in', width: '100%', display: 'block', aspectRatio: c.format === 'story' ? '9 / 16' : '1 / 1' }}>
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
