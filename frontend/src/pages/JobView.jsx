import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const JobContext = createContext(null);
export function useJob() { return useContext(JobContext); }

const TABS = [
  { to: 'stelle', label: 'Stelle' },
  { to: 'creatives', label: 'Creatives' },
  { to: 'adcopies', label: 'Ad Copies' },
  { to: 'funnel', label: 'Funnel' },
  { to: 'export', label: 'Export' },
];

const STATUS_LABELS = {
  vorbereitung: 'Vorbereitung',
  kickoff_vereinbart: 'Kick-Off vereinbart',
  onboarding: 'Onboarding',
  golive_vereinbart: 'Go-Live vereinbart',
  warte_auf_go: 'Warte auf Go!',
  feedbackschleife: 'Feedbackschleife',
  go: 'Go',
  live: 'Live',
  pausiert: 'Pausiert',
  hold: 'Hold',
  abgeschlossen: 'Abgeschlossen',
};

function UebertragenButton({ jobId, onCreated }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const res = await api(`/jobs/${jobId}/create-projekt`, { method: 'POST' });
      onCreated?.(res.projekt);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  }
  return (
    <button
      type="button" onClick={run} disabled={busy}
      style={{
        background: '#eff6ff', color: '#1e40af',
        border: '1px dashed #93c5fd', borderRadius: 8,
        padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
      }}
      title="Für diesen Job ein Projekt in der Übersicht anlegen"
    >
      {busy ? '…' : '➕ In Projektübersicht übertragen'}
    </button>
  );
}

function StatusBadge({ projekt }) {
  if (!projekt) return null;
  const status = projekt.status;
  if (status === 'live') {
    const start = projekt.start_phase1 || projekt.live_seit;
    let tagInfo = '';
    if (start) {
      const t = Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
      tagInfo = ` — Tag ${t} von 30`;
    }
    const color = start ? (
      (Math.floor((Date.now() - new Date(start).getTime()) / 86400000) >= 28) ? '#dc2626'
      : (Math.floor((Date.now() - new Date(start).getTime()) / 86400000) >= 20) ? '#f59e0b'
      : '#16a34a'
    ) : '#16a34a';
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: color, color: '#fff',
        padding: '4px 12px', borderRadius: 100,
        fontSize: 12, fontWeight: 600,
      }}>🟢 LIVE{start ? ` seit ${new Date(start).toLocaleDateString('de-DE')}` : ''}{tagInfo}</span>
    );
  }
  const label = STATUS_LABELS[status] || status;
  const isFeedback = status === 'feedbackschleife';
  const isGo = status === 'go';
  const bg = isFeedback ? '#fef3c7' : isGo ? '#dcfce7' : '#e0f2fe';
  const fg = isFeedback ? '#92400e' : isGo ? '#166534' : '#1e40af';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: bg, color: fg,
      padding: '4px 12px', borderRadius: 100,
      fontSize: 12, fontWeight: 600,
    }}>{label}</span>
  );
}

function ArbeitshinweiseInline({ job, onSaved }) {
  const [value, setValue] = useState(job.arbeitshinweise || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => { setValue(job.arbeitshinweise || ''); }, [job.arbeitshinweise, job.id]);

  function scheduleSave(newVal) {
    setValue(newVal);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const trimmed = newVal.trim();
        const res = await api(`/jobs/${job.id}`, { method: 'PATCH', body: { arbeitshinweise: trimmed || null } });
        onSaved?.(res.job);
      } catch (err) { console.warn('[arbeitshinweise-save]', err.message); }
      setSaving(false);
    }, 700);
  }

  if (!editing && !value.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          background: 'transparent', border: '1px dashed #d4d4d0',
          padding: '6px 12px', borderRadius: 6, color: '#5a5955',
          fontSize: 12, cursor: 'pointer',
        }}
      >+ Arbeitshinweis hinzufügen</button>
    );
  }

  if (!editing && value.trim()) {
    return (
      <div
        onClick={() => setEditing(true)}
        style={{
          background: '#fef3c7', border: '1px solid #fbbf24',
          padding: '10px 14px', borderRadius: 8, color: '#78350f',
          fontSize: 14, fontWeight: 500, cursor: 'text',
          display: 'flex', gap: 8, alignItems: 'center',
        }}
        title="Klicken zum Bearbeiten"
      >
        <span aria-hidden>⚠️</span>
        <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{value}</span>
      </div>
    );
  }

  return (
    <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', padding: 10, borderRadius: 8 }}>
      <textarea
        autoFocus rows={2}
        value={value}
        placeholder='z. B. "Keine KI-Bilder gewünscht — nur echte Fotos verwenden"'
        onChange={e => scheduleSave(e.target.value)}
        onBlur={() => setEditing(false)}
        style={{
          width: '100%', border: 'none', background: 'transparent',
          fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
          color: '#78350f', outline: 'none',
        }}
      />
      <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
        {saving ? 'Speichere…' : 'Auto-Save nach 0.7s'}
      </div>
    </div>
  );
}

