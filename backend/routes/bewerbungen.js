// Bewerber-Management — Notizen, Kundenfeedback, eigene Spalten,
// globale Übersicht. Geschützt (requireAuth).

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { callClaudeWithRetry, parseJsonContent } from '../claude.js';
import { VORQUAL_STANDARD } from '../vorqualifizierung.js';
import { attachStableAnhaenge } from '../anhaenge.js';
import { personenGruppen } from '../dubletten.js';

const router = Router();

// Rang der abgeleiteten Bearbeitungsstufen (für Dubletten: die weiteste Stufe der Person gilt).
const BEARB_RANK = { neu: 0, in_bearbeitung: 1, kontaktversuch: 2, vorqualifiziert: 3, vorgestellt: 4, vg: 5, eingestellt: 6 };

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const NOTIZ_STATI = ['neu', 'kontaktiert', 'interessiert', 'abgesagt', 'weitergeleitet'];
const FEEDBACK_STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'abgesagt'];
const EINGESTELLT_VALUES = ['ja', 'nein', 'offen'];

const ANRUF_ERGEBNISSE = ['erreicht', 'nicht_erreicht', 'mailbox'];

function sanitizeAnrufversuche(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 10).map(a => ({
    datum: a?.datum || null,
    ergebnis: ANRUF_ERGEBNISSE.includes(a?.ergebnis) ? a.ergebnis : null,
    notiz: a?.notiz?.toString().slice(0, 500) || '',
  }));
}

/**
 * Lädt alle Rows einer Child-Tabelle, die zu einer Liste von bewerbung_ids gehören,
 * in gechunkten `.in()`-Queries. Grund: ein einzelner `.in('bewerbung_id', ids)` mit
 * mehreren hundert UUIDs übersteigt das PostgREST-URL-Längen-Limit — der Request wird
 * dann abgeschnitten oder liefert silent ein leeres Set zurück. Resultat vor dem Fix:
 * die globale Overview (/api/bewerbungen) baute `notizen = {}` obwohl 276 Rows in
 * talentone_bewerber_notizen stehen — alle Zeilen rendern Default-Werte (Status "Neu",
 * 0 Anrufversuche, leere Sterne, graue Ampel).
 *
 * Chunk-Größe 100 ist konservativ: 100 × (36-char UUID + ,) ≈ 3.7 KB, bleibt sicher
 * unter den typischen 8 KB URL-Caps von Nginx/Traefik.
 */
export async function fetchChildrenByBewerbungIds(table, ids, { chunkSize = 100, client = supabase } = {}) {
  if (!ids || ids.length === 0) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await client.from(table).select('*').in('bewerbung_id', chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data) out.push(...data);
  }
  return out;
}

/* ════════════════════ Notizen (intern) ════════════════════ */

