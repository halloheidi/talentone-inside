// Einmal-Bereinigung: entfernt eine führende LITERALE Begrüßung ("Hallo …",
// "Sehr geehrte …" usw.) aus den Kunden-Mail-Vorlagen (talentone_email_templates).
// Die Begrüßung setzt der Mail-Renderer zentral aus anrede_form — Vorlagen-Texte
// sollen keine eigene Grußzeile mehr enthalten. {{anrede}} bleibt erlaubt (das IST
// die zentrale Anrede) und wird NICHT entfernt.
//
//   node scripts/bereinige-email-vorlagen-anrede.mjs           # dry-run (nur auflisten)
//   node scripts/bereinige-email-vorlagen-anrede.mjs --apply   # schreiben

import { supabase } from '../supabase.js';

if (!supabase) { console.error('Supabase nicht konfiguriert (SUPABASE_URL / SERVICE_ROLE_KEY).'); process.exit(1); }

const LITERAL_GRUSS_RE = /^[^\S\r\n]*(hallo|hi|hey|moin|servus|liebe(?:r|s)?|guten\s+(?:tag|morgen|abend)|sehr\s+geehrte)\b[^\r\n]*(\r?\n)?/i;
function strip(text) {
  const s = String(text ?? '');
  if (!LITERAL_GRUSS_RE.test(s)) return text;
  return s.replace(LITERAL_GRUSS_RE, '').replace(/^\s+/, '');
}
const kurz = (s) => (s == null ? '∅' : `«${String(s).replace(/\n/g, '⏎').slice(0, 60)}…»`);

const apply = process.argv.includes('--apply');
const { data, error } = await supabase.from('talentone_email_templates')
  .select('key, agentur, body_du, body_sie').order('key');
if (error) { console.error(error.message); process.exit(1); }

const changes = [];
for (const row of data || []) {
  const nd = strip(row.body_du);
  const ns = strip(row.body_sie);
  if (nd !== row.body_du || ns !== row.body_sie) changes.push({ row, nd, ns });
}

if (!changes.length) {
  console.log('✓ Keine Vorlage beginnt mit einer literalen Begrüßung — nichts zu bereinigen.');
  process.exit(0);
}

for (const c of changes) {
  console.log(`\n[${c.row.key} · ${c.row.agentur}]`);
  if (c.nd !== c.row.body_du)  console.log(`  body_du:  ${kurz(c.row.body_du)} → ${kurz(c.nd)}`);
  if (c.ns !== c.row.body_sie) console.log(`  body_sie: ${kurz(c.row.body_sie)} → ${kurz(c.ns)}`);
  if (apply) {
    const { error: e } = await supabase.from('talentone_email_templates')
      .update({ body_du: c.nd, body_sie: c.ns, updated_at: new Date().toISOString() })
      .eq('key', c.row.key).eq('agentur', c.row.agentur);
    console.log(e ? `  ❌ FEHLER: ${e.message}` : '  ✓ geschrieben');
  }
}
console.log(`\n${changes.length} Vorlage(n) ${apply ? 'bereinigt.' : 'würden bereinigt (dry-run — mit --apply schreiben).'}`);
process.exit(0);