export default function JobView() {
  const { kundeId, jobId } = useParams();
  const [job, setJob] = useState(null);
  const [kunde, setKunde] = useState(null);
  const [projekt, setProjekt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tabStatus, setTabStatus] = useState(null); // { auto, manual, effective }

  const loadTabStatus = useCallback(
    () => api(`/jobs/${jobId}/tab-status`).then(setTabStatus).catch(() => {}),
    [jobId],
  );
  useEffect(() => { loadTabStatus(); }, [loadTabStatus]);

  async function toggleTab(tab) {
    if (!tabStatus) return;
    const next = !tabStatus.effective[tab];
    const manual = { ...tabStatus.manual, [tab]: next };
    setTabStatus(ts => ({ ...ts, manual, effective: { ...ts.effective, [tab]: next } })); // optimistisch
    try {
      await api(`/jobs/${jobId}`, { method: 'PATCH', body: { tab_status: manual } });
    } catch (e) { /* ignore */ }
    loadTabStatus();
  }

  // Tracking von Hintergrund-Tasks (übersteht Tab-Wechsel innerhalb des Jobs)
  const [pendingCreatives, setPendingCreatives] = useState(0);    // # erwartete neue Bilder
  const [pendingReels, setPendingReels] = useState([]);            // [parent_creative_id, …]
  const creativesBaselineRef = useRef(null);                       // # Creatives als wir den Job geladen haben

  // Lädt sowohl Job als auch Kunden neu — z.B. nach Logo-Upload, damit kunde.logo_url aktuell ist.
  function reload() {
    loadTabStatus(); // Auto-Erkennung aktualisieren (Creatives/Funnel/Export können sich geändert haben)
    return Promise.all([
      api(`/jobs/${jobId}`).then(r => setJob(r.job)),
      api(`/kunden/${kundeId}`).then(r => setKunde(r.kunde)),
    ]);
  }

  // Werden vom JobCreatives aufgerufen wenn ein Background-Task startet.
  const startCreatives = useCallback(async (n) => {
    if (!n || n < 1) return;
    // Baseline: aktuelle Galerie-Größe (für sauberes Decrement)
    if (creativesBaselineRef.current === null) {
      try {
        const res = await api(`/creatives?job_id=${jobId}`);
        creativesBaselineRef.current = (res.creatives || []).length;
      } catch { creativesBaselineRef.current = 0; }
    }
    setPendingCreatives(p => p + n);
  }, [jobId]);

  const startReel = useCallback((parentCreativeId) => {
    if (!parentCreativeId) return;
    setPendingReels(prev => prev.includes(parentCreativeId) ? prev : [...prev, parentCreativeId]);
  }, []);

  // Polling — läuft NUR wenn etwas pending ist. Pollt /creatives, decrement entsprechend.
  useEffect(() => {
    if (pendingCreatives === 0 && pendingReels.length === 0) return;
    const startedAt = Date.now();
    const TIMEOUT_MS = 6 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const res = await api(`/creatives?job_id=${jobId}`);
        const list = res.creatives || [];

        // Bilder
        if (pendingCreatives > 0 && creativesBaselineRef.current !== null) {
          const delta = list.length - creativesBaselineRef.current;
          if (delta > 0) {
            setPendingCreatives(prev => Math.max(0, prev - delta));
            creativesBaselineRef.current = list.length;
          }
        }

        // Reels
        if (pendingReels.length > 0) {
          const fertige = list.filter(c => c.typ === 'video' && pendingReels.includes(c.parent_id));
          if (fertige.length > 0) {
            const fertigIds = new Set(fertige.map(c => c.parent_id));
            setPendingReels(prev => prev.filter(id => !fertigIds.has(id)));
          }
        }

        // Sicherheits-Timeout
        if (Date.now() - startedAt > TIMEOUT_MS) {
          setPendingCreatives(0);
          setPendingReels([]);
        }
      } catch (err) { console.warn('[jobview-poll]', err.message); }
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingCreatives, pendingReels, jobId]);

  // Beim Job-Wechsel: state resetten
  useEffect(() => {
    setPendingCreatives(0);
    setPendingReels([]);
    creativesBaselineRef.current = null;
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([api(`/jobs/${jobId}`), api(`/kunden/${kundeId}`)])
      .then(([j, k]) => { setJob(j.job); setKunde(k.kunde); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [jobId, kundeId]);

  // Verknüpftes Projekt laden (für Status-Badge). Erstes/primäres Projekt des Kunden.
  useEffect(() => {
    if (!kundeId) return;
    api(`/projekte?kunde_id=${kundeId}`).then(r => {
      const primary = (r.projekte || [])[0] || null;
      setProjekt(primary);
    }).catch(() => setProjekt(null));
  }, [kundeId, job?.id]);

  if (loading) return <div className="card empty">Lade…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!job) return <div className="card empty"><h2>Projekt nicht gefunden</h2></div>;

  const hasPending = pendingCreatives > 0 || pendingReels.length > 0;

  return (
    <JobContext.Provider value={{ job, kunde, reload, startCreatives, startReel, pendingCreatives, pendingReels }}>
      <div className="breadcrumb">
        <Link to="/kunden">Kunden</Link>
        <span aria-hidden>›</span>
        <Link to={`/kunden/${kundeId}`}>{kunde?.firmenname || 'Kunde'}</Link>
        <span aria-hidden>›</span>
        <span>{job.stelle || 'Projekt'}</span>
      </div>

      <div className="page-head">
        <div>
          <h1 className="page-title">{job.stelle || 'Unbenanntes Projekt'}</h1>
          <p className="page-sub">
            {[job.region, job.gehalt].filter(Boolean).join(' · ') || 'Noch keine Details hinterlegt.'}
          </p>
        </div>
      </div>

      {/* Formular-Ausgefüllt-Hinweis — dezenter grüner Info-Banner wenn der
          Kunde den Job über das öffentliche Formular submitted hat. Zeitpunkt
          ist job.created_at (Insert erfolgt exakt beim submit). */}
      {job.eingabe_methode === 'formular' && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          background: '#dcfce7', border: '1px solid #86efac',
          padding: '8px 14px', borderRadius: 8, marginBottom: 10,
          fontSize: 13, color: '#166534',
        }}>
          <span aria-hidden style={{ fontSize: 16 }}>✅</span>
          <span>
            <strong>Vom Kunden ausgefüllt</strong> am{' '}
            {new Date(job.created_at).toLocaleString('de-DE', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })} Uhr
            {kunde?.ansprechpartner ? ` · ${kunde.ansprechpartner}` : ''}
          </span>
        </div>
      )}

      {/* Arbeitshinweis + Status-Badge über allen Tabs */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <ArbeitshinweiseInline job={job} onSaved={(updated) => setJob(updated)} />
        </div>
        {projekt?.garantie && (
          <div style={{ padding: '4px 10px', background: '#dcfce7', color: '#166534', borderRadius: 6, fontSize: 12, fontWeight: 600, maxWidth: 320 }}
            title={projekt.garantie_details || 'Garantie aktiv'}>
            🛡️ Garantie{projekt.garantie_details ? `: ${projekt.garantie_details.slice(0, 60)}${projekt.garantie_details.length > 60 ? '…' : ''}` : ''}
          </div>
        )}
        {projekt
          ? <div style={{ paddingTop: 6 }}><StatusBadge projekt={projekt} /></div>
          : <UebertragenButton jobId={jobId} onCreated={setProjekt} />
        }
      </div>

      {hasPending && (
        <div className="bg-task-banner">
          <span className="bg-task-spinner" aria-hidden />
          <span className="bg-task-msgs">
            {pendingCreatives > 0 && (
              <span>⏳ {pendingCreatives} Creative{pendingCreatives === 1 ? '' : 's'} wird/werden generiert…</span>
            )}
            {pendingReels.length > 0 && (
              <span>🎬 {pendingReels.length} Reel{pendingReels.length === 1 ? '' : 's'} wird erstellt…</span>
            )}
          </span>
          <span className="bg-task-hint">Du kannst weiter arbeiten — fertige Ergebnisse erscheinen automatisch im Creatives-Tab.</span>
        </div>
      )}

      <div className="tabs">
        {TABS.map(t => {
          const done = tabStatus?.effective?.[t.to] === true;
          const manuell = typeof tabStatus?.manual?.[t.to] === 'boolean';
          return (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
              {t.label}
              {tabStatus && (
                <span
                  role="button"
                  tabIndex={0}
                  className={`tab-check ${done ? 'is-done' : ''} ${manuell ? 'is-manual' : ''}`}
                  title={done
                    ? `Erledigt${manuell ? ' (manuell)' : ' (automatisch erkannt)'} — Klick zum Zurücksetzen`
                    : 'Als erledigt markieren'}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); toggleTab(t.to); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleTab(t.to); } }}
                >{done ? '✓' : '○'}</span>
              )}
            </NavLink>
          );
        })}
      </div>

      <div className="tab-content">
        <Outlet />
      </div>
    </JobContext.Provider>
  );
}
