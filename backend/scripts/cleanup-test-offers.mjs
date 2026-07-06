// Räumt alle Test-Angebote (creator = 'verify-keep-script' / 'verify-script')
// aus talentone_offers + easybill wieder auf.

import { supabase } from '../supabase.js';

async function deleteEasybillDoc(id) {
  const res = await fetch(`https://api.easybill.de/rest/v1/documents/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${process.env.EASYBILL_API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`DELETE /documents/${id} → ${res.status}: ${body.slice(0, 200)}`);
  }
}

const { data: drafts, error } = await supabase
  .from('talentone_offers')
  .select('id, brand, easybill_document_id, created_by')
  .in('created_by', ['verify-keep-script', 'verify-script']);
if (error) { console.log('DB-Abfrage:', error.message); process.exit(1); }

console.log('Gefunden:', drafts.length, 'Testangebote');
for (const d of drafts) {
  if (d.easybill_document_id) {
    try {
      await deleteEasybillDoc(d.easybill_document_id);
      console.log('  ✓ easybill doc', d.easybill_document_id, '(' + d.brand + ') gelöscht');
    } catch (e) {
      console.log('  · easybill doc', d.easybill_document_id, 'fehlgeschlagen:', e.message);
    }
  }
  const { error: dbErr } = await supabase.from('talentone_offers').delete().eq('id', d.id);
  if (dbErr) console.log('  · DB-Draft', d.id, 'fehlgeschlagen:', dbErr.message);
  else console.log('  ✓ DB-Draft', d.id, 'gelöscht');
}
process.exit(0);