// PATCH /api/bewerbungen/:id/notiz  body: { status?, bewertung?, erledigt?, nw_kontaktiert?, kunde_kontaktiert?, vg_vereinbart_am?, eingestellt?, vorqualifizierung_werte?, ... }
router.patch('/:id/notiz', async (req, res) => {
  const bewId = req.params.id;
  const patch = {};
  const body = req.body || {};
  if (body.status !== undefined) {
    patch.status = NOTIZ_STATI.includes(body.status) ? body.status : 'neu';
  }
  if (body.bewertung !== undefined) {
    const n = Number(body.bewertung);
    patch.bewertung = (Number.isInteger(n) && n >= 1 && n <= 5) ? n : null;
  }
  for (const k of ['gehaltswunsch', 'verfuegbarkeit', 'naechste_aktion', 'notizen',
                   'nw_kontaktiert', 'kunde_kontaktiert']) {
    if (body[k] !== undefined) patch[k] = (body[k]?.toString().trim()) || null;
  }
  if (body.erledigt !== undefined) patch.erledigt = !!body.erledigt;
  if (body.ampel !== undefined) {
    patch.ampel = ['gruen', 'gelb', 'rot'].includes(body.ampel) ? body.ampel : null;
  }
  if (body.vg_vereinbart_am !== undefined) {
    patch.vg_vereinbart_am = body.vg_vereinbart_am || null;
  }
  if (body.eingestellt !== undefined) {
    patch.eingestellt = EINGESTELLT_VALUES.includes(body.eingestellt) ? body.eingestellt : 'offen';
  }
  if (body.vorqualifizierung_werte !== undefined) {
    patch.vorqualifizierung_werte = (body.vorqualifizierung_werte && typeof body.vorqualifizierung_werte === 'object')
      ? body.vorqualifizierung_werte : {};
  }
  // A4: Abhak-Status je Kriterium {<kriterium_id>: true|false|null}
  if (body.kriterien_check !== undefined) {
    patch.kriterien_check = (body.kriterien_check && typeof body.kriterien_check === 'object' && !Array.isArray(body.kriterien_check))
      ? body.kriterien_check : {};
  }
  if (body.anrufversuche !== undefined) {
    patch.anrufversuche = sanitizeAnrufversuche(body.anrufversuche);
  }
  patch.updated_at = new Date().toISOString();
  patch.bewerbung_id = bewId;

  const { data, error } = await supabase
    .from('talentone_bewerber_notizen')
    .upsert(patch, { onConflict: 'bewerbung_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ notiz: data });

  // Best-effort: Vorqual-Daten in die Sheet-Zeile zurueckschreiben (nur wenn sich
  // Vorqual/Kontakt geaendert hat). Blockiert die Antwort nicht, wirft nie.
  if (body.vorqualifizierung_werte !== undefined || body.nw_kontaktiert !== undefined) {
    (async () => {
      try {
        const { data: bew } = await supabase.from('talentone_bewerbungen')
          .select('id, job_id, sheets_row_number, talentone_jobs!inner(kunde_id)')
          .eq('id', bewId).maybeSingle();
        if (!bew?.sheets_row_number) return;
        const { data: kunde } = await supabase.from('talentone_kunden')
          .select('id, firmenname, sheets_sync').eq('id', bew.talentone_jobs?.kunde_id).maybeSingle();
        const { updateVorqualInSheet } = await import('../sheets-sync.js');
        await updateVorqualInSheet({
          bewerbung: bew, kunde,
          vorqualWerte: data.vorqualifizierung_werte || {},
          nwKontaktiertAm: data.nw_kontaktiert || null,
        });
      } catch (err) { console.warn('[bewerbungen/notiz sheets-writeback]', err.message); }
    })();
  }
});

// PATCH /api/bewerbungen/:id/zuordnen  body: { job_id }
// Ordnet eine Bewerbung einer anderen Stelle DES SELBEN KUNDEN zu (Multi-Stellen-
// Funnel: Mapping danebengegriffen oder Kandidat umentschieden). Setzt zuordnung_unklar zurück.
// PATCH /api/bewerbungen/:id/feedback — intern den Kundenfeedback-Status setzen (z. B. KO → 'ungeeignet').
router.patch('/:id/feedback', async (req, res) => {
  const STATI = ['neu', 'interessant', 'vorstellungsgespraech', 'eingestellt', 'ungeeignet', 'absage', 'abgesagt'];
  const patch = { bewerbung_id: req.params.id, updated_at: new Date().toISOString() };
  if (req.body?.status !== undefined) patch.status = STATI.includes(req.body.status) ? req.body.status : 'neu';
  if (req.body?.vorstellungsgespraech_am !== undefined) patch.vorstellungsgespraech_am = req.body.vorstellungsgespraech_am || null;
  const { data, error } = await supabase.from('talentone_bewerber_kundenfeedback')
    .upsert(patch, { onConflict: 'bewerbung_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feedback: data });
});

// POST /api/bewerbungen/:id/kommentar — interner Kommentar (autor_typ 'nw') in den gemeinsamen Verlauf.
router.post('/:id/kommentar', async (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'Kommentar leer.' });
  const autorName = (req.body?.autor || '').toString().trim() || 'TalentOne';
  const { data, error } = await supabase.from('talentone_bewerber_kommentare')
    .insert({ bewerbung_id: req.params.id, autor_typ: 'nw', autor_name: autorName, text }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ kommentar: data });
});

router.patch('/:id/zuordnen', async (req, res) => {
  const zielJobId = req.body?.job_id;
  if (!zielJobId) return res.status(400).json({ error: 'job_id ist Pflicht.' });

  const { data: bew } = await supabase.from('talentone_bewerbungen')
    .select('id, job_id, talentone_jobs!inner(kunde_id)').eq('id', req.params.id).maybeSingle();
  if (!bew) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  const aktuellerKunde = bew.talentone_jobs?.kunde_id;

  const { data: zielJob } = await supabase.from('talentone_jobs')
    .select('id, kunde_id').eq('id', zielJobId).maybeSingle();
  if (!zielJob) return res.status(404).json({ error: 'Ziel-Stelle nicht gefunden.' });
  if (aktuellerKunde && zielJob.kunde_id !== aktuellerKunde) {
    return res.status(400).json({ error: 'Ziel-Stelle gehört zu einem anderen Kunden.' });
  }

  // Funnel-Referenz auf den Ziel-Job nachziehen (falls vorhanden).
  const { data: zielFunnel } = await supabase.from('talentone_funnels')
    .select('id').eq('job_id', zielJobId).order('created_at', { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await supabase.from('talentone_bewerbungen')
    .update({ job_id: zielJobId, funnel_id: zielFunnel?.id || null, zuordnung_unklar: false })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ bewerbung: data });
});

// POST /api/bewerbungen/:id/resend-kunde-mail — verschickt die Kunden-Benachrichtigung
// zu einer bestehenden Bewerbung erneut (kein Insert, kein Sheets-Sync). Für Sonderfälle,
// in denen die reguläre Mail nicht (oder nicht an alle) rausging.
router.post('/:id/resend-kunde-mail', async (req, res) => {
  try {
    const { sendeBewerbungsMailAnKunden } = await import('../exports.js');
    const result = await sendeBewerbungsMailAnKunden(req.params.id);
    if (result.skipped) {
      return res.status(422).json({ error: 'Kein gültiger Empfänger (weder Stellen- noch Kundenmail konfiguriert).', recipients: [] });
    }
    console.log(`[resend-kunde-mail] Bewerbung ${req.params.id} → ${result.recipients.join(', ')} (resend ${result.resendId || '-'})`);
    res.json({ ok: true, recipients: result.recipients, resendId: result.resendId });
  } catch (err) {
    console.error('[resend-kunde-mail]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════ Vorqualifizierungs-Felder (KI-Vorschlag) ════════════════════ */
// VORQUAL_STANDARD lebt jetzt in ../vorqualifizierung.js (geteilt mit jobs.js + Migration).

// POST /api/bewerbungen/job/:jobId/vorqualifizierung-vorschlaege
// Liefert (und speichert) eine Liste von Vorqualifizierungs-Feldern basierend auf Stelle + Branche.
router.post('/job/:jobId/vorqualifizierung-vorschlaege', async (req, res) => {
  try {
    const { data: job } = await supabase
      .from('talentone_jobs').select('*').eq('id', req.params.jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
    const { data: kunde } = await supabase
      .from('talentone_kunden').select('firmenname, branche').eq('id', job.kunde_id).maybeSingle();

    const { data: funnel } = await supabase
      .from('talentone_funnels').select('screens').eq('job_id', job.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const funnelFragen = [];
    for (const s of funnel?.screens || []) {
      if (s.type === 'question' && s.text) funnelFragen.push(s.text);
    }

    const prompt = `Du bist Recruiting-Experte. Schlage Vorqualifizierungs-Felder vor, die ein Telefonist beim Erstgespräch mit einem Bewerber abfragen sollte.

KONTEXT:
- Firma: ${kunde?.firmenname || '—'}
- Branche: ${kunde?.branche || '—'}
- Stelle: ${job.stelle || '—'}
- Region: ${job.region || '—'}
${funnelFragen.length ? `- Bereits im Funnel abgefragt:\n  · ${funnelFragen.join('\n  · ')}` : ''}

AUFGABE:
Schlage 2-5 BRANCHENSPEZIFISCHE Zusatzfelder vor (über die unten genannten Standard-Felder hinaus, die immer dabei sind). Beispiele je Branche:
- Handwerk/Bau: Führerschein (Dropdown Ja/Nein/Aktuell nicht), Reisebereitschaft
- Einzelhandel/Gastro: Deutsch-Level (Dropdown), Voll-/Teilzeit, Erfahrung Kundenumgang
- Technik/IT: Skills/Kenntnisse, Erfahrung in Jahren
- Pflege/Medizin: Schichtbereitschaft, Pflegegrad-Erfahrung

WICHTIG: Felder NICHT vorschlagen, die schon im Funnel oben abgefragt werden!

ANTWORT als reines JSON-Array:
[
  { "name": "Führerschein", "typ": "dropdown", "optionen": ["Ja", "Nein", "Aktuell nicht"] },
  { "name": "Reisebereitschaft", "typ": "text" }
]

typ ist eines von: "text", "dropdown", "datum". Bei "dropdown" zwingend "optionen": [].`;

    let branchenspezifisch = [];
    try {
      const claude = await callClaudeWithRetry({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });
      const parsed = parseJsonContent(claude);
      if (Array.isArray(parsed)) {
        branchenspezifisch = parsed
          .filter(f => f && typeof f === 'object' && f.name)
          .map(f => ({
            name: String(f.name).slice(0, 80),
            typ: ['text', 'dropdown', 'datum'].includes(f.typ) ? f.typ : 'text',
            optionen: f.typ === 'dropdown' && Array.isArray(f.optionen)
              ? f.optionen.map(o => String(o).slice(0, 80)).filter(Boolean).slice(0, 10)
              : undefined,
          }))
          .slice(0, 8);
      }
    } catch (err) {
      console.warn('[vorqual-ki]', err.message);
    }

    const felder = [...VORQUAL_STANDARD, ...branchenspezifisch];

    // Direkt am Job speichern
    await supabase.from('talentone_jobs')
      .update({ vorqualifizierung_felder: felder })
      .eq('id', job.id);

    res.json({ felder });
  } catch (err) {
    console.error('[vorqual-vorschlaege]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════ Eigene Spalten pro Job ════════════════════ */

// GET /api/bewerbungen/job/:jobId/spalten — nur intern-sichtbare
router.get('/job/:jobId/spalten', async (req, res) => {
  const { data, error } = await supabase
    .from('talentone_bewerber_spalten')
    .select('*')
    .eq('job_id', req.params.jobId)
    .eq('sichtbar_fuer', 'intern')
    .order('reihenfolge', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ spalten: data || [] });
});

// POST /api/bewerbungen/job/:jobId/spalten  body: { name, typ, optionen? }
router.post('/job/:jobId/spalten', async (req, res) => {
  const { name, typ = 'text', optionen = null } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name fehlt.' });
  if (!['text', 'dropdown', 'datum'].includes(typ)) return res.status(400).json({ error: 'typ ungültig.' });

  const { data: last } = await supabase
    .from('talentone_bewerber_spalten')
    .select('reihenfolge')
    .eq('job_id', req.params.jobId)
    .order('reihenfolge', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('talentone_bewerber_spalten')
    .insert({
      job_id: req.params.jobId,
      name: name.trim().slice(0, 80),
      typ,
      optionen: Array.isArray(optionen) ? optionen.map(o => String(o).slice(0, 80)).slice(0, 30) : null,
      reihenfolge: (last?.reihenfolge ?? -1) + 1,
      sichtbar_fuer: 'intern',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ spalte: data });
});

// DELETE /api/bewerbungen/spalten/:id
router.delete('/spalten/:id', async (req, res) => {
  const { error } = await supabase
    .from('talentone_bewerber_spalten').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PUT /api/bewerbungen/:bewId/spalten/:spalteId  body: { wert }
router.put('/:bewId/spalten/:spalteId', async (req, res) => {
  const wert = req.body?.wert == null ? null : String(req.body.wert);
  const { data, error } = await supabase
    .from('talentone_bewerber_spalten_werte')
    .upsert({
      bewerbung_id: req.params.bewId,
      spalte_id: req.params.spalteId,
      wert,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'bewerbung_id,spalte_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ wert: data });
});

/* ════════════════════ Listing für einen Job ════════════════════ */

// Funnel-Definitionen {funnel_id: fragen[]} der beteiligten Bewerbungen laden.
async function ladeFunnels(bewerbungen) {
  const funnelIds = [...new Set((bewerbungen || []).map(b => b.funnel_id).filter(Boolean))];
  const funnels = {};
  if (funnelIds.length) {
    const { data: fs } = await supabase.from('talentone_funnels').select('id, fragen').in('id', funnelIds);
    for (const f of (fs || [])) funnels[f.id] = f.fragen || [];
  }
  return funnels;
}

async function loadBewerbungenFuerJob(jobId) {
  const { data: bewerbungen, error } = await supabase
    .from('talentone_bewerbungen')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const ids = bewerbungen.map(b => b.id);
  if (ids.length === 0) {
    return { bewerbungen: [], notizen: {}, feedback: {}, werte: {} };
  }

  // Child-Tabellen gechunked laden, siehe `fetchChildrenByBewerbungIds` oben.
  // Ein einzelner Job hat selten >100 Bewerbungen — der Chunking-Overhead ist dann
  // null, aber die Code-Pfade bleiben identisch zur globalen Overview.
  const [notizenRows, feedbackRows, werteRows, kommentarRows] = await Promise.all([
    fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ids),
    fetchChildrenByBewerbungIds('talentone_bewerber_kundenfeedback', ids),
    fetchChildrenByBewerbungIds('talentone_bewerber_spalten_werte', ids),
    fetchChildrenByBewerbungIds('talentone_bewerber_kommentare', ids),
  ]);

  const notizen = {};
  for (const n of notizenRows) notizen[n.bewerbung_id] = n;
  const feedback = {};
  for (const f of feedbackRows) feedback[f.bewerbung_id] = f;
  const kommentare = {};
  for (const k of (kommentarRows || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) (kommentare[k.bewerbung_id] ||= []).push(k);
  const werte = {};
  for (const w of werteRows) {
    if (!werte[w.bewerbung_id]) werte[w.bewerbung_id] = {};
    werte[w.bewerbung_id][w.spalte_id] = w.wert;
  }

  // Anhänge als STABILE Download-Links ausliefern (kein Ablauf) — die frische
  // Signed URL entsteht erst beim Klick (intern via Login-Session).
  const bewerbungenMitAnhaengen = attachStableAnhaenge(bewerbungen);

  // Funnel-Definitionen (fragen + KO-Flags) der beteiligten Funnels — für die
  // KO-Markierung der Antworten im Frontend (per-Antwort-KO wird NICHT gespeichert).
  const funnels = await ladeFunnels(bewerbungen);

  return { bewerbungen: bewerbungenMitAnhaengen, notizen, feedback, werte, funnels, kommentare };
}

// Serverseitige Bearbeitungs-Ableitung (identisch zur Frontend-Kaskade in BewerberListe).
function deriveBearbeitung(n, feedbackStatus, hatKommentar) {
  n = n || {};
  const av = Array.isArray(n.anrufversuche) ? n.anrufversuche.filter(a => a && a.datum) : [];
  if (n.eingestellt && n.eingestellt !== 'offen') return 'eingestellt';
  if (n.vg_vereinbart_am || feedbackStatus === 'vorstellungsgespraech') return 'vg';
  if (n.kunde_kontaktiert || (feedbackStatus && feedbackStatus !== 'neu')) return 'vorgestellt';
  if (n.nw_kontaktiert || av.some(a => a.erreicht === true || a.ergebnis === 'erreicht')) return 'vorqualifiziert';
  if (av.length > 0) return 'kontaktversuch';
  const ch = n.kriterien_check || {};
  const hatCheck = Object.values(ch).some(v => v === true || v === false);
  if (n.ampel || (n.notizen && String(n.notizen).trim()) || hatCheck || hatKommentar) return 'in_bearbeitung';
  return 'neu';
}

// GET /api/bewerbungen/uebersicht — Kunden-/Stellen-Karten aus Bewerber-Sicht (live/pausiert).
// Bulk-Queries + In-Memory-Aggregation (kein N+1).
router.get('/uebersicht', async (req, res) => {
  const t0 = Date.now();
  try {
    const PAUSE = new Set(['feedbackschleife', 'hold', 'pausiert']);
    const [{ data: kunden = [] }, { data: projekte = [] }] = await Promise.all([
      supabase.from('talentone_kunden').select('id, firmenname, logo_url, agentur').eq('archiviert', false),
      supabase.from('talentone_projekte').select('id, kunde_id, status'),
    ]);
    const projStatus = Object.fromEntries((projekte || []).map(p => [p.id, p.status]));
    const { data: jobs = [] } = await supabase.from('talentone_jobs')
      .select('id, kunde_id, stelle, projekt_id, projekttyp');
    // Nur Recruiting-Stellen, deren Projekt live/pausiert ist.
    const stellen = (jobs || []).filter(j => j.projekttyp === 'mitarbeitergewinnung' && j.projekt_id
      && (projStatus[j.projekt_id] === 'live' || PAUSE.has(projStatus[j.projekt_id])));
    const jobIds = stellen.map(j => j.id);
    const aggByJob = {};
    for (const j of stellen) aggByJob[j.id] = { neu: 0, kontaktversuch: 0, in_bearbeitung: 0, vorqualifiziert: 0, vorgestellt: 0, vg: 0, eingestellt: 0, kommentare: 0, personen: 0, eingaenge: 0, kriterien_geaendert: false };

    if (jobIds.length) {
      const { data: bew = [] } = await supabase.from('talentone_bewerbungen').select('id, job_id, email, telefon, created_at').in('job_id', jobIds);
      const bewIds = bew.map(b => b.id);
      const bewJob = Object.fromEntries(bew.map(b => [b.id, b.job_id]));
      const [{ data: notizen = [] }, { data: fbs = [] }, { data: komm = [] }, { data: logs = [] }] = await Promise.all([
        bewIds.length ? supabase.from('talentone_bewerber_notizen').select('bewerbung_id, ampel, notizen, anrufversuche, vg_vereinbart_am, eingestellt, kunde_kontaktiert, nw_kontaktiert, kriterien_check, updated_at').in('bewerbung_id', bewIds) : Promise.resolve({ data: [] }),
        bewIds.length ? supabase.from('talentone_bewerber_kundenfeedback').select('bewerbung_id, status').in('bewerbung_id', bewIds) : Promise.resolve({ data: [] }),
        bewIds.length ? supabase.from('talentone_bewerber_kommentare').select('bewerbung_id, autor_typ, created_at').in('bewerbung_id', bewIds) : Promise.resolve({ data: [] }),
        supabase.from('talentone_kriterien_log').select('job_id, von, created_at').in('job_id', jobIds).eq('von', 'kunde'),
      ]);
      const notizByBew = Object.fromEntries((notizen || []).map(n => [n.bewerbung_id, n]));
      const fbByBew = Object.fromEntries((fbs || []).map(f => [f.bewerbung_id, f.status]));
      const kommByBew = {};
      for (const k of (komm || [])) (kommByBew[k.bewerbung_id] ||= []).push(k);
      // Letzte Kunden-Kriterienänderung je Job + letzter Recruiter-Check je Job.
      const letzteKundeLog = {}, letzterCheck = {};
      for (const l of (logs || [])) { if (!letzteKundeLog[l.job_id] || l.created_at > letzteKundeLog[l.job_id]) letzteKundeLog[l.job_id] = l.created_at; }

      // Pro Eingang: abgeleitete Stufe + offener Kundenkommentar (für die Personen-Aggregation).
      const bewMeta = {};
      for (const b of bew) {
        const jid = bewJob[b.id]; if (!aggByJob[jid]) continue;
        const n = notizByBew[b.id] || {};
        const ks = kommByBew[b.id] || [];
        const letzteKunde = ks.filter(k => k.autor_typ === 'kunde').reduce((m, k) => k.created_at > m ? k.created_at : m, '');
        const letzteNw = ks.filter(k => k.autor_typ === 'nw').reduce((m, k) => k.created_at > m ? k.created_at : m, '');
        const recruiterStand = [letzteNw, n.updated_at || ''].reduce((a, c) => c > a ? c : a, '');
        const offen = !!(letzteKunde && letzteKunde > recruiterStand);
        bewMeta[b.id] = { key: deriveBearbeitung(n, fbByBew[b.id] || null, ks.length > 0), offen };
        // letzter Check = jüngste Notiz-Bearbeitung mit gesetzten Kriterien-Haken
        const ch = n.kriterien_check || {};
        if (Object.values(ch).some(v => v === true || v === false) && n.updated_at && (!letzterCheck[jid] || n.updated_at > letzterCheck[jid])) letzterCheck[jid] = n.updated_at;
      }
      // Zähler = eindeutige Personen je Stelle: die weiteste Stufe der Person gilt,
      // ein offener Kundenkommentar zählt einmal pro Person.
      for (const gruppe of personenGruppen(bew)) {
        const jid = gruppe[0].job_id; const agg = aggByJob[jid]; if (!agg) continue;
        const metas = gruppe.map(r => bewMeta[r.id]).filter(Boolean);
        if (!metas.length) continue;
        const key = metas.reduce((best, m) => (BEARB_RANK[m.key] ?? -1) > (BEARB_RANK[best] ?? -1) ? m.key : best, 'neu');
        agg[key]++;
        agg.personen++;
        agg.eingaenge += gruppe.length;
        if (metas.some(m => m.offen)) agg.kommentare++;
      }
      for (const jid of jobIds) {
        if (letzteKundeLog[jid] && (!letzterCheck[jid] || letzteKundeLog[jid] > letzterCheck[jid])) aggByJob[jid].kriterien_geaendert = true;
      }
    }

    const kundeById = Object.fromEntries((kunden || []).map(k => [k.id, k]));
    const byKunde = {};
    for (const j of stellen) {
      const k = kundeById[j.kunde_id]; if (!k) continue;
      (byKunde[k.id] ||= { id: k.id, firmenname: k.firmenname, logo_url: k.logo_url, agentur: k.agentur, stellen: [] })
        .stellen.push({ job_id: j.id, stelle: j.stelle || 'Unbenannte Stelle', ...aggByJob[j.id] });
    }
    const out = Object.values(byKunde);
    console.log(`[bewerbungen/uebersicht] ${out.length} Kunden / ${stellen.length} Stellen in ${Date.now() - t0} ms`);
    res.json({ kunden: out });
  } catch (err) { console.error('[bewerbungen/uebersicht]', err.message); res.status(500).json({ error: err.message }); }
});

// GET /api/bewerbungen/job/:jobId — komplette Tabellen-Daten für einen Job
router.get('/job/:jobId', async (req, res) => {
  try {
    const data = await loadBewerbungenFuerJob(req.params.jobId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════ Globale Übersicht ════════════════════ */

// GET /api/bewerbungen — alle Bewerbungen mit Filter
router.get('/', async (req, res) => {
  const { kunde_id, job_id, quelle, ohne_ko, von, bis } = req.query;

  let q = supabase
    .from('talentone_bewerbungen')
    .select('*, talentone_jobs!inner(id, stelle, region, kunde_id, bewerbungen_token, vorqualifizierung, vorqualifizierung_felder, talentone_kunden!inner(id, firmenname, agentur))')
    .order('created_at', { ascending: false });

  if (job_id) q = q.eq('job_id', job_id);
  if (quelle) q = q.eq('quelle', quelle);
  if (ohne_ko === '1') q = q.eq('ko_kriterium', false);
  if (von) q = q.gte('created_at', von);
  if (bis) q = q.lte('created_at', bis);

  const { data: bewerbungen, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  let filtered = bewerbungen || [];
  if (kunde_id) {
    filtered = filtered.filter(b => b.talentone_jobs?.kunde_id === kunde_id);
  }

  const ids = filtered.map(b => b.id);
  let notizen = {};
  let feedback = {};
  if (ids.length > 0) {
    // Gechunkt (siehe `fetchChildrenByBewerbungIds`). Vor dem Fix lief die globale
    // Overview mit >400 UUIDs in einem einzelnen `.in()`-Call ins URL-Längen-Limit
    // und bekam ein leeres Set zurück → `notizen = {}` → alle Zeilen zeigten
    // Default-Werte (Status "Neu", 0 Anrufe, Sterne leer, Ampel grau) obwohl die
    // Daten in talentone_bewerber_notizen vollständig in der DB stehen.
    const [notizenRows, feedbackRows] = await Promise.all([
      fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ids),
      fetchChildrenByBewerbungIds('talentone_bewerber_kundenfeedback', ids),
    ]);
    for (const x of notizenRows) notizen[x.bewerbung_id] = x;
    for (const x of feedbackRows) feedback[x.bewerbung_id] = x;
  }

  // Stats berechnen (auf ungefilterte Basis-Liste basierend auf Datums-/KO-Filter,
  // nicht nach Kunde/Job — Stats sollen den Gesamt-Workflow zeigen).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());

  let neueHeute = 0, offen = 0, inBearbeitung = 0, weitergeleitetWoche = 0;
  for (const b of filtered) {
    const d = new Date(b.created_at);
    if (d >= today) neueHeute++;
    const n = notizen[b.id];
    const status = n?.status || 'neu';
    if (status === 'neu') offen++;
    else if (status === 'kontaktiert' || status === 'interessiert') inBearbeitung++;
    if (status === 'weitergeleitet' && new Date(n?.updated_at || b.created_at) >= weekStart) weitergeleitetWoche++;
  }

  const filteredMitAnhaengen = attachStableAnhaenge(filtered);
  const funnels = await ladeFunnels(filtered);
  res.json({
    bewerbungen: filteredMitAnhaengen,
    notizen,
    feedback,
    funnels,
    stats: { neueHeute, offen, inBearbeitung, weitergeleitetWoche },
  });
});

/* POST /api/bewerbungen/:id/als-einstellung
   Hire-Verzahnung: schreibt die Portal-Einstellung in die aktive Projekt-Phase
   (phase1/phase2_einstellungen — Freitext), die der Garantie-Wächter liest. So
   landen Portal-Hires und Garantie-Uhr in derselben Welt. Idempotent (kein
   Doppeleintrag desselben Namens). */
router.post('/:id/als-einstellung', async (req, res) => {
  const { data: bew } = await supabase.from('talentone_bewerbungen').select('id, name, job_id').eq('id', req.params.id).maybeSingle();
  if (!bew) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  const { data: job } = await supabase.from('talentone_jobs').select('id, stelle, projekt_id').eq('id', bew.job_id).maybeSingle();
  if (!job?.projekt_id) return res.status(409).json({ error: 'Der Job ist keinem Projekt zugeordnet — Einstellung kann nicht erfasst werden.' });
  const { data: projekt } = await supabase.from('talentone_projekte')
    .select('id, projekt, start_phase1, start_phase2, phase1_einstellungen, phase2_einstellungen').eq('id', job.projekt_id).maybeSingle();
  if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

  // Aktive Phase: Phase 2 wenn gestartet, sonst Phase 1.
  const phase = projekt.start_phase2 ? 'phase2' : 'phase1';
  const feld = `${phase}_einstellungen`;
  const bestehend = (projekt[feld] || '').trim();
  const name = (bew.name || 'Bewerber').trim();
  if (bestehend && bestehend.toLowerCase().includes(name.toLowerCase())) {
    return res.json({ ok: true, bereits_erfasst: true, projekt_id: projekt.id, phase, feld, wert: bestehend });
  }
  const heute = new Date().toISOString().slice(0, 10);
  const eintrag = `${name} — eingestellt via Portal (${heute})`;
  const wert = bestehend ? `${bestehend}\n${eintrag}` : eintrag;
  const { error } = await supabase.from('talentone_projekte')
    .update({ [feld]: wert, updated_at: new Date().toISOString() }).eq('id', projekt.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, projekt_id: projekt.id, projekt_name: projekt.projekt, phase, feld, wert });
});

export default router;
