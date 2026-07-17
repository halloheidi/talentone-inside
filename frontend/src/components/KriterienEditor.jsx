// Editor für "Worauf achten wir?" — wird intern (Job) UND im Kunden-Portal genutzt.
//
// Rein präsentational: bekommt kriterien + felder, meldet Änderungen über
// onChange. Das Speichern (und damit die Invariante "jedes Kriterium = genau ein
// Feld") macht das Backend — hier wird nur vorgeschlagen/ausgewählt.
//
// Ein Kriterium REFERENZIERT ein Vorqual-Feld (Dropdown der konfigurierten
// Felder). Freitext ist erlaubt: existiert das Feld nicht, legt das Backend es
// automatisch an — nie entstehen Doppel-Spalten.

import { useState } from 'react';

const LEER = { kriterium: '', anforderung: '', pflicht: false };

export default function KriterienEditor({ kriterien = [], felder = [], onChange, disabled = false }) {
  const [neu, setNeu] = useState(LEER);
  const feldNamen = felder.map(f => f?.name).filter(Boolean);
  const genutzt = new Set(kriterien.map(k => k.kriterium));

  function patch(i, p) {
    onChange(kriterien.map((k, idx) => (idx === i ? { ...k, ...p } : k)));
  }
  function remove(i) {
    onChange(kriterien.filter((_, idx) => idx !== i));
  }
  function add() {
    const name = (neu.kriterium || '').trim();
    if (!name) return;
    onChange([...kriterien, { ...neu, kriterium: name, anforderung: (neu.anforderung || '').trim() || null }]);
    setNeu(LEER);
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {kriterien.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Noch keine Kriterien festgelegt.</div>
      )}

      {kriterien.map((k, i) => (
        <div key={i} style={rowStyle}>
          <button type="button" title={k.pflicht ? 'Pflicht-Kriterium (KO)' : 'Optional — Klick macht es zur Pflicht'}
            onClick={() => !disabled && patch(i, { pflicht: !k.pflicht })}
            style={{ ...pflichtBtn, opacity: k.pflicht ? 1 : 0.35 }}>❗</button>
          <strong style={{ minWidth: 130, fontSize: 13 }}>{k.kriterium}</strong>
          <input
            type="text"
            value={k.anforderung || ''}
            onChange={e => patch(i, { anforderung: e.target.value })}
            placeholder="Anforderung, z. B. mind. 3 Jahre"
            disabled={disabled}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={() => remove(i)} disabled={disabled}>×</button>
        </div>
      ))}

      {/* Neues Kriterium: bestehendes Feld wählen oder frei ergänzen */}
      <div style={{ ...rowStyle, background: 'var(--gray-50)' }}>
        <span style={{ width: 22 }} />
        <select
          value={feldNamen.includes(neu.kriterium) ? neu.kriterium : ''}
          onChange={e => setNeu({ ...neu, kriterium: e.target.value })}
          disabled={disabled}
          style={{ ...inputStyle, minWidth: 150 }}
        >
          <option value="">— Feld wählen —</option>
          {feldNamen.filter(n => !genutzt.has(n)).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input
          type="text"
          value={feldNamen.includes(neu.kriterium) ? '' : neu.kriterium}
          onChange={e => setNeu({ ...neu, kriterium: e.target.value })}
          placeholder="…oder eigenes (z. B. Schwindelfreiheit)"
          disabled={disabled}
          style={{ ...inputStyle, width: 190 }}
        />
        <input
          type="text"
          value={neu.anforderung}
          onChange={e => setNeu({ ...neu, anforderung: e.target.value })}
          placeholder="Anforderung"
          disabled={disabled}
          style={{ ...inputStyle, flex: 1 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={neu.pflicht} onChange={e => setNeu({ ...neu, pflicht: e.target.checked })} disabled={disabled} />
          Pflicht
        </label>
        <button type="button" className="btn-ghost btn-sm" onClick={add} disabled={disabled || !neu.kriterium.trim()}>
          + Hinzufügen
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        Jedes Kriterium gehört zu genau einem Prüf-Feld — eigene Kriterien legen automatisch ein Feld an.
        ❗ = Pflicht (ohne das geht es nicht).
      </div>
    </div>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', background: '#fff',
};
const inputStyle = { padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13 };
const pflichtBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, width: 22, padding: 0,
};
