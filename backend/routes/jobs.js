import { Router } from 'express';
import { supabase } from '../supabase.js';
import { callClaudeWithRetry, parseJsonContent } from '../claude.js';
import { extractFromUrl, extractFromFile, toJob } from '../extractor.js';
import { sendUploadAnfrage, sendFormularEinladung } from '../mail.js';
import { notifyKunde } from '../close.js';
import { randomUUID } from 'node:crypto';
import { getPublicBaseUrl } from '../branding.js';

const router = Router();

// GET /api/jobs?kunde_id=...
router.get('/', async (req, res) => {
  let q = supabase.from('talentone_jobs').select('*').order('created_at', { ascending: false });
  if (req.query.kunde_id) q = q.eq('kunde_id', req.query.kunde_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jobs: data });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_jobs')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job nicht gefunden.' });
  res.json({ job: data });
});

/* POST /api/jobs/quick-create
   Erstellt einen Job für einen BESTEHENDEN Kunden via URL/PDF/Manual/Formular.
   body: { kunde_id, mode: 'url'|'file'|'manual'|'formular', url?|fileData+fileType?|job?, customText? } */
router.post('/quick-create', async (req, res) => {
  const {
    kunde_id, mode, customText, projekttyp,
    projektdauer, fotograf_noetig, zahlung_aufgeteilt, garantie, garantie_details,
    // Neu: Start-Status + Kick-Off-Termin
    projekt_status, kickoff_termin,
  } = req.body || {};
  if (!kunde_id) return res.status(400).json({ error: 'kunde_id ist Pflicht.' });
  const pt = projekttyp === 'neukundengewinnung' ? 'neukundengewinnung' : 'mitarbeitergewinnung';

  const { data: kunde, error: kErr } = await supabase
    .from('talentone_kunden').select('*').eq('id', kunde_id).maybeSingle();
  if (kErr || !kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  // Modus „formular" — Wartendes Projekt + Briefing-Anfrage-Mail
  if (mode === 'formular') {
    if (!kunde.email) return res.status(400).json({ error: 'Kunde hat keine E-Mail-Adresse.' });
    const { data: job, error: jErr } = await supabase
      .from('talentone_jobs')
      .insert({
        kunde_id,
        projekttyp: pt,
        stelle: pt === 'neukundengewinnung' ? '[Produkt-Briefing ausstehend]' : '[Briefing ausstehend]',
        eingabe_methode: 'neu',
        vorqualifizierung: pt === 'mitarbeitergewinnung' && kunde.agentur === 'nowagwirth',
        formdata_komplett: { _wartet_auf_briefing: true },
      })
      .select().single();
    if (jErr) return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });

    // Mail mit Briefing-Formular-Link versenden — Formular unter /formular/:token
    // (nicht /upload/:token — das ist nur der Datei-Upload). Braucht formular_token.
    let token = kunde.formular_token;
    if (!token) {
      token = randomUUID();
      await supabase.from('talentone_kunden').update({ formular_token: token }).eq('id', kunde_id);
    }
    const formularUrl = `${getPublicBaseUrl(kunde.agentur)}/formular/${token}`;

    try {
      await sendFormularEinladung({
        to: kunde.email,
        ansprechpartner: kunde.ansprechpartner,
        formularUrl,
        customText,
        agentur: kunde.agentur,
        projekttyp: pt,
      });
    } catch (err) {
      console.error('[jobs/quick-create/formular] Mail:', err.message);
      // Job bleibt — Team kann manuell nachfassen
    }
    notifyKunde(kunde, `📋 Onboarding-Formular an Kunden gesendet am ${new Date().toLocaleDateString('de-DE')}`)
      .catch(err => console.warn('[jobs/quick-create/formular close-note]', err.message));

    // Projekt in Kanban anlegen
    await supabase.from('talentone_projekte').insert({
      projekt: '[Wartet auf Briefing]',
      kunde: kunde.firmenname,
      kunde_id,
      agentur: kunde.agentur,
      status: projekt_status || 'vorbereitung',
      projektdauer: projektdauer || null,
      fotograf_noetig: kunde.agentur === 'nowagwirth' ? !!fotograf_noetig : false,
      zahlung_aufgeteilt: !!zahlung_aufgeteilt,
      garantie: !!garantie,
      garantie_details: garantie && garantie_details ? String(garantie_details).trim() : null,
      kickoff_termin: kickoff_termin || null,
    }).then(({ error }) => { if (error) console.error('[quick-create projekt-insert]', error.message); })
      .catch(err => console.error('[quick-create projekt-insert]', err.message));

    return res.status(201).json({ job, mode: 'formular', mailSent: true });
  }

  // URL / PDF / Manual — extrahiert oder direkt übernommene Job-Daten
  let jobData = {};
  try {
    if (mode === 'manual') {
      const { job = {} } = req.body;
      if (!job.stelle?.trim()) return res.status(400).json({ error: 'Stelle ist Pflicht.' });
      jobData = {
        stelle: job.stelle.trim(),
        region: job.region || null,
        gehalt: job.gehalt || null,
        eingabe_methode: 'neu',
      };
    } else if (mode === 'url') {
      const { url } = req.body;
      if (!url?.trim()) return res.status(400).json({ error: 'URL fehlt.' });
      const extracted = await extractFromUrl(url);
      jobData = toJob(extracted, 'url', url);
      if (!jobData.stelle) jobData.stelle = 'Unbenannte Stelle';
    } else if (mode === 'file') {
      const { fileData, fileType } = req.body;
      if (!fileData) return res.status(400).json({ error: 'Datei fehlt.' });
      const extracted = await extractFromFile(fileData, fileType);
      jobData = toJob(extracted, 'pdf');
      if (!jobData.stelle) jobData.stelle = 'Unbenannte Stelle';
    } else {
      return res.status(400).json({ error: 'Unbekannter Modus.' });
    }

    const { data: job, error: jErr } = await supabase
      .from('talentone_jobs')
      .insert({
        ...jobData,
        kunde_id,
        projekttyp: pt,
        vorqualifizierung: pt === 'mitarbeitergewinnung' && kunde.agentur === 'nowagwirth',
      })
      .select().single();
    if (jErr) return res.status(500).json({ error: `Job anlegen: ${jErr.message}` });

    // Projekt in Kanban
    await supabase.from('talentone_projekte').insert({
      projekt: job.stelle || 'Neues Projekt',
      kunde: kunde.firmenname,
      kunde_id,
      agentur: kunde.agentur,
      status: projekt_status || 'vorbereitung',
      projektart: pt === 'neukundengewinnung' ? 'Neukundengewinnung' :
                  (kunde.agentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
      gesuchte_positionen: job.stelle || null,
      standorte: job.region || null,
      projektdauer: projektdauer || null,
      fotograf_noetig: kunde.agentur === 'nowagwirth' ? !!fotograf_noetig : false,
      zahlung_aufgeteilt: !!zahlung_aufgeteilt,
      garantie: !!garantie,
      garantie_details: garantie && garantie_details ? String(garantie_details).trim() : null,
      kickoff_termin: kickoff_termin || null,
    }).then(({ error }) => { if (error) console.error('[quick-create projekt-insert]', error.message); })
      .catch(err => console.error('[quick-create projekt-insert]', err.message));

    res.status(201).json({ job });
  } catch (err) {
    console.error('[jobs/quick-create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { kunde_id } = req.body || {};
  if (!kunde_id) return res.status(400).json({ error: 'kunde_id ist Pflicht.' });

  // Default vorqualifizierung: true bei nowagwirth-Kunden, false bei talentone
  let defaultVorqual = false;
  if (req.body?.vorqualifizierung === undefined) {
    const { data: k } = await supabase
      .from('talentone_kunden').select('agentur').eq('id', kunde_id).maybeSingle();
    defaultVorqual = k?.agentur === 'nowagwirth';
  }

  const insertRow = {
    vorqualifizierung: defaultVorqual,
    ...req.body,
  };

  const { data, error } = await supabase
    .from('talentone_jobs')
    .insert(insertRow)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ job: data });
});

