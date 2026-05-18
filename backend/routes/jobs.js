import { Router } from 'express';
import { supabase } from '../supabase.js';
import { callClaudeWithRetry, parseJsonContent } from '../claude.js';

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

router.post('/', async (req, res) => {
  const { kunde_id } = req.body || {};
  if (!kunde_id) return res.status(400).json({ error: 'kunde_id ist Pflicht.' });
  const { data, error } = await supabase
    .from('talentone_jobs')
    .insert(req.body)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ job: data });
});

const ALLOWED_JOB_FIELDS = [
  'stelle', 'region', 'gehalt', 'benefits', 'besonderheiten',
  'reisebereitschaft', 'quereinsteiger', 'eingabe_methode', 'url',
  'formdata_komplett', 'analyse_ergebnis', 'bewerbung_email',
  'interne_spalten', 'vorqualifizierung',
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
  const { error } = await supabase.from('talentone_jobs').delete().eq('id', req.params.id);
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

export default router;
