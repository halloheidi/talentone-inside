// Meta-Integration Admin-Endpoints (Phase 1). Alles requireAdmin.
// Der System-User-Token wird NUR serverseitig gehalten und NIE zurückgegeben —
// die Status-Antwort liefert nur ein Flag + die letzten 4 Zeichen als Kontrolle.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getMetaToken, setMetaToken, getMetaSyncStatus, syncMetaKampagnen, braucheBackfill, ladeAdAccounts, matchKampagnen, adsetsNachladen, matchAdSets } from '../meta-sync.js';
import { aktuellePhaseInfo, laufphasenAktualisieren, berechnePhasen } from '../meta-laufphasen.js';
import { metaMetrikenFuerProjekt } from '../meta-metriken.js';

const router = Router();

const normKonto = (id) => { const s = String(id || '').trim(); return s ? (s.startsWith('act_') ? s : `act_${s}`) : null; };
const STATUS_LABEL = { 1: 'aktiv', 2: 'deaktiviert', 3: 'Zahlung ausstehend', 7: 'ausstehende Prüfung', 8: 'in Prüfung', 9: 'Gnadenfrist', 101: 'geschlossen' };

// Werbekonto-Namen je konto_id (für lesbare Kampagnen-Listen). act_-normalisiert.
async function kontoNamen() {
  const { data } = await supabase.from('talentone_meta_konten').select('konto_id, name');
  const m = {};
  for (const k of (data || [])) m[normKonto(k.konto_id)] = k.name || null;
  return m;
}
// Jüngster Aktiv-Tag + Phasenstart je Kampagne (aus den Laufphasen).
async function phasenMeta(campaignIds) {
  if (!campaignIds.length) return {};
  const { data } = await supabase.from('talentone_meta_laufphasen')
    .select('meta_campaign_id, phase_start, letzter_aktiv_tag').in('meta_campaign_id', campaignIds);
  const m = {};
  for (const p of (data || [])) {
    const e = m[p.meta_campaign_id] ||= { erster_start: p.phase_start, letzter_aktiv: p.letzter_aktiv_tag };
    if (p.phase_start < e.erster_start) e.erster_start = p.phase_start;
    if (!e.letzter_aktiv || (p.letzter_aktiv_tag && p.letzter_aktiv_tag > e.letzter_aktiv)) e.letzter_aktiv = p.letzter_aktiv_tag;
  }
  return m;
}

