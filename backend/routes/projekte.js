// Projekte (Kanban / Liste) — CRUD + Kommentare
// Geschützt (requireAuth in server.js gemountet)

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { computeAutoChecklist, mergeChecklist } from '../projekt-sync.js';
import { TEAM_MEMBERS, findMemberByName } from '../team.js';
import { sendMentionMail } from '../mail.js';
import { addNote as closeAddNote } from '../close.js';

const router = Router();

const PROJEKTE_STATI = [
  'vorbereitung', 'kickoff_vereinbart', 'onboarding',
  'golive_vereinbart', 'warte_auf_go',
  'feedbackschleife',  // Kunde hat Änderungswünsche, wir überarbeiten
  'go',                // Kunde hat freigegeben, bereit zum Schalten
  'live',
  'pausiert', 'hold', 'abgeschlossen',
];

const ALLOWED_FIELDS = [
  'projektnummer', 'projekt', 'kunde', 'closer', 'projektart', 'projektdauer',
  'status', 'deadline_vorbereitung', 'gesuchte_positionen', 'standorte',
  'start_phase1', 'ende_phase1', 'phase1_einstellungen',
  'start_phase2', 'ende_phase2', 'phase2_einstellungen',
  'zufriedenheit', 'startdatum_abo', 'enddatum_abo', 'pausiert_seit',
  'ziel_erreicht', 're_bezahlt', 're2_bezahlt', 'bewertet',
  'notizen', 'pixel',
  'ready_for_upsell', 'upsell_wer', 'position_im_unternehmen', 'persoenlichkeitstyp',
  'email', 'verantwortlich', 'fotograf', 'letzter_kontakt', 'kontaktstatus',
  'werbekosten', 'close_lead_id', 'kunde_id', 'checkliste',
  'live_termin',
  // Neue Flags (Migration 025)
  'agentur', 'fotograf_noetig', 'zahlung_aufgeteilt', 'garantie', 'garantie_details',
  // Migration 027
  'kickoff_termin',
];

function pickFields(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!ALLOWED_FIELDS.includes(k)) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}

/* GET /api/projekte — Liste aller Projekte mit Kommentar-Count.
   Enrich: bei Cards mit offer_id werden campaign_started_at,
   guarantee_period_days, brand und billing_phase des Angebots
   mitgeliefert — Frontend zeigt sie live (kein Kopieren). */
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_projekte').select('*').order('created_at', { ascending: false });
  // Optionaler kunde_id-Filter — wird u. a. von der Kunden-Detailseite genutzt,
  // um den Projekt-Status im Header darzustellen.
  if (req.query.kunde_id) q = q.eq('kunde_id', req.query.kunde_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Kommentar-Zähler dazu joinen (einzelner aggregate-call)
  const { data: counts } = await supabase
    .from('talentone_kommentare')
    .select('projekt_id', { count: 'exact', head: false });
  const countMap = {};
  for (const c of counts || []) {
    countMap[c.projekt_id] = (countMap[c.projekt_id] || 0) + 1;
  }

  // Live-Anreicherung mit den Kampagnen-Daten aus talentone_offers — nur die
  // Cards mit offer_id abfragen (kein N+1: eine einzige IN-Query).
  const offerIds = [...new Set((data || []).map(p => p.offer_id).filter(Boolean))];
  const offerById = new Map();
  if (offerIds.length > 0) {
    const { data: offers } = await supabase
      .from('talentone_offers')
      .select('id, brand, campaign_started_at, guarantee_period_days, billing_ended_at, billing_paused_at, monthly_total, hires_target')
      .in('id', offerIds);
    for (const o of offers || []) offerById.set(o.id, o);
  }

  const enriched = (data || []).map(p => {
    const offer = p.offer_id ? offerById.get(p.offer_id) : null;
    return {
      ...p,
      kommentar_count: countMap[p.id] || 0,
      offer_snapshot: offer ? {
        brand:                offer.brand,
        campaign_started_at:  offer.campaign_started_at,
        guarantee_period_days: offer.guarantee_period_days,
        billing_ended_at:     offer.billing_ended_at,
        billing_paused_at:    offer.billing_paused_at,
        monthly_total:        offer.monthly_total,
        hires_target:         offer.hires_target,
      } : null,
    };
  });
  res.json({ projekte: enriched });
});

/* POST /api/projekte — neues Projekt */
router.post('/', async (req, res) => {
  const patch = pickFields(req.body);
  if (!patch.projekt && !patch.kunde) {
    return res.status(400).json({ error: 'Projektname oder Kunde ist Pflicht.' });
  }
  if (patch.status && !PROJEKTE_STATI.includes(patch.status)) {
    return res.status(400).json({ error: `Status muss eines von: ${PROJEKTE_STATI.join(', ')}` });
  }
  const { data, error } = await supabase
    .from('talentone_projekte')
    .insert({ ...patch, updated_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ projekt: data });
});

