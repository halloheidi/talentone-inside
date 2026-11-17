// Reel-Modul (R1): Skript & Motive (Schritt 1) + Motiv-Bilder (Schritt 2) + Kosten-Log.
// Video (Schritt 3) folgt in R2. Siehe docs/reel-modul-spec.md.
// Testphase: alle Endpunkte nur für Admins (wie die bestehende Reel-Ableitung).

import express from 'express';
import { supabase } from '../supabase.js';
import { isAdminEmail } from '../team.js';
import { freigegebeneStimmenText } from '../freigegebene-stimmen.js';
import { generateSkript, reformulateSatz } from '../reel-skript.js';
import { generateMotivBild } from '../reel-bilder.js';
import { uploadBuffer } from '../storage.js';
import { STORAGE_BUCKET } from '../imagegen.js';
import {
  STILE, ANREDEN, REEL_STATI, STIMME_PRO_ANREDE,
  SETTING_CREDIT_WARNSCHWELLE, CREDIT_WARNSCHWELLE_DEFAULT,
} from '../reel-config.js';

const router = express.Router();

// Grobe Kostenschätzung pro gpt-image-2-Bild (high, 1024×1536).
const BILD_USD = 0.19;

// Testphasen-Gate.
router.use((req, res, next) => {
  if (!isAdminEmail(req.user?.email)) {
    return res.status(403).json({ error: 'Das Reel-Modul ist in der Testphase nur für Admins.' });
  }
  next();
});

/* ───────────────────────── Helfer ───────────────────────── */

