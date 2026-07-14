// Einmaliges Script: fuer jede aktive Stilvorlage eine 1:1-Vorschau
// per gpt-image-2 generieren und als vorschau_url in der DB hinterlegen.
// Nutzt Fantasie-Firma "Muster Handwerk GmbH" mit neutralen Werten,
// damit der jeweilige Layout-Stil ehrlich sichtbar wird.
//
// Ausfuehrung im Backend-Container:
//   docker compose exec inside-backend node scripts/generate-stilvorlagen-previews.mjs

import { supabase } from '../supabase.js';
import { generateOneCreative } from '../imagegen.js';

const FAKE_JOB = {
  id: 'preview-' + Date.now(),   // fuer Storage-Path
  kunde_id: null,
  stelle: 'Monteur (m/w/d)',
  region: 'Musterstadt',
  gehalt: '3.500 - 4.500 EUR',
  benefits: ['Firmenwagen', 'Team-Events', '30 Tage Urlaub', 'Faire Bezahlung'],
  formdata_komplett: { anstellungsart: 'vollzeit' },
  projekttyp: 'mitarbeitergewinnung',
};
const FAKE_KUNDE = {
  id: null,
  firmenname: 'Muster Handwerk GmbH',
  branche: 'handwerk',
  agentur: 'talentone',
  farben: { primaer: '#d4ff00', sekundaer: '#0a0a0a', akzent: '#ff6633' },
  logo_url: null,
};
const MOTIV = 'Selbstbewusster Handwerker mittleren Alters in einer hellen Werkstatt, konzentriert bei der Arbeit an einem modernen Werkzeug. Freundliche natuerliche Beleuchtung, warme Farben.';

async function main() {
  const { data: vorlagen, error } = await supabase.from('talentone_stilvorlagen')
    .select('*').eq('aktiv', true).order('reihenfolge', { ascending: true });
  if (error) throw new Error(error.message);

  console.log(`[preview-gen] ${vorlagen.length} Vorlagen zu verarbeiten`);
  for (const v of vorlagen) {
    if (v.vorschau_url) {
      console.log(`[preview-gen] skip "${v.name}" — vorschau_url bereits gesetzt`);
      continue;
    }
    console.log(`[preview-gen] generiere Vorschau fuer "${v.name}" …`);
    try {
      const result = await generateOneCreative({
        job: FAKE_JOB, kunde: FAKE_KUNDE,
        motiv: MOTIV, format: 'quadrat', mode: 'ki',
        referenceImages: [],
        spruch: null,
        stilvorlage: v,
      });
      await supabase.from('talentone_stilvorlagen')
        .update({ vorschau_url: result.bildUrl, updated_at: new Date().toISOString() })
        .eq('id', v.id);
      console.log(`[preview-gen] ✓ "${v.name}" -> ${result.bildUrl}`);
    } catch (err) {
      console.error(`[preview-gen] FEHLER "${v.name}":`, err.message);
    }
  }
  console.log('[preview-gen] fertig.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
