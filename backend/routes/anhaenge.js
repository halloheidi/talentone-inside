// Stabiler Download-Endpoint für Bewerber-Anhänge.
//
// GET /api/anhaenge/:bewerbungId/:index
//   - erzeugt ERST BEIM KLICK eine frische, kurzlebige Signed URL (Redirect)
//     bzw. liefert sie als JSON (?format=json) — nie ein vorab eingebetteter,
//     ablaufender Link.
//   - Berechtigung (dual):
//       intern  → Authorization: Bearer <Login-Session-Token>
//       Portal  → ?token=<bewerbungen_token des Jobs>; der Anhang MUSS zu einer
//                 Bewerbung dieses Job-/Token-Kunden gehören.
//   - Fallback: storage_path leer, aber url_original da → on demand spiegeln +
//     nachtragen; Original tot → sauberer Hinweis statt Fehlerseite.
//
// Bewusst OHNE globales requireAuth gemountet — die Autorisierung passiert hier
// (sonst wären Portal-Links ohne Login nicht bedienbar).

import express from 'express';
import { supabase } from '../supabase.js';
import { resolveAnhangDownload } from '../anhaenge.js';

const router = express.Router();

function wantsJson(req) {
  return req.query.format === 'json' || String(req.headers.accept || '').includes('application/json');
}

// Sauberer Hinweis (statt Fehlerseite) — als HTML bei Navigation, als JSON bei Fetch.
function cleanError(req, res, status, msg) {
  if (wantsJson(req)) return res.status(status).json({ error: msg });
  res.status(status).type('html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anhang nicht verfügbar</title></head>
<body style="margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f0efed;color:#0a0a0a;">
<div style="max-width:420px;margin:12vh auto;padding:28px 26px;background:#fff;border-radius:14px;text-align:center;">
  <div style="font-size:34px;margin-bottom:10px;">📄</div>
  <h1 style="font-size:17px;margin:0 0 8px;">${msg}</h1>
  <p style="font-size:13px;color:#5a5955;margin:0;">Bitte wende dich an dein TalentOne-Team, falls du die Unterlage benötigst.</p>
</div></body></html>`);
}

router.get('/:bewerbungId/:index', async (req, res) => {
  if (!supabase) return cleanError(req, res, 500, 'Dienst nicht verfügbar.');
  const { bewerbungId } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) return cleanError(req, res, 400, 'Ungültiger Anhang.');

  // Bewerbung laden (für Anhang + Autorisierungs-Scope).
  const { data: bew, error } = await supabase
    .from('talentone_bewerbungen')
    .select('id, job_id, anhaenge')
    .eq('id', bewerbungId)
    .maybeSingle();
  if (error) return cleanError(req, res, 500, 'Anhang konnte nicht geladen werden.');
  if (!bew) return cleanError(req, res, 404, 'Anhang nicht gefunden.');

  // ── Autorisierung ──────────────────────────────────────────────
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (token) {
    // Portal: Token muss zu dem Job gehören, dem die Bewerbung zugeordnet ist.
    const { data: job } = await supabase
      .from('talentone_jobs')
      .select('id, bewerbungen_token')
      .eq('bewerbungen_token', token)
      .maybeSingle();
    if (!job || job.id !== bew.job_id) {
      return cleanError(req, res, 403, 'Kein Zugriff auf diesen Anhang.');
    }
  } else {
    // Intern: gültige Login-Session (Supabase Access Token).
    const header = req.headers.authorization || '';
    const jwt = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!jwt) return cleanError(req, res, 401, 'Nicht eingeloggt.');
    const { data, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !data?.user) return cleanError(req, res, 401, 'Session abgelaufen.');
  }

  // ── Anhang auflösen ────────────────────────────────────────────
  const arr = Array.isArray(bew.anhaenge) ? bew.anhaenge : [];
  const anhang = arr[index];
  if (!anhang) return cleanError(req, res, 404, 'Anhang nicht gefunden.');

  const result = await resolveAnhangDownload({ bewerbungId: bew.id, anhang, index });
  if (result.dead || !result.url) {
    return cleanError(req, res, 410, 'Datei beim Anbieter nicht mehr verfügbar.');
  }

  // On-demand gespiegelt → storage_path in der Zeile nachtragen (best effort).
  if (result.backfilledPath) {
    try {
      const updated = arr.map((a, i) => (i === index ? { ...a, storage_path: result.backfilledPath } : a));
      await supabase.from('talentone_bewerbungen').update({ anhaenge: updated }).eq('id', bew.id);
    } catch (e) { console.warn('[anhaenge] backfill storage_path:', e.message); }
  }

  if (wantsJson(req)) return res.json({ url: result.url, dateiname: result.dateiname });
  return res.redirect(302, result.url);
});

export default router;
