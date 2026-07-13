// Wiederverwendbare Feldergruppe für die neuen Projekt-Flags (Migration 025):
// Fotograf (nur N&W), Projektdauer, Zahlung aufgeteilt, Garantie + Details.
// Benutzt in QuickCreateModal (manual-Tab) und NewProjectModal.

export const PROJEKTDAUER_OPTIONEN = [
  '', '30 Tage', '60 Tage', '90 Tage', '6 Monate', '12 Monate', 'Abo', 'Individuell',
];

export default function ProjektFlagsFields({ value, onChange, agentur }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const istNw = agentur === 'nowagwirth';
  const dauerCustom = !PROJEKTDAUER_OPTIONEN.includes(v.projektdauer || '') && v.projektdauer;

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
          onChange={e => set({ garantie: e.target.checked })} />
        <span>🛡️ Garantie zugesagt</span>
      </label>
      {v.garantie && (
        <label className="field field-full" style={{ marginTop: -6 }}>
          <span>Garantie-Details (optional)</span>
          <input type="text"
            placeholder='z. B. "Einstellungsgarantie 30 Tage"'
            value={v.garantie_details || ''}
            onChange={e => set({ garantie_details: e.target.value })} />
        </label>
      )}
    </div>
  );
}