// GET /api/meta/status — Token gesetzt? + Sync-Status. Kein Token-Wert im Klartext.
router.get('/status', async (req, res) => {
  try {
    const token = await getMetaToken();
    res.json({
      token_gesetzt: !!token,
      token_hinweis: token ? `…${token.slice(-4)}` : null,
      token_quelle: token ? (process.env.META_SYSTEM_USER_TOKEN?.trim() === token ? 'env' : 'settings') : null,
      backfill_ausstehend: await braucheBackfill(),
      sync: getMetaSyncStatus(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/meta/token  body { token } — Token setzen/aktualisieren (getrimmt gespeichert).
router.put('/token', async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ error: 'token (nicht-leer) ist Pflicht.' });
  }
  try {
    const r = await setMetaToken(token, req.user?.email || null);
    res.json({ ok: true, ...r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/meta/token — Token entfernen (Settings-Tabelle leeren).
router.delete('/token', async (req, res) => {
  try {
    await setMetaToken(null, req.user?.email || null);
    res.json({ ok: true, gesetzt: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/meta/sync  body { backfill? } — „Jetzt aktualisieren". Ohne Token → skipped.
router.post('/sync', async (req, res) => {
  try {
    const token = await getMetaToken();
    if (!token) return res.status(409).json({ error: 'Kein Meta System User Token hinterlegt.', skipped: true });
    const backfill = req.body?.backfill === true || (await braucheBackfill());
    const result = await syncMetaKampagnen({ backfill });
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/meta/adaccounts — Konten aus Meta laden (/me/adaccounts). Zugleich Token-
// Live-Verifikation: bei Fehler Klartext-Meldung (nicht nur 500).
router.get('/adaccounts', async (req, res) => {
  try {
    const accounts = await ladeAdAccounts();
    res.json({ accounts });
  } catch (err) {
    const status = err.code === 'kein_token' ? 409 : 502;
    res.status(status).json({ error: err.message, code: err.code || 'graph_fehler' });
  }
});

// GET /api/meta/konten — gespeicherte Konto-Zuordnungen (Typ + Kunde).
router.get('/konten', async (req, res) => {
  const { data, error } = await supabase.from('talentone_meta_konten')
    .select('konto_id, name, typ, kunde_id, account_status, disable_reason, zahlungsproblem, zahlungsproblem_seit, status_gesynct, talentone_kunden(firmenname)');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ konten: (data || []).map(k => ({
    ...k,
    kunde_name: k.talentone_kunden?.firmenname || null,
    status_label: k.account_status != null ? (STATUS_LABEL[k.account_status] || `Status ${k.account_status}`) : null,
    talentone_kunden: undefined,
  })) });
});

// GET /api/meta/konten/zahlungsprobleme — Konten mit aktivem Zahlungsproblem (rotes Badge).
router.get('/konten/zahlungsprobleme', async (req, res) => {
  const { data, error } = await supabase.from('talentone_meta_konten')
    .select('konto_id, name, account_status, disable_reason, zahlungsproblem_seit, talentone_kunden(firmenname)')
    .eq('zahlungsproblem', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ konten: (data || []).map(k => ({
    ...k,
    kunde_name: k.talentone_kunden?.firmenname || null,
    status_label: k.account_status != null ? (STATUS_LABEL[k.account_status] || `Status ${k.account_status}`) : null,
    talentone_kunden: undefined,
  })) });
});

// PUT /api/meta/konten/:kontoId  body { name?, typ, kunde_id? } — Konto-Typ setzen.
// exklusiv → Kunde bekommt meta_werbekonto_id (Projekte erben); pool → keine Kunde-Zuordnung.
router.put('/konten/:kontoId', async (req, res) => {
  const kontoId = normKonto(req.params.kontoId);
  const { name, typ, kunde_id } = req.body || {};
  if (!['exklusiv', 'pool'].includes(typ)) return res.status(400).json({ error: "typ muss 'exklusiv' oder 'pool' sein." });
  if (typ === 'exklusiv' && !kunde_id) return res.status(400).json({ error: 'Exklusiv-Konto braucht einen Kunden.' });
  try {
    const kunde = typ === 'exklusiv' ? kunde_id : null;
    const { error } = await supabase.from('talentone_meta_konten').upsert({
      konto_id: kontoId, name: name || null, typ, kunde_id: kunde, updated_at: new Date().toISOString(),
    }, { onConflict: 'konto_id' });
    if (error) return res.status(500).json({ error: error.message });

    // Kunden-Ebene konsistent halten: dieses Konto von allen Kunden lösen, dann beim
    // Exklusiv-Kunden setzen. So „erben" dessen Projekte das Konto.
    await supabase.from('talentone_kunden').update({ meta_werbekonto_id: null }).eq('meta_werbekonto_id', kontoId);
    if (typ === 'exklusiv') {
      await supabase.from('talentone_kunden').update({ meta_werbekonto_id: kontoId }).eq('id', kunde);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/meta/konten/:kontoId — Konto-Zuordnung entfernen.
router.delete('/konten/:kontoId', async (req, res) => {
  const kontoId = normKonto(req.params.kontoId);
  try {
    await supabase.from('talentone_meta_konten').delete().eq('konto_id', kontoId);
    await supabase.from('talentone_kunden').update({ meta_werbekonto_id: null }).eq('meta_werbekonto_id', kontoId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/meta/kampagnen/nicht-zugeordnet — Kampagnen ohne Projekt-Zuordnung (nie still ignorieren).
router.get('/kampagnen/nicht-zugeordnet', async (req, res) => {
  const { data, error } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, name, werbekonto_id, effective_status, meta_start_time, gemischt, kunde_id, talentone_kunden(firmenname)')
    .is('projekt_id', null).order('name');
  if (error) return res.status(500).json({ error: error.message });
  const kn = await kontoNamen();
  const pm = await phasenMeta((data || []).map(k => k.meta_campaign_id));
  res.json({ kampagnen: (data || []).map(k => ({
    ...k,
    gemischt: !!k.gemischt,
    kunde_name: k.talentone_kunden?.firmenname || null,
    konto_name: kn[normKonto(k.werbekonto_id)] || null,
    start: pm[k.meta_campaign_id]?.erster_start || (k.meta_start_time ? k.meta_start_time.slice(0, 10) : null),
    letzter_aktiv: pm[k.meta_campaign_id]?.letzter_aktiv || null,
    talentone_kunden: undefined,
  })) });
});

// GET /api/meta/kampagnen/reaktivierungen — offene Reaktivierungs-Nachfragen (Badge + Bestätigung).
router.get('/kampagnen/reaktivierungen', async (req, res) => {
  const { data, error } = await supabase.from('talentone_meta_kampagnen')
    .select('meta_campaign_id, name, werbekonto_id, reaktivierung_am, reaktivierung_pause_tage, talentone_kunden(firmenname)')
    .eq('reaktivierung_offen', true).order('reaktivierung_am', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const kn = await kontoNamen();
  res.json({ kampagnen: (data || []).map(k => ({
    ...k,
    kunde_name: k.talentone_kunden?.firmenname || null,
    konto_name: kn[normKonto(k.werbekonto_id)] || null,
    talentone_kunden: undefined,
  })) });
});

// POST /api/meta/kampagnen/:id/reaktivierung/bestaetigen  body { modus: 'neue_phase' | 'zusammenhaengend' }
// neue_phase → Split bestätigen (Laufzeit zählt neu). zusammenhaengend → Phasen manuell mergen (Sonderfall).
router.post('/kampagnen/:metaCampaignId/reaktivierung/bestaetigen', async (req, res) => {
  const id = req.params.metaCampaignId;
  const modus = req.body?.modus;
  if (!['neue_phase', 'zusammenhaengend'].includes(modus)) {
    return res.status(400).json({ error: "modus muss 'neue_phase' oder 'zusammenhaengend' sein." });
  }
  try {
    const patch = { reaktivierung_offen: false, updated_at: new Date().toISOString() };
    if (modus === 'zusammenhaengend') patch.laufphasen_manuell = true;
    const { error } = await supabase.from('talentone_meta_kampagnen').update(patch).eq('meta_campaign_id', id);
    if (error) return res.status(500).json({ error: error.message });
    // Bei „zusammenhängend" die Phasen sofort neu (als eine) berechnen.
    if (modus === 'zusammenhaengend') await laufphasenAktualisieren(id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/meta/projekt/:projektId/kampagnen — zugeordnete Kampagnen mit Phasen-Infos.
// „aktuelle" = Kampagne mit laufender (bzw. jüngster) Phase; Rest als Historie.
router.get('/projekt/:projektId/kampagnen', async (req, res) => {
  try {
    const { data: kamps, error } = await supabase.from('talentone_meta_kampagnen')
      .select('meta_campaign_id, name, werbekonto_id, effective_status, reaktivierung_offen, laufphasen_manuell')
      .eq('projekt_id', req.params.projektId).order('name');
    if (error) return res.status(500).json({ error: error.message });
    if (!kamps?.length) return res.json({ kampagnen: [], aktuelle_id: null });

    // Zahlungsproblem-Datum je Werbekonto (für Pausen-Aufschlüsselung).
    const kn = await kontoNamen();
    const { data: konten } = await supabase.from('talentone_meta_konten').select('konto_id, zahlungsproblem_seit');
    const zSeit = {}; for (const k of (konten || [])) zSeit[normKonto(k.konto_id)] = k.zahlungsproblem_seit || null;

    const angereichert = [];
    for (const k of kamps) {
      const info = await aktuellePhaseInfo(k.meta_campaign_id, zSeit[normKonto(k.werbekonto_id)] || null);
      const { data: phasen } = await supabase.from('talentone_meta_laufphasen')
        .select('phase_start, phase_ende, aktive_lauftage, letzter_aktiv_tag, spend_summe, quelle')
        .eq('meta_campaign_id', k.meta_campaign_id).order('phase_start', { ascending: false });
      angereichert.push({
        ...k,
        konto_name: kn[normKonto(k.werbekonto_id)] || null,
        phase: info,                       // aktuelle Phase (aktive_lauftage, pause_tage, live …) oder null
        phasen: phasen || [],              // vollständige Historie
      });
    }
    // Aktuelle = live bevorzugt, sonst jüngster Aktiv-Tag.
    const rang = a => (a.phase?.live ? 2 : (a.phase ? 1 : 0));
    const sortiert = [...angereichert].sort((a, b) => rang(b) - rang(a)
      || String(b.phase?.letzter_aktiv_tag || '').localeCompare(String(a.phase?.letzter_aktiv_tag || '')));
    // Kompakte Kennzahlen (Budget-Auslastung, CPL, Spend) fürs Projekt-Slide-Over.
    let metrik = null;
    try { metrik = await metaMetrikenFuerProjekt(req.params.projektId); } catch (e) { console.warn('[meta] metrik:', e.message); }
    res.json({ kampagnen: angereichert, aktuelle_id: sortiert[0]?.meta_campaign_id || null, metrik });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/meta/kampagnen/:metaCampaignId/zuordnung  body { projekt_id | null } — manuell zuordnen.
router.put('/kampagnen/:metaCampaignId/zuordnung', async (req, res) => {
  const { projekt_id } = req.body || {};
  try {
    let job_id = null, kunde_id = null;
    if (projekt_id) {
      // Job + Kunde aus dem Projekt ableiten (Attribution projekt-basiert).
      const { data: pj } = await supabase.from('talentone_projekte').select('id, kunde_id').eq('id', projekt_id).maybeSingle();
      if (!pj) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
      kunde_id = pj.kunde_id;
      const { data: jb } = await supabase.from('talentone_jobs').select('id').eq('projekt_id', projekt_id)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      job_id = jb?.id || null;
    }
    const { error } = await supabase.from('talentone_meta_kampagnen')
      .update({ projekt_id: projekt_id || null, job_id, kunde_id, updated_at: new Date().toISOString() })
      .eq('meta_campaign_id', req.params.metaCampaignId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/meta/match — Kampagnen-Matching erneut laufen lassen (z. B. nach Konto-Typ-Änderung).
router.post('/match', async (req, res) => {
  try { res.json({ ok: true, result: await matchKampagnen() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════ Ad-Set-Ebene (gemischte Kampagnen) ═══════════════ */

// Ad-Set-Insights (datum, spend) laden + Laufphasen daraus berechnen.
async function adsetPhasenInfo(adsetId) {
  const { data } = await supabase.from('talentone_meta_adset_insights')
    .select('datum, spend').eq('meta_adset_id', adsetId).order('datum', { ascending: true });
  const tage = data || [];
  const aktivTage = tage.filter(t => Number(t.spend) > 0).map(t => t.datum);
  if (!aktivTage.length) return { phasen: [], cur: null };
  const phasen = berechnePhasen(aktivTage).map((p, i, arr) => ({
    phase_start: p.phase_start,
    phase_ende: i === arr.length - 1 ? null : p.letzter_aktiv_tag,
    aktive_lauftage: p.aktive_lauftage,
    letzter_aktiv_tag: p.letzter_aktiv_tag,
    spend_summe: tage.filter(t => t.datum >= p.phase_start && t.datum <= p.letzter_aktiv_tag).reduce((s, t) => s + (Number(t.spend) || 0), 0),
    quelle: 'auto',
  }));
  return { phasen, cur: phasen[phasen.length - 1] };
}

// PUT /api/meta/kampagnen/:metaCampaignId/gemischt  body { gemischt: bool }
// true → Kampagnen-Zuordnung wird durch Ad-Set-Zuordnung ersetzt (projekt_id geleert),
//        Ad Sets + Insights werden sofort nachgeladen. false → zurück zu Kampagnen-Zuordnung.
router.put('/kampagnen/:metaCampaignId/gemischt', async (req, res) => {
  const id = req.params.metaCampaignId;
  const gemischt = !!req.body?.gemischt;
  try {
    const patch = { gemischt, updated_at: new Date().toISOString() };
    if (gemischt) { patch.projekt_id = null; patch.job_id = null; } // Attribution ab jetzt pro Ad Set
    const { error } = await supabase.from('talentone_meta_kampagnen').update(patch).eq('meta_campaign_id', id);
    if (error) return res.status(500).json({ error: error.message });
    let nachgeladen = null;
    if (gemischt) { try { nachgeladen = await adsetsNachladen(id, { backfill: true }); } catch (e) { nachgeladen = { error: e.message }; } }
    res.json({ ok: true, gemischt, nachgeladen });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/meta/kampagnen/:metaCampaignId/adsets — Ad Sets einer Kampagne (mit Zuordnung + Phase).
router.get('/kampagnen/:metaCampaignId/adsets', async (req, res) => {
  try {
    const { data: adsets, error } = await supabase.from('talentone_meta_adsets')
      .select('meta_adset_id, name, effective_status, meta_start_time, werbekonto_id, projekt_id, talentone_projekte(projekt)')
      .eq('meta_campaign_id', req.params.metaCampaignId).order('name');
    if (error) return res.status(500).json({ error: error.message });
    const angereichert = [];
    for (const a of (adsets || [])) {
      const { cur } = await adsetPhasenInfo(a.meta_adset_id);
      angereichert.push({
        ...a,
        projekt_name: a.talentone_projekte?.projekt || null,
        start: cur?.phase_start || (a.meta_start_time ? a.meta_start_time.slice(0, 10) : null),
        letzter_aktiv: cur?.letzter_aktiv_tag || null,
        aktive_lauftage: cur?.aktive_lauftage || 0,
        talentone_projekte: undefined,
      });
    }
    res.json({ adsets: angereichert });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/meta/adsets/nicht-zugeordnet — offene Ad Sets gemischter Kampagnen (Projekt-Dropdown).
// meta_campaign_id ist kein FK → Kampagnen-Name separat gemappt (kein PostgREST-Embed).
router.get('/adsets/nicht-zugeordnet', async (req, res) => {
  try {
    const { data: gem } = await supabase.from('talentone_meta_kampagnen').select('meta_campaign_id, name').eq('gemischt', true);
    const gemIds = (gem || []).map(k => k.meta_campaign_id);
    if (!gemIds.length) return res.json({ adsets: [] });
    const campName = Object.fromEntries((gem || []).map(k => [k.meta_campaign_id, k.name]));
    const { data, error } = await supabase.from('talentone_meta_adsets')
      .select('meta_adset_id, name, meta_campaign_id, werbekonto_id, effective_status, meta_start_time, kunde_id, talentone_kunden(firmenname)')
      .is('projekt_id', null).in('meta_campaign_id', gemIds).order('name');
    if (error) return res.status(500).json({ error: error.message });
    const kn = await kontoNamen();
    res.json({ adsets: (data || []).map(a => ({
      meta_adset_id: a.meta_adset_id, name: a.name, meta_campaign_id: a.meta_campaign_id,
      werbekonto_id: a.werbekonto_id, effective_status: a.effective_status,
      kunde_name: a.talentone_kunden?.firmenname || null,
      kampagne_name: campName[a.meta_campaign_id] || null,
      konto_name: kn[normKonto(a.werbekonto_id)] || null,
      start: a.meta_start_time ? a.meta_start_time.slice(0, 10) : null,
    })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/meta/adsets/:metaAdsetId/zuordnung  body { projekt_id | null } — Ad Set einem Projekt zuordnen.
router.put('/adsets/:metaAdsetId/zuordnung', async (req, res) => {
  const { projekt_id } = req.body || {};
  try {
    let job_id = null, kunde_id = null;
    if (projekt_id) {
      const { data: pj } = await supabase.from('talentone_projekte').select('id, kunde_id').eq('id', projekt_id).maybeSingle();
      if (!pj) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
      kunde_id = pj.kunde_id;
      const { data: jb } = await supabase.from('talentone_jobs').select('id').eq('projekt_id', projekt_id)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      job_id = jb?.id || null;
    }
    const { error } = await supabase.from('talentone_meta_adsets')
      .update({ projekt_id: projekt_id || null, job_id, kunde_id, updated_at: new Date().toISOString() })
      .eq('meta_adset_id', req.params.metaAdsetId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════ Job-Meta-Tab: Zuordnungs-Übersicht + Timeline + Tageszahlen ═══════════════ */
function ymd(d) { return new Date(d).toISOString().slice(0, 10); }

// GET /api/meta/projekt/:projektId/tab — alles für den Meta-Tab der Job-Detailseite.
router.get('/projekt/:projektId/tab', async (req, res) => {
  const projektId = req.params.projektId;
  try {
    const { data: projekt } = await supabase.from('talentone_projekte')
      .select('id, projekt, kunde_id, meta_werbekonto_id, monatsbudget_euro, werbekosten, geplanter_livegang, garantie, garantie_details').eq('id', projektId).maybeSingle();
    if (!projekt) return res.status(404).json({ error: 'Projekt nicht gefunden.' });

    const [{ data: kamps }, { data: adsets }] = await Promise.all([
      supabase.from('talentone_meta_kampagnen').select('meta_campaign_id, name, werbekonto_id, effective_status, meta_start_time').eq('projekt_id', projektId).eq('gemischt', false),
      supabase.from('talentone_meta_adsets').select('meta_adset_id, name, werbekonto_id, effective_status, meta_start_time, meta_campaign_id').eq('projekt_id', projektId),
    ]);
    const campIds = (kamps || []).map(k => k.meta_campaign_id);
    const adsetIds = (adsets || []).map(a => a.meta_adset_id);
    const hatVerknuepfung = !!(projekt.meta_werbekonto_id || campIds.length || adsetIds.length);

    // Werbekonten (Name/Typ/Zahlungsproblem).
    const kontoIds = [...new Set([
      normKonto(projekt.meta_werbekonto_id),
      ...(kamps || []).map(k => normKonto(k.werbekonto_id)),
      ...(adsets || []).map(a => normKonto(a.werbekonto_id)),
    ].filter(Boolean))];
    const { data: konten } = kontoIds.length ? await supabase.from('talentone_meta_konten')
      .select('konto_id, name, typ, zahlungsproblem, account_status, status_gesynct').in('konto_id', kontoIds) : { data: [] };

    // Quellen (Kampagnen + Ad Sets) mit Phase-Infos.
    const quellen = [];
    for (const k of (kamps || [])) {
      const info = await aktuellePhaseInfo(k.meta_campaign_id);
      const { data: ph } = await supabase.from('talentone_meta_laufphasen')
        .select('phase_start, phase_ende, aktive_lauftage, letzter_aktiv_tag, spend_summe, quelle')
        .eq('meta_campaign_id', k.meta_campaign_id).order('phase_start', { ascending: false });
      quellen.push({ typ: 'campaign', id: k.meta_campaign_id, name: k.name, werbekonto_id: normKonto(k.werbekonto_id),
        effective_status: k.effective_status, start: info?.phase_start || (k.meta_start_time?.slice(0, 10) || null),
        letzter_aktiv: info?.letzter_aktiv_tag || null, aktive_lauftage: info?.aktive_lauftage || 0, live: !!info?.live, phasen: ph || [] });
    }
    for (const a of (adsets || [])) {
      const { phasen, cur } = await adsetPhasenInfo(a.meta_adset_id);
      const live = cur ? (Date.now() - Date.parse(cur.letzter_aktiv_tag)) / 86400000 <= 3 : false;
      quellen.push({ typ: 'adset', id: a.meta_adset_id, name: a.name, werbekonto_id: normKonto(a.werbekonto_id),
        effective_status: a.effective_status, kampagne_id: a.meta_campaign_id,
        start: cur?.phase_start || (a.meta_start_time?.slice(0, 10) || null),
        letzter_aktiv: cur?.letzter_aktiv_tag || null, aktive_lauftage: cur?.aktive_lauftage || 0, live, phasen });
    }

    // Tages-Insights (30 Tage): Spend/Clicks aus Kampagnen- + Ad-Set-Insights, Bewerbungen aus talentone_bewerbungen.
    const heute = ymd(Date.now());
    const von30 = ymd(Date.now() - 29 * 86400000);
    const byTag = {}; // datum → {spend, clicks, bewerbungen}
    const add = (datum, sp, cl) => { const t = (byTag[datum] ||= { datum, spend: 0, clicks: 0, bewerbungen: 0 }); t.spend += sp; t.clicks += cl; };
    if (campIds.length) {
      const { data } = await supabase.from('talentone_meta_insights').select('datum, spend, clicks').in('meta_campaign_id', campIds).gte('datum', von30).lte('datum', heute);
      for (const r of (data || [])) add(r.datum, Number(r.spend) || 0, Number(r.clicks) || 0);
    }
    if (adsetIds.length) {
      const { data } = await supabase.from('talentone_meta_adset_insights').select('datum, spend, clicks').in('meta_adset_id', adsetIds).gte('datum', von30).lte('datum', heute);
      for (const r of (data || [])) add(r.datum, Number(r.spend) || 0, Number(r.clicks) || 0);
    }
    // Bewerbungen je Tag über die Jobs des Projekts.
    const { data: jobs } = await supabase.from('talentone_jobs').select('id').eq('projekt_id', projektId);
    const jobIds = (jobs || []).map(j => j.id);
    if (jobIds.length) {
      const { data: bew } = await supabase.from('talentone_bewerbungen').select('created_at').in('job_id', jobIds).gte('created_at', von30);
      for (const b of (bew || [])) { const d = String(b.created_at).slice(0, 10); if (byTag[d]) byTag[d].bewerbungen++; else byTag[d] = { datum: d, spend: 0, clicks: 0, bewerbungen: 1 }; }
    }
    const tage = [];
    for (let i = 29; i >= 0; i--) { const d = ymd(Date.now() - i * 86400000); tage.push(byTag[d] || { datum: d, spend: 0, clicks: 0, bewerbungen: 0 }); }

    // Kennzahlen (dieselbe Rechenlogik wie Cockpit).
    const metrik = await metaMetrikenFuerProjekt(projektId).catch(() => null);

    // Plausibilitäts-Hinweise (gelbe Zeilen).
    const warnungen = [];
    if (metrik) {
      const aktiveQuelle = quellen.some(q => /ACTIVE/i.test(q.effective_status || '') || q.live);
      if (aktiveQuelle && (metrik.aktive_lauftage || 0) >= 7 && (metrik.bewerbungen || 0) === 0)
        warnungen.push('Kampagne/Ad Set aktiv, aber 0 Bewerbungen im aktuellen Laufzeitfenster.');
      if ((metrik.spend_monat || 0) > 0 && !metrik.live)
        warnungen.push('Spend läuft, aber keine als „live" erkannte Laufphase — Status prüfen.');
      if (projekt.geplanter_livegang && metrik.ist_livegang) {
        const diff = Math.round((Date.parse(metrik.ist_livegang) - Date.parse(projekt.geplanter_livegang)) / 86400000);
        if (Math.abs(diff) > 3) warnungen.push(`Geplanter Livegang (${projekt.geplanter_livegang}) weicht vom Ist-Start (${metrik.ist_livegang}) um ${diff > 0 ? '+' : ''}${diff} Tage ab.`);
      }
      if (metrik.zahlungsproblem) warnungen.push('Zahlungsproblem an einem beteiligten Werbekonto — Kampagnen evtl. ausgesetzt.');
    }
    if (!projekt.monatsbudget_euro) warnungen.push('Kein Monatsbudget gepflegt — Budget-Wächter bleibt stumm.');
    if (!projekt.werbekosten) warnungen.push('Werbekosten-Träger (N&W/Kunde) nicht gepflegt.');

    const konto = (konten || []).map(k => ({ konto_id: k.konto_id, name: k.name, typ: k.typ, zahlungsproblem: !!k.zahlungsproblem, account_status: k.account_status }));
    res.json({
      hat_verknuepfung: hatVerknuepfung,
      projekt: { id: projekt.id, name: projekt.projekt, kunde_id: projekt.kunde_id, geplanter_livegang: projekt.geplanter_livegang, werbekosten: projekt.werbekosten, monatsbudget_euro: projekt.monatsbudget_euro, meta_werbekonto_id: projekt.meta_werbekonto_id },
      konto, quellen, tage, metrik, warnungen,
      last_sync: getMetaSyncStatus().last_run_at,
    });
  } catch (err) { console.error('[meta-tab]', err.message); res.status(500).json({ error: err.message }); }
});

export default router;
