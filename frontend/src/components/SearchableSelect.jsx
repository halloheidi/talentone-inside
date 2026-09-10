import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * SearchableSelect — kleine, wiederverwendbare durchsuchbare Auswahl.
 * Ersetzt einfache <select>-Dropdowns, wenn die Optionsliste lang ist.
 *
 * Das Popover (ul.ss-pop) wird per Portal an document.body gerendert und mit
 * position:fixed anhand der Input-BoundingBox positioniert — so wird es weder
 * vom Karten-/Zeilen-Container beschnitten noch von transform-Kontexten (z. B.
 * Slide-Over) verschoben, und es kann bei wenig Platz unten nach oben klappen.
 *
 * Props:
 *   value        aktueller Wert (oder null/'' für „nichts gewählt")
 *   onChange     (newValue) => void  — bei allowEmpty liefert die Leer-Option null
 *   options      Array<{ value, label }>
 *   placeholder  Text im leeren/ungewählten Zustand
 *   allowEmpty   wenn true: Leer-Option („erben/löschen") steht oben, setzt onChange(null)
 *   emptyLabel   Label der Leer-Option (z. B. „(vom Kunden erben)")
 *   disabled     bool
 *   className    optionale Zusatzklasse fürs Input (Default: cell-input-Look)
 *   style        optionaler Style fürs Wrapper-Element
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Auswählen…',
  allowEmpty = false,
  emptyLabel = '(leer)',
  disabled = false,
  className = 'cell-input',
  style,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [popPos, setPopPos] = useState(null); // { left, width, top?, bottom?, maxHeight }
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null); // = Popover-Knoten (im Portal); auch für Outside-Click
  const baseId = useRef(`ss-${Math.random().toString(36).slice(2, 9)}`).current;

  const safeOptions = Array.isArray(options) ? options : [];

  // Kombinierte Liste inkl. Leer-Option (falls erlaubt) für einheitliches Filtern.
  const allItems = useMemo(() => {
    const items = safeOptions.map(o => ({ value: o.value, label: o.label ?? '' }));
    if (allowEmpty) items.unshift({ value: null, label: emptyLabel, __empty: true });
    return items;
  }, [safeOptions, allowEmpty, emptyLabel]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return allItems;
    return allItems.filter(it => (it.label || '').toLowerCase().includes(q));
  }, [allItems, q]);

  // Label des aktuell gewählten Werts.
  const isEmptyValue = value === null || value === undefined || value === '';
  const selectedItem = safeOptions.find(o => o.value === value);
  const displayLabel = isEmptyValue
    ? (allowEmpty ? emptyLabel : '')
    : (selectedItem ? selectedItem.label : String(value));

  // Beim Öffnen: Query leeren, aktive Zeile auf aktuelle Auswahl setzen.
  useEffect(() => {
    if (!open) return;
    const idx = filtered.findIndex(it =>
      isEmptyValue ? it.__empty : it.value === value,
    );
    setActiveIndex(idx >= 0 ? idx : 0);
    // nur beim Öffnen ausführen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Popover-Position aus der Input-BoundingBox berechnen (fixed, mit Flip nach oben).
  const computePos = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 2;
    const maxH = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Nach oben klappen, wenn unten zu wenig Platz und oben mehr Platz ist.
    const openUp = spaceBelow < Math.min(maxH + gap + 8, 220) && spaceAbove > spaceBelow;
    const avail = (openUp ? spaceAbove : spaceBelow) - gap - 8;
    setPopPos({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - rect.width - 4)),
      width: rect.width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
      maxHeight: Math.max(120, Math.min(maxH, avail)),
    });
  };

  // Position vor dem Paint berechnen (kein Flackern) + bei Scroll/Resize neu.
  useLayoutEffect(() => {
    if (!open) { setPopPos(null); return; }
    computePos();
    const onWin = () => computePos();
    window.addEventListener('scroll', onWin, true); // capture: auch innere Scroll-Container
    window.addEventListener('resize', onWin);
    return () => {
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
    // nur an open koppeln — computePos liest Refs frisch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Aktiven Index in Sicht scrollen.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`#${baseId}-opt-${activeIndex}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, baseId, popPos]);

  // Outside-Click → schließen. Der Portal-Knoten liegt außerhalb von wrapRef,
  // deshalb zusätzlich das Popover selbst prüfen.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (listRef.current && listRef.current.contains(e.target)) return;
      close();
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(item) {
    if (!item) return;
    onChange(item.__empty ? null : item.value);
    close();
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const popover = open && popPos ? createPortal(
    <ul
      ref={listRef}
      id={`${baseId}-list`}
      role="listbox"
      className="ss-pop ss-pop-fixed"
      style={{
        position: 'fixed',
        left: popPos.left,
        width: popPos.width,
        right: 'auto',
        maxHeight: popPos.maxHeight,
        ...(popPos.top != null ? { top: popPos.top } : { bottom: popPos.bottom }),
      }}
    >
      {filtered.length === 0 && (
        <li className="ss-opt ss-empty" aria-disabled="true">Keine Treffer</li>
      )}
      {filtered.map((it, i) => (
        <li
          key={(it.__empty ? '__empty__' : String(it.value)) + '-' + i}
          id={`${baseId}-opt-${i}`}
          role="option"
          aria-selected={isEmptyValue ? !!it.__empty : it.value === value}
          className={'ss-opt' + (i === activeIndex ? ' active' : '') + (it.__empty ? ' ss-opt-empty' : '')}
          onMouseDown={e => e.preventDefault()}
          onMouseEnter={() => setActiveIndex(i)}
          onClick={() => choose(it)}
        >
          {highlight(it.label, q)}
        </li>
      ))}
    </ul>,
    document.body,
  ) : null;

  return (
    <div ref={wrapRef} className="ss-wrap" style={style}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${baseId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={open ? query : displayLabel}
        placeholder={open ? (displayLabel || placeholder) : placeholder}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); setActiveIndex(0); }}
        onKeyDown={onKeyDown}
      />
      {popover}
    </div>
  );
}

// Hebt den getroffenen Substring im Label hervor.
function highlight(label, q) {
  const text = label ?? '';
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
