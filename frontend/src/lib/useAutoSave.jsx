import { useEffect, useRef, useState } from 'react';

// Debounced Auto-Save für Formular-Bereiche.
//
//   const status = useAutoSave(saveFn, watchKey, { enabled });
//
// - saveFn:   async Funktion, die den aktuellen Stand speichert (PATCH …).
// - watchKey: String/Primitive, das sich bei jeder relevanten Änderung ändert
//             (z. B. JSON.stringify(form)). Der Save feuert ~800 ms nach der
//             letzten Änderung.
// - enabled:  false verhindert Speichern (z. B. solange noch geladen wird).
//
// Der ALLERERSTE watchKey (Initialwert nach dem Laden) löst KEINEN Save aus.
// Rückgabe: 'idle' | 'saving' | 'saved' | 'error' — für <SaveStatus/>.
export function useAutoSave(saveFn, watchKey, { delay = 800, enabled = true } = {}) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const savedTimer = useRef(null);
  const lastSaved = useRef(undefined); // zuletzt gespeicherter watchKey
  const saveRef = useRef(saveFn);
  saveRef.current = saveFn;

  useEffect(() => {
    if (!enabled) return undefined;
    // Initialwert merken, aber nicht speichern.
    if (lastSaved.current === undefined) { lastSaved.current = watchKey; return undefined; }
    if (watchKey === lastSaved.current) return undefined; // keine echte Änderung

    if (timer.current) clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(async () => {
      try {
        await saveRef.current();
        lastSaved.current = watchKey;
        setStatus('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
      }
    }, delay);
    return () => timer.current && clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, enabled]);

  return status;
}

export function SaveStatus({ status, style }) {
  if (!status || status === 'idle') return null;
  const base = { fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, ...style };
  if (status === 'saving') return <span style={{ ...base, color: 'var(--ink-3, #888)' }}>Speichert…</span>;
  if (status === 'saved') return <span style={{ ...base, color: '#0a8043' }}>✓ Gespeichert</span>;
  return <span style={{ ...base, color: '#b91c1c' }}>⚠️ Nicht gespeichert</span>;
}