const ALLOWED_JOB_FIELDS = [
  'stelle', 'region', 'gehalt', 'benefits', 'besonderheiten',
  'reisebereitschaft', 'quereinsteiger', 'eingabe_methode', 'url',
  'formdata_komplett', 'analyse_ergebnis', 'bewerbung_email',
  'interne_spalten', 'vorqualifizierung', 'vorqualifizierung_felder',
  // Projekttyp „Neukundengewinnung" (Migration 021):
  'projekttyp', 'neukunden_daten',
  // Arbeitshinweise-Banner (Migration 023)
  'arbeitshinweise',
];

router.patch('/:id', async (req, res) => {
  const patch = Object.fromEntries(
    Object.entries(req.body || {}).filter(([k]) => ALLOWED_JOB_FIELDS.includes(k))
  );
  const { data, error } = await supabase
    .from('talentone_jobs')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ job: data });
});

router.delete('/:id', async (req, res) => {
  const jobId = req.params.id;
  const { data: job } = await supabase.from('talentone_jobs')
    .select('id, kunde_id, stelle').eq('id', jobId).maybeSingle();
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });

  // Storage-Dateien der Creatives einsammeln (best-effort — Löschen darf schiefgehen).
  try {
    const { deleteFromBucket } = await import('../storage.js');
    const { data: creatives } = await supabase.from('talentone_creatives')
      .select('image_url, video_url').eq('job_id', jobId);
    for (const c of creatives || []) {
      if (c.image_url) await deleteFromBucket('creatives', c.image_url).catch(() => {});
      if (c.video_url) await deleteFromBucket('creatives', c.video_url).catch(() => {});
    }
  } catch (e) { console.warn('[jobs/delete] storage cleanup failed:', e.message); }

  // Bewerbungen haben FK ON DELETE SET NULL — Kundenwunsch: mitlöschen.
  await supabase.from('talentone_bewerbungen').delete().eq('job_id', jobId);

  // Zugehöriges Projekt in talentone_projekte finden (Match kunde_id + Stelle) + löschen.
  if (job.kunde_id && job.stelle) {
    await supabase.from('talentone_projekte').delete()
      .eq('kunde_id', job.kunde_id).eq('projekt', job.stelle);
  }

  const { error } = await supabase.from('talentone_jobs').delete().eq('id', jobId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Felder, die per KI vorgeschlagen werden können — Schlüssel im formdata_komplett.
const SUGGESTIBLE_FIELDS = {
  unterschied:               'Was unterscheidet das Unternehmen von anderen Arbeitgebern? (2-3 Sätze, konkret, kein Marketing-Sprech)',
  mitarbeiter_gerne:         'Warum arbeiten Mitarbeiter gerne hier? (2-3 Sätze, was Mitarbeiter selbst sagen würden)',
  unternehmenskultur:        'Wie ist die Unternehmenskultur? (1-2 Sätze)',
  ausbildung:                'Welche Ausbildung / Qualifikation passt zur Stelle? (1 Satz, konkret)',
  kandidat_eigenschaften:    'Welche Eigenschaften sollte der ideale Kandidat mitbringen? (2-3 Stichpunkte als Fließtext)',
};

/* POST /api/jobs/:id/felder-vorschlaege  body: { felder?: string[] }
   Generiert plausible Texte für leere Felder basierend auf allen vorhandenen Job- und Kundeninfos. */
router.post('/:id/felder-vorschlaege', async (req, res) => {
  const requested = Array.isArray(req.body?.felder) ? req.body.felder.filter(k => SUGGESTIBLE_FIELDS[k]) : null;
  const targetKeys = requested?.length ? requested : Object.keys(SUGGESTIBLE_FIELDS);

  try {
    const { data: job, error: jE } = await supabase
      .from('talentone_jobs').select('*').eq('id', req.params.id).single();
    if (jE || !job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase
      .from('talentone_kunden').select('*').eq('id', job.kunde_id).single();

    const fd = job.formdata_komplett || {};
    const benefits = Array.isArray(job.benefits) ? job.benefits : [];

    const briefing = `BRIEFING:
Firma: ${kunde?.firmenname || '-'}
Branche: ${kunde?.branche || '-'}
Mitarbeiterzahl: ${fd.mitarbeiter_anzahl || '-'}
Website: ${kunde?.website_url || '-'}
Stelle: ${job.stelle || '-'}
Region: ${job.region || '-'}
Gehalt: ${job.gehalt || '-'}
Benefits: ${benefits.join(', ') || '-'}
Besonderheiten der Stelle: ${job.besonderheiten || '-'}
Bisherige Antworten:
- Unterschied: ${fd.unterschied || '(leer)'}
- Mitarbeiter-gerne-hier: ${fd.mitarbeiter_gerne || '(leer)'}
- Kultur: ${fd.unternehmenskultur || '(leer)'}
- Ausbildung: ${fd.ausbildung || '(leer)'}
- Kandidat-Eigenschaften: ${fd.kandidat_eigenschaften || '(leer)'}
- Soft Skills: ${(Array.isArray(fd.soft_skills) ? fd.soft_skills.join(', ') : '') || '-'}`;

    const feldBeschreibung = targetKeys
      .map(k => `- "${k}": ${SUGGESTIBLE_FIELDS[k]}`)
      .join('\n');

    const prompt = `Du füllst leere Briefing-Felder für eine Recruiting-Kampagne plausibel vor. Sprache: Deutsch, Du-Ansprache wo passend, locker, KEIN HR-Sprech.

${briefing}

Generiere konkrete Vorschläge für folgende Felder (nur die, die hier gelistet sind):
${feldBeschreibung}

Wichtig:
- Nutze die vorhandenen Briefing-Infos (Branche, Benefits, Besonderheiten…) als Basis
- Plausibel und konkret, kein Stock-Sprech
- Wenn bestehende "bisherige Antworten" hilfreich sind, baue darauf auf, statt zu widersprechen

Antworte NUR mit JSON, keine Markdown-Backticks:
{ ${targetKeys.map(k => `"${k}": "<Vorschlag>"`).join(', ')} }`;

    const data = await callClaudeWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseJsonContent(data);
    const vorschlaege = {};
    for (const k of targetKeys) {
      if (typeof parsed[k] === 'string' && parsed[k].trim()) {
        vorschlaege[k] = parsed[k].trim();
      }
    }
    res.json({ vorschlaege });
  } catch (err) {
    console.error('[felder-vorschlaege]', err.message);
    res.status(503).json({ error: err.message });
  }
});

/* POST /api/jobs/:id/create-projekt
   Idempotent: legt ein Projekt in talentone_projekte fuer den Job an,
   falls fuer den Kunden noch keins existiert. Uebertraegt vorhandene
   Job-Infos (Stelle, Region, Projekttyp) als Startwerte. */
router.post('/:id/create-projekt', async (req, res) => {
  const { data: job, error: jE } = await supabase.from('talentone_jobs')
    .select('id, kunde_id, stelle, region, projekttyp, formdata_komplett').eq('id', req.params.id).maybeSingle();
  if (jE) return res.status(500).json({ error: jE.message });
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });

  // Existiert schon eins fuer diesen Kunden? Dann bestehendes zurueckgeben.
  const { data: existing } = await supabase.from('talentone_projekte')
    .select('*').eq('kunde_id', job.kunde_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing) return res.status(200).json({ projekt: existing, already_existed: true });

  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, firmenname, email, agentur, close_lead_id').eq('id', job.kunde_id).maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

  const istNeu = job.projekttyp === 'neukundengewinnung';
  const istPlatzhalter = !!(job.formdata_komplett?._wartet_auf_briefing);
  const finalAgentur = kunde.agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';

  const { data: created, error: iErr } = await supabase.from('talentone_projekte').insert({
    projekt: istPlatzhalter ? '[Wartet auf Briefing]' : (job.stelle || kunde.firmenname || 'Neues Projekt'),
    kunde: kunde.firmenname || kunde.email,
    kunde_id: kunde.id,
    status: 'vorbereitung',
    agentur: finalAgentur,
    projektart: istNeu ? 'Neukundengewinnung' :
                (finalAgentur === 'talentone' ? 'TalentOne - Mitarbeitergewinnung' : 'Mitarbeitergewinnung'),
    gesuchte_positionen: job.stelle || null,
    standorte: job.region || null,
    email: kunde.email || null,
    close_lead_id: kunde.close_lead_id || null,
    updated_at: new Date().toISOString(),
  }).select().single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  res.status(201).json({ projekt: created, already_existed: false });
});

export default router;