/* GET /api/projekte/team — Mitglieder-Liste für @-Mention-Autocomplete */
router.get('/team', (_req, res) => {
  res.json({ team: TEAM_MEMBERS });
});

/* GET /api/projekte/:id — single mit Auto-Sync der Checkliste */
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_projekte').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

  // Auto-Sync wenn mit Kunde verknüpft
  let autoKeys = [];
  if (data.kunde_id) {
    try {
      const auto = await computeAutoChecklist(data.kunde_id);
      const { checkliste, auto_set } = mergeChecklist(data.checkliste, auto);
      autoKeys = auto_set;
      data.checkliste = checkliste;
      data.auto_keys = autoKeys;
      // Auto-Updates persistieren (nur wenn sich was geändert hat)
      if (autoKeys.length) {
        await supabase.from('talentone_projekte')
          .update({ checkliste, updated_at: new Date().toISOString() }).eq('id', data.id);
      }
    } catch (err) { console.warn('[projekt-sync]', err.message); }
  }
  res.json({ projekt: data, auto_keys: autoKeys });
});

/* PATCH /api/projekte/:id — inline-Update */
router.patch('/:id', async (req, res) => {
  const patch = pickFields(req.body);
  if (patch.status && !PROJEKTE_STATI.includes(patch.status)) {
    return res.status(400).json({ error: `Status ungültig.` });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('talentone_projekte')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ projekt: data });
});

/* DELETE /api/projekte/:id — löscht auch alle zugehörigen Kommentare.
   Verknüpfte talentone_kunden bleiben unberührt. */
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  // Erst Kommentare entfernen damit kein orphaned data zurückbleibt
  const { error: kErr } = await supabase.from('talentone_kommentare').delete().eq('projekt_id', id);
  if (kErr) console.warn('[projekte/delete] Kommentare:', kErr.message);
  const { error } = await supabase.from('talentone_projekte').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /api/projekte/merge  body: { haupt_id, merged_ids: [] }
   Fasst N Projekte ins Hauptprojekt zusammen:
   - Alle Kommentare der merged_ids werden auf haupt_id umgehängt
   - Notizen werden konkateniert (mit Trennung)
   - Checkliste: erledigte Punkte aus beiden = erledigt (OR-Logik)
   - Die merged_ids werden anschließend gelöscht
   Verknüpfte talentone_kunden bleiben unberührt. */
