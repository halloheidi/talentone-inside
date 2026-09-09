// Einmaliges Auto-Matching: verknüpft bestehende talentone_jobs mit talentone_projekte
// (neue Spalte jobs.projekt_id). Regel: gleicher Kunde + eindeutiger Treffer.
//   - Kunde hat genau 1 Projekt  → eindeutig → verknüpfen.
//   - Kunde hat mehrere Projekte → Fuzzy-Match job.stelle vs. projekt.gesuchte_positionen/projekt;
//     nur wenn GENAU EIN Kandidat klar am besten passt (Score ≥ Schwelle und strikt vor dem Rest) → verknüpfen.
//   - sonst offen lassen (manuell im Dropdown).
// Nur Jobs OHNE projekt_id werden angefasst. Dry-Run default; --apply schreibt.
//
//   docker compose exec inside-backend node scripts/match-jobs-projekte.mjs          # Dry-Run
//   docker compose exec inside-backend node scripts/match-jobs-projekte.mjs --apply   # schreibt

import { supabase } from '../supabase.js';

const APPLY = process.argv.includes('--apply') || process.env.APPLY === '1';

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(\s*[mwdx](?:\s*\/\s*[mwdx])*\s*\)/g, ' ') // (m/w/d) etc.
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) { return new Set(norm(s).split(' ').filter(w => w.length >= 3)); }
function score(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const na = norm(a), nb = norm(b);
  const sub = (na && nb && (na.includes(nb) || nb.includes(na))) ? 0.5 : 0;
  return inter / Math.max(ta.size, tb.size) + sub; // 0..1.5
}

const SCHWELLE = 0.34; // mind. ~1/3 Token-Überlappung oder Substring
const VORSPRUNG = 0.15; // klarer Abstand zum zweitbesten

const { data: jobs } = await supabase.from('talentone_jobs')
  .select('id, kunde_id, stelle, projekt_id');
const { data: projekte } = await supabase.from('talentone_projekte')
  .select('id, kunde_id, projekt, gesuchte_positionen');

const projekteByKunde = {};
for (const p of projekte || []) (projekteByKunde[p.kunde_id] ||= []).push(p);

let gesamt = 0, schonVerknuepft = 0, keinKandidat = 0, einDeutig1 = 0, fuzzy = 0, offen = 0;
const updates = [];

for (const j of jobs || []) {
  gesamt++;
  if (j.projekt_id) { schonVerknuepft++; continue; }
  const kand = projekteByKunde[j.kunde_id] || [];
  if (kand.length === 0) { keinKandidat++; continue; }
  if (kand.length === 1) { updates.push([j.id, kand[0].id]); einDeutig1++; continue; }
  // Mehrere Kandidaten → Fuzzy
  const scored = kand.map(p => ({ p, s: Math.max(score(j.stelle, p.gesuchte_positionen), score(j.stelle, p.projekt)) }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0], zweit = scored[1];
  if (best.s >= SCHWELLE && (best.s - (zweit?.s || 0)) >= VORSPRUNG) {
    updates.push([j.id, best.p.id]); fuzzy++;
  } else { offen++; }
}

console.log(`${APPLY ? '=== APPLY ===' : '=== DRY-RUN ==='}`);
console.log(`Jobs gesamt: ${gesamt}`);
console.log(`  schon verknüpft: ${schonVerknuepft}`);
console.log(`  kein Projekt beim Kunden: ${keinKandidat}`);
console.log(`  → auto-verknüpfbar: ${updates.length} (eindeutig/1 Projekt: ${einDeutig1}, Fuzzy: ${fuzzy})`);
console.log(`  offen (mehrdeutig, manuell): ${offen}`);

if (APPLY && updates.length) {
  let ok = 0;
  for (const [jobId, projektId] of updates) {
    const { error } = await supabase.from('talentone_jobs').update({ projekt_id: projektId }).eq('id', jobId);
    if (error) console.warn(`  ! ${jobId}: ${error.message}`); else ok++;
  }
  console.log(`\nVerknüpft: ${ok}/${updates.length}`);
}
const nichtVerknuepft = gesamt - schonVerknuepft - updates.length; // kein Kandidat + offen
console.log(`\nQUOTE: ${updates.length} auto-verknüpft, ${offen} offen (mehrdeutig), ${keinKandidat} ohne Projekt, ${schonVerknuepft} bereits.`);
process.exit(0);
