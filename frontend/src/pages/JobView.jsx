import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const JobContext = createContext(null);
export function useJob() { return useContext(JobContext); }

// Debounced-Text mit Auto-Save (600 ms) — für inline editierbare Felder.
function DebouncedInput({ value, onSave, placeholder }) {
  const [local, setLocal] = useState(value ?? '');
  const t = useRef(null);
  const lastRef = useRef(value ?? '');
  useEffect(() => { setLocal(value ?? ''); lastRef.current = value ?? ''; }, [value]);
  function onChange(e) {
    const val = e.target.value;
    setLocal(val);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { if (val !== lastRef.current) { lastRef.current = val; onSave(val); } }, 600);
  }
  function flush() { if (t.current) clearTimeout(t.current); if (local !== lastRef.current) { lastRef.current = local; onSave(local); } }
  return <input className="cell-input" type="text" value={local} placeholder={placeholder} onChange={onChange} onBlur={flush} />;
}

// Inline editierbare Garantie am Projekt (JobView-Header). Checkbox + Freitext,
// Auto-Save direkt ans verknüpfte Projekt. Jederzeit manuell änderbar.
function ProjektGarantieInline({ projekt, onSaved }) {
  async function patch(body) {
    try {
      const res = await api(`/projekte/${projekt.id}`, { method: 'PATCH', body });
      onSaved?.(res.projekt);
    } catch (err) { console.error('[garantie-patch]', err.message); }
  }
  const aktiv = !!projekt.garantie;
  return (
    <div style={{
      maxWidth: 340, padding: '6px 10px', borderRadius: 8, fontSize: 12,
      background: aktiv ? '#dcfce7' : '#f3f4f6',
      border: `1px solid ${aktiv ? '#86efac' : '#e5e7eb'}`,
      color: aktiv ? '#166534' : '#6b7280',
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
        <input type="checkbox" checked={aktiv} onChange={e => patch({ garantie: e.target.checked })} />
        🛡️ Garantie
      </label>
      {aktiv && (
        <div style={{ marginTop: 6 }}>
          <DebouncedInput
            value={projekt.garantie_details || ''}
            placeholder="Was ist garantiert? z. B. Erfolgsgarantie 30 Tage …"
            onSave={val => patch({ garantie_details: val || null })}
          />
        </div>
      )}
    </div>
  );
}

const TABS = [
  { to: 'stelle', label: 'Stelle' },
  { to: 'creatives', label: 'Creatives' },
  { to: 'adcopies', label: 'Ad Copies' },
  { to: 'funnel', label: 'Funnel' },
  { to: 'export', label: 'Freigabe & Go-Live' },
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
    // Sub-Status Kampagnen-Update-Feedback (Status bleibt live)
    const sub = projekt.update_feedback_status;
    const subBadge = sub === 'offen'
      ? { text: '📬 Update-Feedback offen', bg: '#fef3c7', fg: '#92400e' }
      : sub === 'ueberarbeitung'
        ? { text: '🔄 Update-Überarbeitung', bg: '#ffedd5', fg: '#9a3412' }
        : null;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: color, color: '#fff',
          padding: '4px 12px', borderRadius: 100,
          fontSize: 12, fontWeight: 600,
        }}>🟢 LIVE{start ? ` seit ${new Date(start).toLocaleDateString('de-DE')}` : ''}{tagInfo}</span>
        {subBadge && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: subBadge.bg, color: subBadge.fg,
            padding: '4px 12px', borderRadius: 100,
            fontSize: 12, fontWeight: 600,
          }}>{subBadge.text}</span>
        )}
      </span>
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
  const [letzteAktivitaet, setLetzteAktivitaet] = useState(null); // jüngstes Aktivitäts-Event (tab-übergreifend)
  const [fotoWarten, setFotoWarten] = useState(null); // { fehlt_fotos, fehlt_logo, angefragt_am, ueberfaellig } | null
  const [fotoReminderBusy, setFotoReminderBusy] = useState(false);

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

  // Jüngste Aktivität (tab-übergreifende "Zuletzt"-Zeile). Gleiche Quelle wie die
  // Timeline im Export-Tab — events[0] ist das neueste Event.
  useEffect(() => {
    if (!jobId) return;
    api(`/jobs/${jobId}/aktivitaet`)
      .then(r => setLetzteAktivitaet((r.events || [])[0] || null))
      .catch(() => setLetzteAktivitaet(null));
  }, [jobId, job?.id]);

  // Warten auf Fotos/Logo (gemeinsame Quelle mit "Nächster Schritt").
  const loadFotoWarten = useCallback(() => {
    if (!jobId) return;
    api(`/jobs/${jobId}/foto-status`)
      .then(r => setFotoWarten(r.warten || null))
      .catch(() => setFotoWarten(null));
  }, [jobId]);
  useEffect(() => { loadFotoWarten(); }, [loadFotoWarten, job?.id]);

  async function fotoErinnern() {
    if (!kundeId) return;
    setFotoReminderBusy(true);
    try {
      await api(`/kunden/${kundeId}/anfrage`, { method: 'POST', body: { reminder: true } });
      loadFotoWarten();
    } catch (err) { alert(`Erinnern fehlgeschlagen: ${err.message}`); }
    finally { setFotoReminderBusy(false); }
  }

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
        {projekt && <ProjektGarantieInline projekt={projekt} onSaved={setProjekt} />}
        {projekt?.werbebudget_modus === 'empfehlung' && (
          <span title="Werbebudget nicht über TalentOne abgerechnet — Kunden-Zahlungsmittel im Werbekonto hinterlegen (kein Zahlungslink)."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0f9ff', color: '#075985', border: '1px solid #bae6fd', padding: '4px 10px', borderRadius: 100, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
            💰 Budget: {projekt.tagesbudget_empfehlung ? `${projekt.tagesbudget_empfehlung} €/Tag, ` : ''}Kunde zahlt direkt
          </span>
        )}
        {projekt
          ? <div style={{ paddingTop: 6 }}><StatusBadge projekt={projekt} /></div>
          : <UebertragenButton jobId={jobId} onCreated={setProjekt} />
        }
      </div>

      {/* Zuletzt passiert — jüngste Aktivität am Projekt, sichtbar auf jedem Tab */}
      {letzteAktivitaet && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 12, padding: '6px 12px', borderRadius: 8,
          background: 'var(--gray-50, #f7f7f5)', border: '1px solid var(--line, #eee)',
          fontSize: 12.5, color: 'var(--ink-3, #666)',
        }}>
          <span aria-hidden>{letzteAktivitaet.icon || '🕑'}</span>
          <span><strong style={{ color: 'var(--ink, #333)' }}>Zuletzt:</strong> {letzteAktivitaet.titel}</span>
          {letzteAktivitaet.at && (
            <span style={{ color: 'var(--ink-4, #999)' }}>
              · {new Date(letzteAktivitaet.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
        </div>
      )}

      {/* Warten auf Fotos/Logo — tab-übergreifend im Status-Block */}
      {fotoWarten && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 12, padding: '8px 14px', borderRadius: 8,
          background: fotoWarten.ueberfaellig ? '#fffbeb' : '#eff6ff',
          border: `1px solid ${fotoWarten.ueberfaellig ? '#fde68a' : '#bfdbfe'}`,
          borderLeft: `4px solid ${fotoWarten.ueberfaellig ? '#f59e0b' : '#3b82f6'}`,
          fontSize: 13, color: fotoWarten.ueberfaellig ? '#92400e' : '#1e40af',
        }}>
          <span aria-hidden>{fotoWarten.ueberfaellig ? '⚠️' : '📸'}</span>
          <span style={{ flex: 1, minWidth: 200 }}>
            <strong>Warten auf {[fotoWarten.fehlt_fotos && 'Fotos', fotoWarten.fehlt_logo && 'Logo'].filter(Boolean).join(' & ')}</strong>
            {fotoWarten.angefragt_am && ` (angefragt am ${new Date(fotoWarten.angefragt_am).toLocaleDateString('de-DE')}${fotoWarten.tage != null ? `, ${fotoWarten.tage} Tage` : ''})`}
          </span>
          {fotoWarten.ueberfaellig && (
            <button type="button" className="btn-ghost btn-sm" onClick={fotoErinnern} disabled={fotoReminderBusy}
              title="Die bestehende Anfrage-Mail erneut senden">
              {fotoReminderBusy ? 'Sende…' : '🔔 Erinnern'}
            </button>
          )}
        </div>
      )}

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
