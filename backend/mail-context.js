// Absender-Anreicherung für die „Wichtige Mails"-Kachel: matcht die Absender-
// Adresse gegen talentone_kunden bzw. talentone_bewerbungen und heftet CRM-Kontext an.
// Batched (wenige Mails je Load). Nur eindeutiger Treffer → Kontext; sonst null.

import { supabase } from './supabase.js';
import { ermittleNaechsteSchritte } from './naechste-schritte.js';

const low = s => (s || '').trim().toLowerCase();

export async function enrichMails(mails) {
  const emails = [...new Set(mails.map(m => low(m.fromEmail)).filter(Boolean))];
  if (!emails.length) return mails.map(m => ({ ...m, kontext: null }));

  // Kunden per E-Mail (case-insensitiv über Kandidatenliste).
  const { data: kundenAll } = await supabase.from('talentone_kunden')
    .select('id, firmenname, email, ansprechpartner, anrede_form, anrede_titel, nachname');
  const kundeByEmail = new Map();
  for (const k of kundenAll || []) if (k.email && emails.includes(low(k.email))) kundeByEmail.set(low(k.email), k);

  // Bewerbungen per E-Mail (jüngste je Adresse).
  const restEmails = emails.filter(e => !kundeByEmail.has(e));
  const bewByEmail = new Map();
  if (restEmails.length) {
    const { data: bews } = await supabase.from('talentone_bewerbungen')
      .select('id, name, email, job_id, created_at').in('email', restEmails)
      .order('created_at', { ascending: false });
    for (const b of bews || []) { const e = low(b.email); if (!bewByEmail.has(e)) bewByEmail.set(e, b); }
  }

  // Kunden-Vorgänge (letzte Schritte) gesammelt + offene Rechnungen.
  const kundeIds = [...new Set([...kundeByEmail.values()].map(k => k.id))];
  let schritte = {};
  try { schritte = await ermittleNaechsteSchritte(kundeIds); } catch { schritte = {}; }
  const projektStatus = new Map(); const offeneRg = new Map();
  if (kundeIds.length) {
    const { data: projekte } = await supabase.from('talentone_projekte')
      .select('kunde_id, status, created_at').in('kunde_id', kundeIds).order('created_at', { ascending: false });
    for (const p of projekte || []) if (!projektStatus.has(p.kunde_id)) projektStatus.set(p.kunde_id, p.status);
    const { data: rg } = await supabase.from('talentone_invoices')
      .select('kunde_id, status').in('kunde_id', kundeIds);
    for (const r of rg || []) if (['sent', 'overdue', 'partially_paid'].includes(r.status)) offeneRg.set(r.kunde_id, (offeneRg.get(r.kunde_id) || 0) + 1);
  }

  // Bewerber-Vorgänge (Telefonisten-Status + Job).
  const bewIds = [...new Set([...bewByEmail.values()].map(b => b.id))];
  const jobIds = [...new Set([...bewByEmail.values()].map(b => b.job_id).filter(Boolean))];
  const notizStatus = new Map(); const jobStelle = new Map();
  if (bewIds.length) {
    const { data: ns } = await supabase.from('talentone_bewerber_notizen').select('bewerbung_id, status').in('bewerbung_id', bewIds);
    for (const n of ns || []) notizStatus.set(n.bewerbung_id, n.status);
  }
  if (jobIds.length) {
    const { data: jobs } = await supabase.from('talentone_jobs').select('id, stelle').in('id', jobIds);
    for (const j of jobs || []) jobStelle.set(j.id, j.stelle);
  }

  return mails.map(m => {
    const e = low(m.fromEmail);
    const k = kundeByEmail.get(e);
    if (k) {
      const schrittLabel = (schritte[k.id] || [])[0]?.schritt?.label || null;
      return {
        ...m, kontext: {
          typ: 'kunde', kunde_id: k.id, firmenname: k.firmenname,
          projekt_status: projektStatus.get(k.id) || null,
          naechster_schritt: schrittLabel,
          offene_rechnungen: offeneRg.get(k.id) || 0,
          // Anrede-Rohfelder → die EINE Quelle anrede() im Route-Handler.
          anrede_fields: { anrede_form: k.anrede_form, anrede_titel: k.anrede_titel, nachname: k.nachname, ansprechpartner: k.ansprechpartner, firmenname: k.firmenname },
        },
      };
    }
    const b = bewByEmail.get(e);
    if (b) {
      return {
        ...m, kontext: {
          typ: 'bewerber', bewerbung_id: b.id, name: b.name,
          job_stelle: jobStelle.get(b.job_id) || null,
          telefonisten_status: notizStatus.get(b.id) || 'neu',
        },
      };
    }
    return { ...m, kontext: null };
  });
}

/** Baut ein Pseudo-kunde-Objekt aus den Kontext-Anredefeldern (für anrede()). */
export function kundeAusKontext(kontext) {
  if (kontext?.typ === 'kunde' && kontext.anrede_fields) return kontext.anrede_fields;
  return null;
}