async function ladeReel(id) {
  const { data, error } = await supabase.from('talentone_reels').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function touch(id, fields) {
  const { data, error } = await supabase
    .from('talentone_reels')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function ladeKunde(id) {
  const { data } = await supabase.from('talentone_kunden').select('*').eq('id', id).maybeSingle();
  return data;
}

async function refbildUrl(id) {
  if (!id) return null;
  const { data } = await supabase.from('talentone_referenzbilder').select('bild_url, kunde_freigabe').eq('id', id).maybeSingle();
  return data || null;
}

async function logKosten(reelId, { schritt, anbieter, menge, credits = null, usd = null, request_id = null }) {
  try {
    await supabase.from('talentone_reel_kosten_log').insert({ reel_id: reelId, schritt, anbieter, menge, credits, usd, request_id });
  } catch (e) {
    console.warn('[reel-kosten] log fehlgeschlagen:', e.message);
  }
}

// Summiert die bisher protokollierten Kosten eines Reels zu reel.kosten.
async function summiereKosten(reelId) {
  const { data } = await supabase.from('talentone_reel_kosten_log').select('anbieter, credits, usd').eq('reel_id', reelId);
  const rows = data || [];
  const openai_usd = rows.filter((r) => r.anbieter === 'openai').reduce((a, r) => a + (Number(r.usd) || 0), 0);
  const higgsfield_credits = rows.filter((r) => r.anbieter === 'higgsfield').reduce((a, r) => a + (Number(r.credits) || 0), 0);
  const elevenlabs_credits = rows.filter((r) => r.anbieter === 'elevenlabs').reduce((a, r) => a + (Number(r.credits) || 0), 0);
  return { openai_usd: Math.round(openai_usd * 100) / 100, higgsfield_credits, elevenlabs_credits };
}

// Prüft die Einwilligung vor KI-Bild-Erzeugung (wie Creatives V2).
//  - echtes Personenfoto → kunde_freigabe!='nein' & ki_verarbeitung_erlaubt!=false
//  - erfundene KI-Person   → Erstnutzung je Kunde bestätigen (ki_personen_informiert_am)
async function personGate({ kunde, personRefId, bestaetigt }) {
  if (kunde?.keine_ki_bilder) return { status: 403, body: { error: 'Für diesen Kunden sind KI-Bilder deaktiviert.' } };
  if (personRefId) {
    const { data: ref } = await supabase
      .from('talentone_referenzbilder')
      .select('kunde_freigabe, ki_verarbeitung_erlaubt, bild_url')
      .eq('id', personRefId).maybeSingle();
    if (!ref) return { status: 404, body: { error: 'Referenzfoto nicht gefunden.' } };
    if (ref.kunde_freigabe === 'nein') return { status: 403, body: { error: 'Dieses Foto ist vom Kunden gesperrt.' } };
    if (ref.ki_verarbeitung_erlaubt === false) return { status: 403, body: { error: 'Für dieses Foto hat der Kunde keine KI-Verarbeitung erlaubt. Wähle „Person erfinden" oder ein anderes Foto.' } };
    return { ok: true, personUrl: ref.bild_url };
  }
  if (!kunde?.ki_personen_informiert_am && !bestaetigt) {
    return { status: 409, body: { needs_confirm: true, error: 'Erstmals werden für diesen Kunden KI-Personen erfunden. Ist der Kunde darüber informiert?' } };
  }
  if (!kunde?.ki_personen_informiert_am && bestaetigt) {
    await supabase.from('talentone_kunden').update({ ki_personen_informiert_am: new Date().toISOString() }).eq('id', kunde.id);
  }
  return { ok: true, personUrl: null };
}

// Baut die Referenzliste (für die Bildgenerierung) aus den benötigten Referenzen des Motivs.
async function baueReferenzen({ motiv, reel, kunde, personUrlOverride }) {
  const referenzen = [];
  const benoetigt = motiv?.benoetigte_referenzen || [];
  const r = reel.referenzen || {};
  if (benoetigt.includes('logo')) {
    const logo = r.logo_url || kunde?.logo_url;
    if (logo) referenzen.push({ url: logo, rolle: 'logo' });
  }
  if (benoetigt.includes('person')) {
    const personUrl = personUrlOverride
      || (r.person ? (await refbildUrl(r.person))?.bild_url : null)
      || r.person_ki_url || null;
    if (personUrl) referenzen.push({ url: personUrl, rolle: 'person' });
  }
  if (benoetigt.includes('fahrzeug') && r.fahrzeug) {
    const f = await refbildUrl(r.fahrzeug);
    if (f?.bild_url) referenzen.push({ url: f.bild_url, rolle: 'fahrzeug' });
  }
  if (benoetigt.includes('gebaeude') && r.gebaeude) {
    const g = await refbildUrl(r.gebaeude);
    if (g?.bild_url) referenzen.push({ url: g.bild_url, rolle: 'gebaeude' });
  }
  return referenzen;
}

/* ───────────────────────── Anlegen & Lesen ───────────────────────── */

// POST /api/reel — neues Reel anlegen.
router.post('/', async (req, res) => {
  try {
    const { kunde_id, job_ids, stil = 'foto', anrede, gehalt_anzeigen = false } = req.body || {};
    if (!kunde_id) return res.status(400).json({ error: 'kunde_id fehlt.' });
    if (!Array.isArray(job_ids) || job_ids.length === 0) return res.status(400).json({ error: 'Mindestens eine Stelle auswählen.' });
    if (!STILE.includes(stil)) return res.status(400).json({ error: 'Unbekannter Stil.' });

    const kunde = await ladeKunde(kunde_id);
    if (!kunde) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const effAnrede = ANREDEN.includes(anrede) ? anrede : (ANREDEN.includes(kunde.anrede_form) ? kunde.anrede_form : 'du');

    const { data: jobs } = await supabase.from('talentone_jobs').select('id, stelle, projekt_id').in('id', job_ids);
    const projekt_id = jobs?.find((j) => j.projekt_id)?.projekt_id || null;

    const endkarte = {
      titel: jobs?.[0]?.stelle || '',
      untertitel: kunde.ort || kunde.stadt || '',
      button: 'Jetzt bewerben',
      farbe_hg: kunde.farbe_primaer || null,
      farbe_text: '#ffffff',
    };

    const { data, error } = await supabase.from('talentone_reels').insert({
      kunde_id,
      job_ids,
      projekt_id,
      stil,
      anrede: effAnrede,
      stimme: STIMME_PRO_ANREDE[effAnrede] || 'dylan',
      gehalt_anzeigen: !!gehalt_anzeigen,
      status: 'entwurf',
      referenzen: { person: null, person_ki_url: null, logo_url: kunde.logo_url || null, fahrzeug: null, gebaeude: null },
      endkarte,
      kosten: { openai_usd: 0, higgsfield_credits: 0, elevenlabs_credits: 0 },
      created_by: req.user?.email || null,
    }).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    res.status(201).json({ reel: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reel?job_id=…  oder  ?kunde_id=…
router.get('/', async (req, res) => {
  try {
    let q = supabase.from('talentone_reels').select('*').order('created_at', { ascending: false });
    if (req.query.job_id) q = q.contains('job_ids', [req.query.job_id]);
    else if (req.query.kunde_id) q = q.eq('kunde_id', req.query.kunde_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    res.json({ reels: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reel/:id — Detail inkl. minimaler Kunde-/Stellen-Infos.
router.get('/:id', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const kunde = await ladeKunde(reel.kunde_id);
    const { data: jobs } = await supabase.from('talentone_jobs').select('id, stelle').in('id', reel.job_ids || []);
    res.json({
      reel,
      kunde: kunde ? {
        id: kunde.id, firmenname: kunde.firmenname, logo_url: kunde.logo_url,
        anrede: kunde.anrede_form, keine_ki_bilder: !!kunde.keine_ki_bilder, ki_personen_informiert_am: kunde.ki_personen_informiert_am,
      } : null,
      jobs: jobs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── Schritt 1: Skript & Motive ───────────────────────── */

// POST /api/reel/:id/skript — Skript + Motive generieren.
router.post('/:id/skript', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const kunde = await ladeKunde(reel.kunde_id);
    const { data: jobs } = await supabase.from('talentone_jobs').select('*').in('id', reel.job_ids || []);
    const stimmenText = await freigegebeneStimmenText(reel.kunde_id);
    const hatPersonfoto = !!(reel.referenzen?.person);

    const { skript, motive, master_prompt } = await generateSkript({
      kunde, jobs: jobs || [], anrede: reel.anrede, stil: reel.stil,
      gehaltAnzeigen: !!reel.gehalt_anzeigen, stimmenText, hatPersonfoto,
    });

    // Bestehende Bild-/Freigabe-Zustände nicht verlieren, falls neu generiert wird:
    const alteMotive = reel.motive || [];
    const motiveMerged = motive.map((m) => {
      const alt = alteMotive.find((a) => a.nr === m.nr);
      return alt && alt.bild_url ? { ...m, bild_url: alt.bild_url, bild_quelle: alt.bild_quelle, freigegeben: false } : m;
    });

    const updated = await touch(reel.id, { skript, motive: motiveMerged, master_prompt, status: reel.status === 'entwurf' ? 'entwurf' : reel.status });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/:id/skript/satz/:nr — einen Satz neu formulieren.
router.post('/:id/skript/satz/:nr', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const nr = Number(req.params.nr);
    const skript = Array.isArray(reel.skript) ? [...reel.skript] : [];
    const idx = skript.findIndex((s) => s.nr === nr);
    if (idx < 0) return res.status(404).json({ error: 'Satz nicht gefunden.' });

    const kunde = await ladeKunde(reel.kunde_id);
    const { data: jobs } = await supabase.from('talentone_jobs').select('*').in('id', reel.job_ids || []);
    const neu = await reformulateSatz({
      kunde, jobs: jobs || [], anrede: reel.anrede, stil: reel.stil, gehaltAnzeigen: !!reel.gehalt_anzeigen,
      satz: skript[idx].text, position: nr, alleSaetze: skript,
    });
    skript[idx] = { ...skript[idx], text: neu.text, zeilen: neu.zeilen, schluesselwoerter: neu.schluesselwoerter };
    const updated = await touch(reel.id, { skript });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reel/:id — manuelle Edits (Text, Motive, Endkarte, Stimme, Gehalt-Haken).
router.patch('/:id', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const erlaubt = ['skript', 'motive', 'endkarte', 'stimme', 'gehalt_anzeigen', 'master_prompt'];
    const fields = {};
    for (const k of erlaubt) if (k in (req.body || {})) fields[k] = req.body[k];
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Keine änderbaren Felder übergeben.' });
    const updated = await touch(reel.id, fields);
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reel/:id/referenzen — Referenzbilder zuordnen (person/fahrzeug/gebaeude = refbild-id, logo_url = URL).
router.patch('/:id/referenzen', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const cur = reel.referenzen || {};
    const next = { ...cur };
    for (const k of ['person', 'fahrzeug', 'gebaeude', 'logo_url', 'person_ki_url']) {
      if (k in (req.body || {})) next[k] = req.body[k];
    }
    const updated = await touch(reel.id, { referenzen: next });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/:id/freigabe/skript — Skript freigeben → status skript_ok.
router.post('/:id/freigabe/skript', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    if (!Array.isArray(reel.skript) || reel.skript.length < 2) return res.status(400).json({ error: 'Erst ein Skript generieren.' });
    const updated = await touch(reel.id, { status: 'skript_ok' });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── Schritt 2: Bilder ───────────────────────── */

// POST /api/reel/:id/referenzperson — Motiv 0 (erfundene Referenzperson) erzeugen.
router.post('/:id/referenzperson', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const kunde = await ladeKunde(reel.kunde_id);
    const gate = await personGate({ kunde, personRefId: null, bestaetigt: !!req.body?.bestaetigt_informiert });
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const referenzen = [];
    const logo = reel.referenzen?.logo_url || kunde?.logo_url;
    if (logo) referenzen.push({ url: logo, rolle: 'logo' });

    const motiv = {
      titel: 'Referenzperson',
      prompt: 'Porträt-/Halbkörperaufnahme einer freundlichen, glaubwürdigen Person als Mitarbeiter des Betriebs in passender Arbeitskleidung, neutraler heller Hintergrund, Blick leicht zur Seite, natürliches Licht. Diese Person dient als Referenz für alle weiteren Bilder.',
      benoetigte_referenzen: logo ? ['logo'] : [],
    };
    const { url } = await generateMotivBild({ reelId: reel.id, motivNr: 0, masterPrompt: reel.master_prompt, motiv, stil: reel.stil, referenzen });
    await logKosten(reel.id, { schritt: 'bild', anbieter: 'openai', menge: 1, usd: BILD_USD });
    const kosten = { ...(reel.kosten || {}), ...(await summiereKosten(reel.id)) };
    const referenzenNeu = { ...(reel.referenzen || {}), person_ki_url: url };
    const updated = await touch(reel.id, { referenzen: referenzenNeu, kosten });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/:id/motive/:nr/bild — Motiv-Bild per KI erzeugen.
router.post('/:id/motive/:nr/bild', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const nr = Number(req.params.nr);
    const motive = Array.isArray(reel.motive) ? [...reel.motive] : [];
    const idx = motive.findIndex((m) => m.nr === nr);
    if (idx < 0) return res.status(404).json({ error: 'Motiv nicht gefunden.' });
    const motiv = motive[idx];
    const kunde = await ladeKunde(reel.kunde_id);

    let personUrlOverride;
    if ((motiv.benoetigte_referenzen || []).includes('person')) {
      const personRefId = reel.referenzen?.person || null;
      // Echtes Foto: Gate. Keine Person zugeordnet und keine KI-Referenzperson da → erst Motiv 0.
      if (!personRefId && !reel.referenzen?.person_ki_url) {
        return res.status(409).json({ needs_referenzperson: true, error: 'Für dieses Motiv fehlt die Person. Weise ein freigegebenes Foto zu oder erzeuge zuerst eine Referenzperson („Person erfinden").' });
      }
      const gate = await personGate({ kunde, personRefId, bestaetigt: !!req.body?.bestaetigt_informiert });
      if (!gate.ok) return res.status(gate.status).json(gate.body);
      personUrlOverride = gate.personUrl; // echtes Foto-URL oder null (dann greift person_ki_url)
    }

    const referenzen = await baueReferenzen({ motiv, reel, kunde, personUrlOverride });
    const { url } = await generateMotivBild({ reelId: reel.id, motivNr: nr, masterPrompt: reel.master_prompt, motiv, stil: reel.stil, referenzen });

    motive[idx] = { ...motiv, bild_url: url, bild_quelle: 'ki', freigegeben: false };
    await logKosten(reel.id, { schritt: 'bild', anbieter: 'openai', menge: 1, usd: BILD_USD });
    const kosten = { ...(reel.kosten || {}), ...(await summiereKosten(reel.id)) };
    const updated = await touch(reel.id, { motive, kosten });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/:id/motive/:nr/upload — eigenes Bild hochladen (base64).
router.post('/:id/motive/:nr/upload', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const nr = Number(req.params.nr);
    const motive = Array.isArray(reel.motive) ? [...reel.motive] : [];
    const idx = motive.findIndex((m) => m.nr === nr);
    if (idx < 0) return res.status(404).json({ error: 'Motiv nicht gefunden.' });

    const { data_base64, dateiname, content_type } = req.body || {};
    if (!data_base64) return res.status(400).json({ error: 'Kein Bild übergeben.' });
    const b64 = String(data_base64).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');
    const ext = (content_type && content_type.split('/')[1]) || (dateiname && dateiname.split('.').pop()) || 'png';
    const path = `reels/${reel.id}/upload-${nr}-${Date.now()}.${ext}`;
    const url = await uploadBuffer({ bucket: STORAGE_BUCKET, path, buffer, contentType: content_type || 'image/png' });

    motive[idx] = { ...motive[idx], bild_url: url, bild_quelle: 'upload', freigegeben: false };
    const updated = await touch(reel.id, { motive });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reel/:id/motive/:nr — Freigabe-Haken oder echtes Referenzfoto direkt verwenden.
router.patch('/:id/motive/:nr', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const nr = Number(req.params.nr);
    const motive = Array.isArray(reel.motive) ? [...reel.motive] : [];
    const idx = motive.findIndex((m) => m.nr === nr);
    if (idx < 0) return res.status(404).json({ error: 'Motiv nicht gefunden.' });
    let m = { ...motive[idx] };

    if (req.body?.bild_quelle === 'referenz' && req.body?.referenzbild_id) {
      const ref = await refbildUrl(req.body.referenzbild_id);
      if (!ref?.bild_url) return res.status(404).json({ error: 'Referenzfoto nicht gefunden.' });
      if (ref.kunde_freigabe === 'nein') return res.status(403).json({ error: 'Dieses Foto ist vom Kunden gesperrt.' });
      m.bild_url = ref.bild_url;
      m.bild_quelle = 'referenz';
      m.freigegeben = false;
    }
    if ('freigegeben' in (req.body || {})) m.freigegeben = !!req.body.freigegeben;

    motive[idx] = m;
    const updated = await touch(reel.id, { motive });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/:id/freigabe/bilder — alle Motive müssen ein Bild haben → status bilder_ok.
router.post('/:id/freigabe/bilder', async (req, res) => {
  try {
    const reel = await ladeReel(req.params.id);
    if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });
    const motive = Array.isArray(reel.motive) ? reel.motive : [];
    if (!motive.length) return res.status(400).json({ error: 'Noch keine Motive.' });
    const ohneBild = motive.filter((m) => !m.bild_url).map((m) => m.nr);
    if (ohneBild.length) return res.status(400).json({ error: `Noch ohne Bild: Motiv ${ohneBild.join(', ')}.` });
    const updated = await touch(reel.id, { status: 'bilder_ok' });
    res.json({ reel: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────── Kosten / Credits ───────────────────────── */

// GET /api/reel/credits — Guthaben (soweit bekannt) + Verbrauch diesen Monat + Warnschwelle.
router.get('/meta/credits', async (req, res) => {
  try {
    const monatsStart = new Date(); monatsStart.setDate(1); monatsStart.setHours(0, 0, 0, 0);
    const { data: rows } = await supabase
      .from('talentone_reel_kosten_log')
      .select('anbieter, credits, usd, created_at')
      .gte('created_at', monatsStart.toISOString());
    const liste = rows || [];
    const usd_monat = Math.round(liste.reduce((a, r) => a + (Number(r.usd) || 0), 0) * 100) / 100;
    const credits_monat = liste.reduce((a, r) => a + (Number(r.credits) || 0), 0);

    const { data: s } = await supabase.from('talentone_settings').select('wert').eq('schluessel', SETTING_CREDIT_WARNSCHWELLE).maybeSingle();
    const warnschwelle = s?.wert != null ? Number(s.wert) : CREDIT_WARNSCHWELLE_DEFAULT;

    res.json({
      usd_monat,
      credits_monat,
      warnschwelle,
      // Entwickler-API hat keinen Guthaben-Endpoint → Live-Guthaben erst in R2/separat.
      higgsfield_guthaben: null,
      hinweis: 'Higgsfield-Entwickler-API bietet keinen Guthaben-Endpoint; Live-Guthaben folgt in R2.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
