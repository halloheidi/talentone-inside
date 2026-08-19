// Einmaliger Nachversand der Kunden-Benachrichtigung für drei Bewerbungen, die
// vor dem Routing-Fix (Commit 10d327e) über den kunde_id-Pfad KEINE Kunden-Mail
// ausgelöst haben (damals ersetzte die interne Warn-Mail die Kunden-Mail).
//
// Verschickt AUSSCHLIESSLICH die Kunden-Benachrichtigung (sendeBewerbungsMailAnKunden):
// kein erneutes Insert, kein Sheets-Sync, keine sonstigen Downstream-Effekte. Das
// Original-Eingangsdatum wird dezent im Body eingeblendet (Transparenz).
//
// Nutzung (auf dem VPS):
//   docker compose exec inside-backend node scripts/nachversand-bewerbungsmails.mjs           # Dry-Run (nur Empfänger)
//   docker compose exec inside-backend node scripts/nachversand-bewerbungsmails.mjs --apply    # sendet

import { supabase } from '../supabase.js';
import { sendeBewerbungsMailAnKunden } from '../exports.js';

const IDS = [
  '7021ec32-aa95-4bf7-8e5b-614d491ec9fc', // DSL Schweisstechnik — Nikolas Ziegler (Servicetechniker)
  'aaaebdaa-a86a-47d4-9967-9968cf28d579', // AZMET GmbH — Mahmuut Jabhat (Pflasterer/Bauhelfer)
  '22fc57bc-bf6d-43e3-b97f-f7cc2c4a21f2', // AZMET GmbH — Haris Hamza (Pflasterer/Bauhelfer)
];
const APPLY = process.argv.includes('--apply') || process.env.APPLY === '1';

console.log(APPLY ? '=== NACHVERSAND (APPLY) ===\n' : '=== DRY-RUN (kein Versand) — mit --apply senden ===\n');

// 1) Empfänger vorab ausgeben (welche drei Adressen konkret).
console.log('Empfänger je Bewerbung:');
for (const id of IDS) {
  const { data: bew } = await supabase.from('talentone_bewerbungen')
    .select('id, name, job_id, created_at').eq('id', id).maybeSingle();
  if (!bew) { console.log(`  - ${id}: NICHT GEFUNDEN`); continue; }
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, stelle, kunde_id, bewerbung_email').eq('id', bew.job_id).maybeSingle();
  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('firmenname, email').eq('id', job?.kunde_id).maybeSingle();
  const empf = (job?.bewerbung_email?.trim() || kunde?.email?.trim() || '(kein Empfänger)');
  const quelle = job?.bewerbung_email?.trim() ? 'Stellen-Adresse' : 'Standard-Kundenmail';
  console.log(`  - ${bew.name} · ${kunde?.firmenname} · ${job?.stelle} → ${empf}  [${quelle}]`);
}

if (!APPLY) {
  console.log('\nDry-Run beendet. Zum Senden: node scripts/nachversand-bewerbungsmails.mjs --apply');
  process.exit(0);
}

// 2) Versand.
console.log('\n--- Versand ---');
const bestaetigungen = [];
for (const id of IDS) {
  try {
    const r = await sendeBewerbungsMailAnKunden(id); // eingegangenAm = Original-Eingang (Default)
    if (r.skipped) { console.log(`  ❌ ${id}: kein gültiger Empfänger — übersprungen`); continue; }
    const ts = new Date().toISOString();
    bestaetigungen.push({ name: r.bewerbung.name, kunde: r.kunde.firmenname, recipients: r.recipients, resendId: r.resendId, ts });
    console.log(`  ✅ ${r.bewerbung.name} (${r.kunde.firmenname}) → ${r.recipients.join(', ')} · resend-id ${r.resendId || '-'} · ${ts}`);
  } catch (e) {
    console.log(`  ❌ ${id}: ${e.message}`);
  }
}

console.log(`\n=== ${bestaetigungen.length}/${IDS.length} Versand-Bestätigungen ===`);
for (const b of bestaetigungen) {
  console.log(`  • ${b.name} — ${b.recipients.join(', ')} — ${b.ts}`);
}
process.exit(bestaetigungen.length === IDS.length ? 0 : 1);