router.post('/merge', async (req, res) => {
  const { haupt_id, merged_ids } = req.body || {};
  if (!haupt_id) return res.status(400).json({ error: 'haupt_id ist Pflicht.' });
  if (!Array.isArray(merged_ids) || merged_ids.length === 0) {
    return res.status(400).json({ error: 'merged_ids muss ein nicht-leeres Array sein.' });
  }
  const dups = merged_ids.filter(id => id === haupt_id);
  if (dups.length) return res.status(400).json({ error: 'haupt_id darf nicht in merged_ids stehen.' });

  try {
    // Hauptprojekt + alle zu mergenden Projekte laden
    const { data: haupt, error: hErr } = await supabase
      .from('talentone_projekte').select('*').eq('id', haupt_id).maybeSingle();
    if (hErr || !haupt) return res.status(404).json({ error: 'Hauptprojekt nicht gefunden.' });

    const { data: others = [], error: oErr } = await supabase
      .from('talentone_projekte').select('*').in('id', merged_ids);
    if (oErr) return res.status(500).json({ error: oErr.message });
    if (others.length === 0) return res.status(404).json({ error: 'Keine zu mergenden Projekte gefunden.' });

    // 1) Kommentare umhängen
    const { error: kErr } = await supabase
      .from('talentone_kommentare')
      .update({ projekt_id: haupt_id })
      .in('projekt_id', merged_ids);
    if (kErr) console.warn('[merge] Kommentare umhängen:', kErr.message);

    // 2) Notizen zusammenführen
    const allNotizen = [haupt.notizen, ...others.map(p => p.notizen)]
      .map(n => (n || '').trim())
      .filter(Boolean);
    const mergedNotizen = allNotizen.length > 1
      ? allNotizen.map((n, i) => i === 0 ? n : `\n\n──────── zusammengeführt ────────\n${n}`).join('')
      : (allNotizen[0] || null);

    // 3) Checkliste: OR-Logik (ein Punkt ist erledigt wenn er irgendwo erledigt war)
    const mergedChecklist = { ...(haupt.checkliste || {}) };
    for (const p of others) {
      for (const [k, v] of Object.entries(p.checkliste || {})) {
        if (v && !mergedChecklist[k]) mergedChecklist[k] = v;
      }
    }

    // 4) Verknüpfungs-Felder: vom ersten anderen Projekt übernehmen,
    //    falls das Hauptprojekt sie nicht hat. So überlebt z.B. kunde_id
    //    auch wenn ein Airtable-Import als Hauptprojekt gewählt wird.
    const mergedKundeId = haupt.kunde_id || others.find(p => p.kunde_id)?.kunde_id || null;
    const mergedCloseLeadId = haupt.close_lead_id || others.find(p => p.close_lead_id)?.close_lead_id || null;
    const mergedEmail = haupt.email || others.find(p => p.email)?.email || null;

    // 5) Hauptprojekt updaten
    const { data: updated, error: uErr } = await supabase
      .from('talentone_projekte')
      .update({
        notizen: mergedNotizen,
        checkliste: mergedChecklist,
        kunde_id: mergedKundeId,
        close_lead_id: mergedCloseLeadId,
        email: mergedEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('id', haupt_id).select().single();
    if (uErr) return res.status(500).json({ error: `Hauptprojekt-Update: ${uErr.message}` });

    // 6) Andere Projekte löschen
    const { error: dErr } = await supabase
      .from('talentone_projekte').delete().in('id', merged_ids);
    if (dErr) return res.status(500).json({ error: `Merge-Delete: ${dErr.message}` });

    console.log(`[projekte/merge] ${merged_ids.length} Projekt(e) in ${haupt_id.slice(0,8)} zusammengeführt.`);
    res.json({ ok: true, projekt: updated, merged_count: merged_ids.length });
  } catch (err) {
    console.error('[projekte/merge]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════ Kommentare ════════════════════ */

/* GET /api/projekte/:id/kommentare */
router.get('/:id/kommentare', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_kommentare')
    .select('*')
    .eq('projekt_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kommentare: data || [] });
});

/* POST /api/projekte/:id/kommentare  body: { text, erwaehnungen[], autor? } */
router.post('/:id/kommentare', async (req, res) => {
  const { text, erwaehnungen, autor } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Text fehlt.' });

  const { data: projekt } = await supabase
    .from('talentone_projekte').select('id, projekt, close_lead_id, kunde_id').eq('id', req.params.id).maybeSingle();
  if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

  const autorName = (autor || req.user?.email || 'Mitarbeiter').toString();
  const erw = Array.isArray(erwaehnungen) ? erwaehnungen.filter(Boolean).slice(0, 20) : [];

  const { data, error } = await supabase
    .from('talentone_kommentare')
    .insert({
      projekt_id: projekt.id,
      autor: autorName,
      text: text.trim(),
      erwaehnungen: erw,
      quelle: 'intern',
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ kommentar: data });

  // Kommentar an Close-Lead spiegeln (best-effort, nur neue intern verfasste
  // Kommentare — Airtable-Imports werden NICHT nachträglich synchronisiert).
  // Priorität: projekt.close_lead_id → Fallback auf kunde.close_lead_id
  // (die Lead ID ist laut Punkt 8 primär am Kunden hinterlegt).
  (async () => {
    try {
      let leadId = projekt.close_lead_id;
      if (!leadId && projekt.kunde_id) {
        const { data: kunde } = await supabase.from('talentone_kunden')
          .select('close_lead_id').eq('id', projekt.kunde_id).maybeSingle();
        leadId = kunde?.close_lead_id || null;
      }
      if (leadId) {
        const note = `Kommentar von ${autorName} aus Inside-Tool: ${text.trim()}`;
        await closeAddNote({ leadId, note });
      }
    } catch (err) { console.warn('[kommentar close-note]', err.message); }
  })();

  // @-Mention-E-Mail im Hintergrund (best-effort)
  if (erw.length > 0) {
    (async () => {
      try {
        for (const name of erw) {
          const member = findMemberByName(name);
          if (!member?.email) continue;
          await sendMentionMail({
            to: member.email,
            mentionedName: name,
            autor: autorName,
            projektName: projekt.projekt || 'Projekt',
            kommentar: text.trim(),
            projektUrl: `${process.env.PUBLIC_BASE_URL || 'https://inside.talent-one.de'}/projekte?id=${projekt.id}`,
          });
        }
      } catch (err) { console.warn('[mention-mail]', err.message); }
    })().catch(err => console.error('[mention-mail-uncaught]', err.message));
  }
});

/* PATCH /api/projekte/kommentare/:id */
router.patch('/kommentare/:id', async (req, res) => {
  const { text, erwaehnungen } = req.body || {};
  const patch = {};
  if (text !== undefined) patch.text = (text || '').trim();
  if (erwaehnungen !== undefined) patch.erwaehnungen = Array.isArray(erwaehnungen) ? erwaehnungen : [];
  const { data, error } = await supabase
    .from('talentone_kommentare').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kommentar: data });
});

/* DELETE /api/projekte/kommentare/:id */
router.delete('/kommentare/:id', async (req, res) => {
  const { error } = await supabase.from('talentone_kommentare').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /api/projekte/:id/duplicate — Projekt duplizieren.
   Kopiert Stammdaten (Kunde, Projektart, Positionen, Standorte, Projektdauer,
   Garantie, Zahlung aufgeteilt, Verantwortlich, Arbeitshinweise via job?)
   und laesst weg: Kommentare, Checkliste, Phasen/Termine, Bewerbungen,
   Status startet auf 'vorbereitung'. Name bekommt "(Kopie)"-Suffix. */
router.post('/:id/duplicate', async (req, res) => {
  const { data: src, error: sErr } = await supabase.from('talentone_projekte')
    .select('*').eq('id', req.params.id).maybeSingle();
  if (sErr) return res.status(500).json({ error: sErr.message });
  if (!src) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

  const KOPIERT = [
    // Stammdaten laut Anforderung
    'kunde', 'kunde_id', 'projektart', 'projektdauer',
    'gesuchte_positionen', 'standorte',
    'verantwortlich', 'closer', 'email', 'agentur',
    'fotograf', 'fotograf_noetig', 'zahlung_aufgeteilt',
    'garantie', 'garantie_details',
    'close_lead_id', 'pixel', 'notizen',
    'position_im_unternehmen', 'persoenlichkeitstyp',
  ];
  const neu = {
    projekt: `${src.projekt || 'Neues Projekt'} (Kopie)`,
    status: 'vorbereitung',
    checkliste: {},
    updated_at: new Date().toISOString(),
  };
  for (const k of KOPIERT) if (src[k] !== undefined && src[k] !== null) neu[k] = src[k];

  const { data: created, error: iErr } = await supabase.from('talentone_projekte')
    .insert(neu).select().single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  res.status(201).json({ projekt: created });
});

/* POST /api/projekte/backfill-missing
   Fuer alle Kunden mit Jobs aber ohne Projekt → ein Projekt anlegen.
   Nachzieh-Sync fuer Bestandsdaten aus der Zeit als Auto-Anlage nicht griff. */
router.post('/backfill-missing', async (req, res) => {
  try {
    // 1. Kunden mit Jobs finden
    const { data: kunden } = await supabase.from('talentone_kunden')
      .select('id, firmenname, email, agentur, close_lead_id, status');
    if (!kunden?.length) return res.json({ created: 0, checked: 0 });

    let created = 0;
    const results = [];
    for (const k of kunden) {
      // Hat der Kunde ein Projekt?
      const { count: pCount } = await supabase.from('talentone_projekte')
        .select('id', { count: 'exact', head: true }).eq('kunde_id', k.id);
      if (pCount && pCount > 0) continue;

      // Hat der Kunde einen Job?
      const { data: jobs } = await supabase.from('talentone_jobs')
        .select('id, stelle, region, projekttyp, eingabe_methode, formdata_komplett')
        .eq('kunde_id', k.id).order('created_at', { ascending: true });
      if (!jobs?.length) continue;

      // Primaeren Job auswaehlen — nicht-Platzhalter bevorzugt
      const primary = jobs.find(j =>
        !((j.formdata_komplett || {})._wartet_auf_briefing)) || jobs[0];
      const istNeu = primary.projekttyp === 'neukundengewinnung';
      const istPlatzhalter = !!(primary.formdata_komplett?._wartet_auf_briefing);
      const finalAgentur = k.agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';

      const row = {
        projekt: istPlatzhalter ? '[Wartet auf Briefing]' : (primary.stelle || k.firmenname || 'Neues Projekt'),
        kunde: k.firmenname || k.email,
        kunde_id: k.id,
        status: istPlatzhalter ? 'vorbereitung' : (k.status === 'aktiv' ? 'onboarding' : 'vorbereitung'),
        agentur: finalAgentur,
        projektart: istNeu ? 'Neukundengewinnung' :
                    (finalAgentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
        gesuchte_positionen: primary.stelle || null,
        standorte: primary.region || null,
        email: k.email || null,
        close_lead_id: k.close_lead_id || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('talentone_projekte').insert(row).select().single();
      if (error) {
        results.push({ kunde_id: k.id, firmenname: k.firmenname, error: error.message });
        continue;
      }
      created++;
      results.push({ kunde_id: k.id, firmenname: k.firmenname, projekt_id: data.id });
    }

    res.json({ created, checked: kunden.length, results });
  } catch (err) {
    console.error('[backfill-missing]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
