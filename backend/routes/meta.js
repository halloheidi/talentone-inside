// Meta-Integration Admin-Endpoints (Phase 1). Alles requireAdmin.
// Der System-User-Token wird NUR serverseitig gehalten und NIE zurückgegeben —
// die Status-Antwort liefert nur ein Flag + die letzten 4 Zeichen als Kontrolle.

import { Router } from 'express';
import { getMetaToken, setMetaToken, getMetaSyncStatus, syncMetaKampagnen, braucheBackfill } from '../meta-sync.js';

const router = Router();

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

export default router;
