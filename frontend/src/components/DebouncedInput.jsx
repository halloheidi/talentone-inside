import { useEffect, useRef, useState } from 'react';

// Gemeinsames Auto-Save-Eingabefeld für alle inline editierbaren Felder
// (Zahlen wie Text). Eine Quelle, damit das Verhalten überall gleich ist.
//
// Behebt das „Wert springt beim Tippen zurück"-Problem:
//  - Während des Tippens gilt ausschließlich der lokale State.
//  - Gespeichert wird erst 800 ms nach dem letzten Tastendruck UND spätestens
//    beim Verlassen des Feldes (onBlur). Enter löst ebenfalls Speichern aus.
//  - Die Server-/Prop-Antwort überschreibt das Feld NUR, wenn es gerade NICHT
//    fokussiert ist — ein Autosave-Echo kann die laufende Eingabe so nie kippen.
//
// onSave bekommt den rohen String; das Parsen (z. B. Number(v) || 0) macht die
// aufrufende Stelle, damit Zahlen-/Text-/E-Mail-Felder dieselbe Komponente teilen.
export default function DebouncedInput({
  value, onSave, type = 'text', rows, placeholder,
  className = 'cell-input', delay = 800, disabled, min, step, style,
}) {
  const norm = value == null ? '' : String(value);
  const [local, setLocal] = useState(norm);
  const timerRef = useRef(null);
  const lastRef = useRef(norm);     // zuletzt gespeicherter Wert
  const focused = useRef(false);

  // Prop-Änderung nur übernehmen, wenn das Feld nicht fokussiert ist.
  useEffect(() => {
    if (focused.current) return;
    setLocal(norm);
    lastRef.current = norm;
  }, [norm]);

  // Timer beim Unmount aufräumen.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function commit(v) {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (v !== lastRef.current) { lastRef.current = v; onSave(v); }
  }
  function onChange(e) {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(v), delay);
  }
  function onFocus() { focused.current = true; }
  function onBlur() { focused.current = false; commit(local); }
  function onKeyDown(e) { if (!rows && e.key === 'Enter') e.currentTarget.blur(); }

  const common = { className, value: local, placeholder, disabled, style, onChange, onFocus, onBlur };
  if (rows) return <textarea {...common} rows={rows} />;
  return <input {...common} type={type} min={min} step={step} onKeyDown={onKeyDown} />;
}
