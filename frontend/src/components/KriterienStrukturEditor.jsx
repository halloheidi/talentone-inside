import { useState } from 'react';

// B4: EINE Komponente für strukturierte Kriterien (ko/muss/wunsch + Freitext),
// wiederverwendet in Kunden-Tab, Onboarding, Portal und Vorqualifizierung.
// value = { ko:[{id,text,aktiv}], muss:[...], wunsch:[...], hinweis_freitext }
// onChange bekommt denselben kanonischen Shape zurück. readOnly = reine Anzeige.

const KATS = [
  { key: 'ko', label: 'Ausschluss (KO)', farbe: '#b91c1c', bg: '#fef2f2', hint: 'Fehlt das → sofort raus' },
  { key: 'muss', label: 'Muss', farbe: '#92400e', bg: '#fffbeb', hint: 'Pflicht' },
  { key: 'wunsch', label: 'Wunsch', farbe: '#1e40af', bg: '#eff6ff', hint: 'Von Vorteil' },
];

function uid() { return (crypto?.randomUUID?.() || String(Math.random()).slice(2)); }

export default function KriterienStrukturEditor({ value, onChange, readOnly = false, accent = '#1b3f80' }) {
  const v = value || { ko: [], muss: [], wunsch: [], hinweis_freitext: '' };
  const [entwurf, setEntwurf] = useState({ ko: '', muss: '', wunsch: '' });

  function add(kat) {
    const text = (entwurf[kat] || '').trim();
    if (!text) return;
    const next = { ...v, [kat]: [...(v[kat] || []), { id: uid(), text, aktiv: true }] };
    setEntwurf(e => ({ ...e, [kat]: '' }));
    onChange?.(next);
  }
  function remove(kat, id) { onChange?.({ ...v, [kat]: (v[kat] || []).filter(i => i.id !== id) }); }
  function setHinweis(t) { onChange?.({ ...v, hinweis_freitext: t }); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {KATS.map(kat => (
        <div key={kat.key}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 12, color: kat.farbe }}>{kat.label}</strong>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{kat.hint}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(v[kat.key] || []).map(item => (
              <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: kat.bg, color: kat.farbe, border: `1px solid ${kat.farbe}22`, borderRadius: 100, padding: '3px 10px', fontSize: 12.5, fontWeight: 600 }}>
                {item.text}
                {!readOnly && <button type="button" onClick={() => remove(kat.key, item.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: kat.farbe, fontSize: 14, lineHeight: 1, padding: 0 }} title="Entfernen">×</button>}
              </span>
            ))}
            {(v[kat.key] || []).length === 0 && readOnly && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>—</span>}
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input type="text" value={entwurf[kat.key]} onChange={e => setEntwurf(s => ({ ...s, [kat.key]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(kat.key); } }}
                placeholder={`${kat.label} hinzufügen…`}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13 }} />
              <button type="button" onClick={() => add(kat.key)} style={{ border: 'none', background: accent, color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+</button>
            </div>
          )}
        </div>
      ))}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4 }}>Freitext / Hinweis</div>
        {readOnly
          ? <div style={{ fontSize: 13 }}>{v.hinweis_freitext || '—'}</div>
          : <textarea rows={2} value={v.hinweis_freitext || ''} onChange={e => setHinweis(e.target.value)} placeholder="Zusätzliche Hinweise…" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13 }} />}
      </div>
    </div>
  );
}
