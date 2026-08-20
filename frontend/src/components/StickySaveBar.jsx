// Am unteren Content-Rand fixierte Speichern-Leiste.
// Wiederverwendbar für Seiten mit manuellem Save + Dirty-State.
// Props:
//   dirty    — true, sobald ungespeicherte Änderungen bestehen
//   busy     — Save läuft gerade (Button disabled + „Speichere…")
//   onSave   — Klick-Handler des Haupt-Buttons
//   savedAt  — Zeitstempel-String der letzten erfolgreichen Speicherung (z. B. "14:03")
//   error    — Fehlertext der letzten Speicherung (rot); leer/undefined = kein Fehler
//   children — optionale Zusatz-Elemente links vom Speichern-Button (z. B. Publish)
export default function StickySaveBar({ dirty, busy, onSave, savedAt, error, children }) {
  return (
    <div className="sticky-save-bar" role="region" aria-label="Speichern">
      <div className="sticky-save-bar-inner">
        <div className="sticky-save-status">
          {dirty ? (
            <span className="sticky-save-dirty">
              <span className="sticky-save-dot" aria-hidden />
              Du hast ungespeicherte Änderungen
            </span>
          ) : savedAt ? (
            <span className="sticky-save-ok">Gespeichert ✓ {savedAt}</span>
          ) : (
            <span className="sticky-save-idle">Alles gespeichert ✓</span>
          )}
          {error && <span className="sticky-save-error">⚠ {error}</span>}
        </div>
        <div className="sticky-save-actions">
          {children}
          <button
            type="button"
            className="btn-primary"
            onClick={onSave}
            disabled={busy || !dirty}
          >
            {busy ? 'Speichere…' : dirty ? 'Änderungen speichern' : 'Alles gespeichert ✓'}
          </button>
        </div>
      </div>
    </div>
  );
}
