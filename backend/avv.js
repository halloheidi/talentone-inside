// AVV (Auftragsverarbeitungsvertrag) — zentrale Logik: aktuelle Version je Agentur,
// Annahme-Status je Kunde, Annahme protokollieren (+ Bestätigungsmail, Checkliste,
// Close-Note). Wird von Formular-Submit, Portal, Public-Token-Seite und Kunden-Ansicht genutzt.

import { supabase } from './supabase.js';
import { sendAvvBestaetigung } from './mail.js';
import { notifyKundeById } from './close.js';

function normAgentur(agentur) {
  return agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';
}

/** Aktuelle (neueste gültige) AVV-Version für eine Agentur. */
export async function getAktuelleVersion(agentur) {
  const { data } = await supabase
    .from('talentone_avv_versionen')
    .select('id, agentur, version, pdf_url, gueltig_ab')
    .eq('agentur', normAgentur(agentur))
    .order('gueltig_ab', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** Letzte Annahme eines Kunden (inkl. Version), oder null. */
export async function getAnnahme(kundeId) {
  const { data } = await supabase
    .from('talentone_avv_annahmen')
    .select('id, akzeptiert_von, akzeptiert_email, akzeptiert_am, avv_version_id, talentone_avv_versionen(version, pdf_url)')
    .eq('kunde_id', kundeId)
    .order('akzeptiert_am', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    akzeptiert_von: data.akzeptiert_von,
    akzeptiert_email: data.akzeptiert_email,
    akzeptiert_am: data.akzeptiert_am,
    version: data.talentone_avv_versionen?.version || null,
    pdf_url: data.talentone_avv_versionen?.pdf_url || null,
  };
}

/** Hat der Kunde schon (mindestens einmal) akzeptiert? */
export async function hatAnnahme(kundeId) {
  const { count } = await supabase
    .from('talentone_avv_annahmen')
    .select('id', { count: 'exact', head: true })
    .eq('kunde_id', kundeId);
  return (count || 0) > 0;
}

export function clientIpFrom(req) {
  return (req?.headers?.['x-forwarded-for'] || '').toString().split(',')[0].trim() || req?.ip || null;
}

/**
 * Protokolliert eine AVV-Annahme. Nachfolge-Aktionen (Bestätigungsmail, Checkliste,
 * Close-Note) laufen NUR beim ersten Akzept und best-effort (blocken nicht).
 * @returns {{ annahme, version, ersteAnnahme }}
 */
export async function protokolliereAnnahme({ kunde, akzeptiert_von, akzeptiert_email, req }) {
  if (!kunde?.id) throw new Error('kunde fehlt.');
  const version = await getAktuelleVersion(kunde.agentur);
  if (!version) throw new Error(`Keine AVV-Version für Agentur ${kunde.agentur}.`);

  const ersteAnnahme = !(await hatAnnahme(kunde.id));

  const { data: annahme, error } = await supabase
    .from('talentone_avv_annahmen')
    .insert({
      kunde_id: kunde.id,
      avv_version_id: version.id,
      akzeptiert_von: akzeptiert_von ? String(akzeptiert_von).trim().slice(0, 200) : null,
      akzeptiert_email: akzeptiert_email ? String(akzeptiert_email).trim().slice(0, 200) : null,
      ip_adresse: req ? clientIpFrom(req) : null,
      user_agent: req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null,
    })
    .select()
    .single();
  if (error) throw new Error(`AVV-Annahme speichern: ${error.message}`);

  if (ersteAnnahme) {
    // Onboarding-Checkliste: "avv_unterzeichnet" auf allen Projekten des Kunden abhaken.
    (async () => {
      try {
        const { data: projekte } = await supabase
          .from('talentone_projekte').select('id, checkliste').eq('kunde_id', kunde.id);
        for (const p of projekte || []) {
          await supabase.from('talentone_projekte')
            .update({ checkliste: { ...(p.checkliste || {}), avv_unterzeichnet: true } })
            .eq('id', p.id);
        }
      } catch (e) { console.warn('[avv] Checkliste:', e.message); }
    })();

    // Bestätigungsmail mit PDF-Anhang.
    const to = akzeptiert_email || kunde.email;
    if (to) {
      sendAvvBestaetigung({ to, kunde, version, akzeptiert_von, akzeptiert_am: annahme.akzeptiert_am })
        .catch(e => console.warn('[avv] Bestätigungsmail:', e.message));
    }

    // Close-Note.
    const dat = new Date(annahme.akzeptiert_am).toLocaleDateString('de-DE');
    notifyKundeById(kunde.id, `📄 AVV akzeptiert (Version ${version.version}) von ${akzeptiert_von || '—'} am ${dat}`, supabase)
      .catch(e => console.warn('[avv] Close-Note:', e.message));
  }

  return { annahme, version, ersteAnnahme };
}
