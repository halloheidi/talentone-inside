import { useState } from 'react';
import { api } from '../lib/api.js';

// Inline-Status-Dropdown für Projekte — überall dort nutzbar, wo Projekte gelistet
// sind (Projektübersicht, Kundenakte, Controlling-Cockpit). EINE Update-Logik:
// PATCH /projekte/:id (exakt wie die Detailseite — keine zweite abgespeckte Logik).
// Optimistisches Update via onUpdated; bei Fehler Rollback + Hinweis.

export const STATUS_META = {
  vorbereitung:      { emoji: '🟠', label: 'Vorbereitung',       bg: '#fee2e2', color: '#991b1b' },
  kickoff_vereinbart:{ emoji: '📅', label: 'Kick-Off vereinbart', bg: '#dbeafe', color: '#1e3a8a' },
  onboarding:        { emoji: '🎯', label: 'Onboarding',         bg: '#ede9fe', color: '#5b21b6' },
  golive_vereinbart: { emoji: '🕐', label: 'Go-Live vereinbart',  bg: '#dbeafe', color: '#1e3a8a' },
  warte_auf_go:      { emoji: '⏳', label: 'Warte auf Go',        bg: '#fef3c7', color: '#92400e' },
  feedbackschleife:  { emoji: '🔔', label: 'Feedbackschleife',    bg: '#fef3c7', color: '#92400e' },
  go:                { emoji: '✅', label: 'Go vom Kunden',       bg: '#dcfce7', color: '#166534' },
  live:              { emoji: '🟢', label: 'Live',                bg: '#dcfce7', color: '#166534' },
  pausiert:          { emoji: '⏸', label: 'Pausiert',            bg: '#fee2e2', color: '#991b1b' },
  hold:              { emoji: '🟨', label: 'Hold',                bg: '#fef3c7', color: '#92400e' },
  abgeschlossen:     { emoji: '🏁', label: 'Abgeschlossen',       bg: '#d1fae5', color: '#065f46' },
};
export const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_META).map(([k, v]) => [k, v.label]));

// Statuswechsel mit Konsequenzen → kurze Rückfrage. Harmlose Wechsel ohne.
const KONSEQUENZ = {
  live: 'Status auf „Live" setzen — Kampagne-live wird gemeldet und die Laufzeit-/Reminder-Logik greift. Fortfahren?',
  abgeschlossen: 'Projekt „Abgeschlossen" — beendet Wächter/Uhren für dieses Projekt. Fortfahren?',
};

export default function ProjektStatusSelect({ projekt, onUpdated, readOnly = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const status = projekt?.status;
  const meta = STATUS_META[status] || { emoji: '·', label: status || '—', bg: '#e5e7eb', color: '#374151' };

  async function change(next) {
    setOpen(false);
    if (!next || next === status || !projekt?.id) return;
    if (KONSEQUENZ[next] && !window.confirm(KONSEQUENZ[next])) return;
    setErr(''); setBusy(true);
    onUpdated?.({ ...projekt, status: next }); // optimistisch
    try {
      const res = await api(`/projekte/${projekt.id}`, { method: 'PATCH', body: { status: next } });
      onUpdated?.(res.projekt);
    } catch (e) {
      onUpdated?.(projekt); // Rollback auf Originalstand
      setErr(e.body?.error || e.message || 'Speichern fehlgeschlagen');
    } finally { setBusy(false); }
  }

  const badgeStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: compact ? '2px 8px' : '3px 10px', borderRadius: 100,
    fontSize: compact ? 11 : 12, fontWeight: 700, lineHeight: 1.3,
    background: meta.bg, color: meta.color, border: 'none',
    cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap',
  };

  if (readOnly) return <span style={badgeStyle} title={meta.label}>{meta.emoji} {meta.label}</span>;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
      <button type="button" style={badgeStyle} disabled={busy} title="Status ändern — klicken" onClick={() => setOpen(o => !o)}>
        {meta.emoji} {meta.label} <span style={{ opacity: 0.55, fontSize: 10 }}>▾</span>
      </button>
      {err && <span title={err} style={{ color: '#c1272d', marginLeft: 4, cursor: 'help' }}>⚠</span>}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 61, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 4, minWidth: 190, maxHeight: 340, overflowY: 'auto' }}>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <button key={k} type="button" onClick={() => change(k)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: k === status ? '#eef3ff' : 'transparent', fontWeight: k === status ? 700 : 500 }}>
                <span>{v.emoji}</span> {v.label}
                {KONSEQUENZ[k] && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9a5a00' }} title="Wechsel mit Konsequenzen">⚠</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
