// Wiederverwendbare Feldergruppe für die neuen Projekt-Flags (Migration 025):
// Fotograf (nur N&W), Projektdauer, Zahlung aufgeteilt, Garantie + Details.
// Benutzt in QuickCreateModal (manual-Tab) und NewProjectModal.

import { useEffect, useRef } from 'react';

export const PROJEKTDAUER_OPTIONEN = [
  '', '30 Tage', '60 Tage', '90 Tage', '6 Monate', '12 Monate', 'Abo', 'Individuell',
];

// Erfolgsgarantie-Linie: kostenlose Weiterarbeit bis zur ersten Einstellung.
export const garantieStandardText = (frist) =>
  `Erfolgsgarantie ${frist} — kostenlose Weiterarbeit bis zur ersten Einstellung.`;

// N&W-Fristen zur Auswahl. TalentOne bekommt keine Default-Garantie.
export const GARANTIE_FRISTEN = ['30 Tage', '60 Tage'];

export default function ProjektFlagsFields({ value, onChange, agentur }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const istNw = agentur === 'nowagwirth';
  const dauerCustom = !PROJEKTDAUER_OPTIONEN.includes(v.projektdauer || '') && v.projektdauer;

  // Agentur-Defaults für die Garantie. Greifen nur, solange die Garantie-
  // Checkbox nicht manuell angefasst wurde (touchedRef). N&W → standardmäßig AN
  // mit 30-Tage-Erfolgsgarantie; TalentOne → AUS (nur per Sondervereinbarung
  // oder Angebots-Übernahme). Läuft pro Agentur-Wechsel genau einmal.
  const touchedRef = useRef(false);
  const lastAgenturRef = useRef(undefined);
  useEffect(() => {
    if (lastAgenturRef.current === agentur) return;
    lastAgenturRef.current = agentur;
    if (touchedRef.current) return;
    if (agentur === 'nowagwirth') {
      const frist = v.garantie_frist || '30 Tage';
      onChange({
        ...v,
        garantie: true,
        garantie_frist: frist,
        garantie_details: v.garantie_details || garantieStandardText(frist),
      });
    } else {
      onChange({ ...v, garantie: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentur]);

  function toggleGarantie(checked) {
    touchedRef.current = true;
    if (checked) {
      const frist = v.garantie_frist || (istNw ? '30 Tage' : '');
      set({
        garantie: true,
        garantie_frist: frist,
        garantie_details: v.garantie_details || (istNw ? garantieStandardText(frist) : ''),
      });
    } else {
      set({ garantie: false });
    }
  }

  // Aktuell gewählte Frist ableiten (für das N&W-Dropdown).
  const aktuelleFrist = GARANTIE_FRISTEN.includes(v.garantie_frist) ? v.garantie_frist : 'Individuell';

  function setFrist(frist) {
    if (frist === 'Individuell') { set({ garantie_frist: 'Individuell' }); return; }
    // Standard-Text neu setzen, sofern der Nutzer nicht schon einen abweichenden
    // Freitext getippt hat (dann nur die Frist merken, Text unangetastet lassen).
    const istStandard = !v.garantie_details
      || GARANTIE_FRISTEN.some(f => v.garantie_details === garantieStandardText(f));
    set({
      garantie_frist: frist,
      garantie_details: istStandard ? garantieStandardText(frist) : v.garantie_details,
    });
  }

  return (
    <div className="form-grid">
      <label className="field field-full">
        <span>Projektdauer</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={dauerCustom ? 'Individuell' : (v.projektdauer || '')}
            onChange={e => {
              const val = e.target.value;
              if (val === 'Individuell') set({ projektdauer: v.projektdauer_freitext || '' });
              else set({ projektdauer: val || null, projektdauer_freitext: '' });
            }}
            style={{ flex: '0 0 220px' }}
          >
            {PROJEKTDAUER_OPTIONEN.map(o =>
              <option key={o} value={o}>{o || '— nicht angegeben —'}</option>
            )}
          </select>
          {(dauerCustom || v.projektdauer === '' && v.projektdauer_freitext !== undefined) && (
            <input
              type="text" placeholder="z. B. 45 Tage, 3 Monate rollierend…"
              value={dauerCustom ? v.projektdauer : (v.projektdauer_freitext || '')}
              onChange={e => set({ projektdauer: e.target.value, projektdauer_freitext: e.target.value })}
              style={{ flex: 1 }}
            />
          )}
        </div>
      </label>

      {istNw && (
        <label className="field-checkbox field-full">
          <input type="checkbox"
            checked={!!v.fotograf_noetig}
            onChange={e => set({ fotograf_noetig: e.target.checked })} />
          <span>📸 Muss ein Fotograf organisiert werden? <em style={{ fontStyle: 'normal', color: '#5a5955', fontSize: 12 }}>(N&amp;W)</em></span>
        </label>
      )}

      <label className="field-checkbox field-full">
        <input type="checkbox"
          checked={!!v.zahlung_aufgeteilt}
          onChange={e => set({ zahlung_aufgeteilt: e.target.checked })} />
        <span>💰 Zahlung aufgeteilt <em style={{ fontStyle: 'normal', color: '#5a5955', fontSize: 12 }}>(interne Info — betrifft unsere Abrechnung, nicht den Kunden)</em></span>
      </label>

      <label className="field-checkbox field-full">
        <input type="checkbox"
          checked={!!v.garantie}
          onChange={e => toggleGarantie(e.target.checked)} />
        <span>🛡️ Garantie zugesagt {istNw
          ? <em style={{ fontStyle: 'normal', color: '#5a5955', fontSize: 12 }}>(N&amp;W: standardmäßig aktiv)</em>
          : <em style={{ fontStyle: 'normal', color: '#5a5955', fontSize: 12 }}>(TalentOne: nur bei Sondervereinbarung)</em>}</span>
      </label>

      {v.garantie && istNw && (
        <label className="field field-full" style={{ marginTop: -6 }}>
          <span>Erfolgsgarantie-Frist</span>
          <select value={aktuelleFrist} onChange={e => setFrist(e.target.value)} style={{ flex: '0 0 220px' }}>
            {GARANTIE_FRISTEN.map(f => <option key={f} value={f}>{f}</option>)}
            <option value="Individuell">Individuell (Freitext)</option>
          </select>
        </label>
      )}

      {v.garantie && (
        <label className="field field-full" style={{ marginTop: -6 }}>
          <span>Garantie-Details</span>
          <input type="text"
            placeholder={garantieStandardText('30 Tage')}
            value={v.garantie_details || ''}
            onChange={e => set({ garantie_details: e.target.value })} />
        </label>
      )}
    </div>
  );
}
