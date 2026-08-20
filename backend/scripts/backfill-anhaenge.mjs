// Einmaliges Backfill: bestehende Bewerbungen nach Datei-Anhängen im raw-Payload
// durchsuchen (Onepage-Uploads u. Ä.), erkennen, in den privaten Bucket spiegeln
// und talentone_bewerbungen.anhaenge nachtragen.
//
// Non-fatal je Datei: ist die Original-URL tot, bleibt nur der Original-Link.
//
// Nutzung (auf dem VPS):
//   docker compose exec inside-backend node scripts/backfill-anhaenge.mjs           # Dry-Run (nur zählen)
//   docker compose exec inside-backend node scripts/backfill-anhaenge.mjs --apply    # spiegeln + speichern

import { supabase } from '../supabase.js';
import { extractAnhaenge, spiegeleAnhaenge } from '../anhaenge.js';

const APPLY = process.argv.includes('--apply') || process.env.APPLY === '1';
const PAGE = 1000;

console.log(APPLY ? '=== BACKFILL ANHÄNGE (APPLY) ===\n' : '=== BACKFILL ANHÄNGE (DRY-RUN) ===\n');

let offset = 0, geprueft = 0, mitDateien = 0, dateienGesamt = 0, gespiegeltSum = 0, totSum = 0, aktualisiert = 0;
const beispiele = [];

while (true) {
  const { data, error } = await supabase.from('talentone_bewerbungen')
    .select('id, raw, anhaenge, name')
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data?.length) break;

  for (const b of data) {
    geprueft++;
    const erkannt = extractAnhaenge(b.raw);
    if (!erkannt.length) continue;
    mitDateien++;
    dateienGesamt += erkannt.length;
    beispiele.push(`${b.id.slice(0, 8)} (${b.name || '—'}): ${erkannt.length} Datei(en) — ${erkannt.map(a => a.dateiname).join(', ')}`);
    if (!APPLY) continue;

    // Schon vorhandene (gespiegelte) Anhänge behalten; neue nach url_original mergen.
    const vorhanden = Array.isArray(b.anhaenge) ? b.anhaenge : [];
    const seen = new Set(vorhanden.map(a => a.url_original));
    const merged = [...vorhanden, ...erkannt.filter(a => !seen.has(a.url_original))];

    const { anhaenge: gespiegelteArr, gespiegelt: nOk, tot } = await spiegeleAnhaenge(b.id, merged);
    gespiegeltSum += nOk; totSum += tot;
    await supabase.from('talentone_bewerbungen').update({ anhaenge: gespiegelteArr }).eq('id', b.id);
    aktualisiert++;
  }

  if (data.length < PAGE) break;
  offset += PAGE;
}

console.log(`geprüft=${geprueft} · Bewerbungen-mit-Dateien=${mitDateien} · Dateien-gesamt=${dateienGesamt}`);
if (APPLY) console.log(`aktualisiert=${aktualisiert} · gespiegelt=${gespiegeltSum} · tot(nur Original-Link)=${totSum}`);
if (beispiele.length) {
  console.log('\nGefunden:');
  for (const x of beispiele.slice(0, 40)) console.log('  -', x);
  if (beispiele.length > 40) console.log(`  … +${beispiele.length - 40} weitere`);
}
if (!APPLY) console.log('\nDRY-RUN beendet. Zum Spiegeln+Speichern: --apply');
process.exit(0);
