// Meta-Integration Admin-Endpoints (Phase 1). Alles requireAdmin.
// Der System-User-Token wird NUR serverseitig gehalten und NIE zurückgegeben —
// die Status-Antwort liefert nur ein Flag + die letzten 4 Zeichen als Kontrolle.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getMetaToken, setMetaToken, getMetaSyncStatus, syncMetaKampagnen, braucheBackfill, ladeAdAccounts, matchKampagnen } from '../meta-sync.js';

const router = Router();

const normKonto = (id) => { const s = String(id || '').trim(); return s ? (s.startsWith('act_') ? s : `act_${s}`) : null; };

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
    .select('konto_id, name, typ, kunde_id, talentone_kunden(firmenname)');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ konten: (data || []).map(k => ({ ...k, kunde_name: k.talentone_kunden?.firmenname || null, talentone_kunden: undefined })) });
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
    .select('meta_campaign_id, name, werbekonto_id, effective_status, kunde_id, talentone_kunden(firmenname)')
    .is('projekt_id', null).order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ kampagnen: (data || []).map(k => ({ ...k, kunde_name: k.talentone_kunden?.firmenname || null, talentone_kunden: undefined })) });
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
