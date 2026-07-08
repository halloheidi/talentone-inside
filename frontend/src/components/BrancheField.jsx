import { useState } from 'react';
import { BRANCHE_OPTIONS, isCustomBranche } from '../lib/branchen.js';

// Kontrolliertes Feld: Select + optionaler Freitext für "Andere Branche".
// Der Freitext-Wert wird 1:1 als branche-String zurückgegeben (onChange).
export default function BrancheField({ value, onChange, selectStyle, inputStyle, selectClassName, inputClassName }) {
  const isCustom = isCustomBranche(value);
  const [customToggled, setCustomToggled] = useState(false);
  const inCustomMode = isCustom || customToggled;

  function handleSelect(e) {
    const v = e.target.value;
    if (v === '__andere__') {
      setCustomToggled(true);
      onChange(''); // Freitext startet leer
    } else {
      setCustomToggled(false);
      onChange(v);
    }
  }

  return (
    <>
      <select
        value={inCustomMode ? '__andere__' : (value || '')}
        onChange={handleSelect}
        className={selectClassName}
        style={selectStyle}
      >
        {BRANCHE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {inCustomMode && (
        <input
          type="text"
          placeholder="Eigene Branche eingeben…"
          value={isCustom ? value : ''}
          onChange={e => onChange(e.target.value)}
          className={inputClassName}
          style={{ marginTop: 6, ...(inputStyle || {}) }}
        />
      )}
    </>
  );
}
