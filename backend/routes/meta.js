// Meta-Integration Admin-Endpoints (Phase 1). Alles requireAdmin.
// Der System-User-Token wird NUR serverseitig gehalten und NIE zurückgegeben —
// die Status-Antwort liefert nur ein Flag + die letzten 4 Zeichen als Kontrolle.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getMetaToken, setMetaToken, getMetaSyncStatus, syncMetaKampagnen, braucheBackfill, ladeAdAccounts, matchKampagnen } from '../meta-sync.js';
import { aktuellePhaseInfo, laufphasenAktualisieren } from '../meta-laufphasen.js';
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
    .select('meta_campaign_id, name, werbekonto_id, effective_status, meta_start_time, kunde_id, talentone_kunden(firmenname)')
    .is('projekt_id', null).order('name');
  if (error) return res.status(500).json({ error: error.message });
  const kn = await kontoNamen();
  const pm = await phasenMeta((data || []).map(k => k.meta_campaign_id));
  res.json({ kampagnen: (data || []).map(k => ({
    ...k,
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

export default router;
