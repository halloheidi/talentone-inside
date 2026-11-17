// Stabiler Download-Endpoint für Bewerber-Anhänge + teilbare Share-Links.
//
// GET /api/anhaenge/:bewerbungId/:index
//   - erzeugt ERST BEIM KLICK eine frische, kurzlebige Signed URL (Redirect)
//     bzw. liefert sie als JSON (?format=json) — nie ein vorab eingebetteter,
//     ablaufender Link.
//   - Berechtigung (dual):
//       intern  → Authorization: Bearer <Login-Session-Token>
//       Portal  → ?token=<bewerbungen_token des Jobs> ODER ?token=<portal_token des Kunden>;
//                 der Anhang MUSS zum Scope dieses Tokens gehören.
//   - Fallback: storage_path leer, aber url_original da → on demand spiegeln +
//     nachtragen; Original tot → sauberer Hinweis statt Fehlerseite.
//
// Teilbare Links (talentone_anhang_shares):
//   POST   /:bewerbungId/:index/share        → stabilen /u/:token-Link erzeugen
//   GET    /:bewerbungId/:index/shares        → erzeugte Links (für die Akte)
//   POST   /shares/:shareId/widerrufen        → Link widerrufen
//   Der eigentliche Aufruf /u/:token läuft öffentlich über public.js (ohne Login).
//
// Bewusst OHNE globales requireAuth gemountet — die Autorisierung passiert hier
// (sonst wären Portal-Links ohne Login nicht bedienbar).

import express from 'express';
import { randomBytes } from 'crypto';
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

// Autorisierung für eine Bewerbung (dual: Portal-Token ODER interner Login).
// Rückgabe: { ok, intern, job, userEmail } oder { ok:false, code, msg }.
async function authorizeBewerbung(req, bew) {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const { data: job } = await supabase
    .from('talentone_jobs')
    .select('id, kunde_id, bewerbungen_token')
    .eq('id', bew.job_id)
    .maybeSingle();
  if (token) {
    // Portal: stellen-spezifischer bewerbungen_token ODER kunde-weiter portal_token.
    let ok = !!job && !!job.bewerbungen_token && job.bewerbungen_token === token;
    if (!ok && job) {
      const { data: k } = await supabase
        .from('talentone_kunden').select('id').eq('id', job.kunde_id).eq('portal_token', token).maybeSingle();
      ok = !!k;
    }
    if (!ok) return { ok: false, code: 403, msg: 'Kein Zugriff auf diesen Anhang.' };
    return { ok: true, intern: false, job, userEmail: null };
  }
  // Intern: gültige Login-Session.
  const header = req.headers.authorization || '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!jwt) return { ok: false, code: 401, msg: 'Nicht eingeloggt.' };
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return { ok: false, code: 401, msg: 'Session abgelaufen.' };
  return { ok: true, intern: true, job, userEmail: data.user.email || data.user.id };
}

async function ladeBewerbung(bewerbungId) {
  const { data } = await supabase
    .from('talentone_bewerbungen').select('id, job_id, anhaenge').eq('id', bewerbungId).maybeSingle();
  return data;
}

// ── Download: frische Signed URL (Redirect oder JSON) ──────────────
router.get('/:bewerbungId/:index', async (req, res) => {
  if (!supabase) return cleanError(req, res, 500, 'Dienst nicht verfügbar.');
  const { bewerbungId } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) return cleanError(req, res, 400, 'Ungültiger Anhang.');

  const bew = await ladeBewerbung(bewerbungId);
  if (!bew) return cleanError(req, res, 404, 'Anhang nicht gefunden.');

  const auth = await authorizeBewerbung(req, bew);
  if (!auth.ok) return cleanError(req, res, auth.code, auth.msg);

  const arr = Array.isArray(bew.anhaenge) ? bew.anhaenge : [];
  const anhang = arr[index];
  if (!anhang) return cleanError(req, res, 404, 'Anhang nicht gefunden.');

  const result = await resolveAnhangDownload({ bewerbungId: bew.id, anhang, index });
  if (result.dead || !result.url) return cleanError(req, res, 410, 'Datei beim Anbieter nicht mehr verfügbar.');

  if (result.backfilledPath) {
    try {
      const updated = arr.map((a, i) => (i === index ? { ...a, storage_path: result.backfilledPath } : a));
      await supabase.from('talentone_bewerbungen').update({ anhaenge: updated }).eq('id', bew.id);
    } catch (e) { console.warn('[anhaenge] backfill storage_path:', e.message); }
  }

  if (wantsJson(req)) return res.json({ url: result.url, dateiname: result.dateiname });
  return res.redirect(302, result.url);
});

// ── Teilbaren Link erzeugen ────────────────────────────────────────
router.post('/:bewerbungId/:index/share', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Dienst nicht verfügbar.' });
  const { bewerbungId } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Ungültiger Anhang.' });

  const bew = await ladeBewerbung(bewerbungId);
  if (!bew) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
  const auth = await authorizeBewerbung(req, bew);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.msg });

  const arr = Array.isArray(bew.anhaenge) ? bew.anhaenge : [];
  if (!arr[index]) return res.status(404).json({ error: 'Anhang nicht gefunden.' });

  const shareToken = randomBytes(18).toString('base64url');
  const { data, error } = await supabase.from('talentone_anhang_shares').insert({
    bewerbung_id: bew.id,
    anhang_index: index,
    share_token: shareToken,
    kunde_id: auth.job?.kunde_id || null,
    erstellt_von: auth.intern ? (auth.userEmail || 'intern') : 'kunde',
  }).select('id, share_token, erstellt_am, gueltig_bis, aufrufe, widerrufen_am').single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ share: data });
});

// ── Erzeugte Links für einen Anhang (für die Akte) ─────────────────
router.get('/:bewerbungId/:index/shares', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Dienst nicht verfügbar.' });
  const { bewerbungId } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Ungültiger Anhang.' });

  const bew = await ladeBewerbung(bewerbungId);
  if (!bew) return res.status(404).json({ error: 'Anhang nicht gefunden.' });
  const auth = await authorizeBewerbung(req, bew);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.msg });

  const { data, error } = await supabase.from('talentone_anhang_shares')
    .select('id, share_token, erstellt_von, erstellt_am, gueltig_bis, aufrufe, letzter_aufruf_am, widerrufen_am')
    .eq('bewerbung_id', bew.id).eq('anhang_index', index)
    .order('erstellt_am', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ shares: data || [] });
});

// ── Link widerrufen ────────────────────────────────────────────────
router.post('/shares/:shareId/widerrufen', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Dienst nicht verfügbar.' });
  const { data: share } = await supabase.from('talentone_anhang_shares')
    .select('id, bewerbung_id, widerrufen_am').eq('id', req.params.shareId).maybeSingle();
  if (!share) return res.status(404).json({ error: 'Link nicht gefunden.' });

  const bew = await ladeBewerbung(share.bewerbung_id);
  if (!bew) return res.status(404).json({ error: 'Link nicht gefunden.' });
  const auth = await authorizeBewerbung(req, bew);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.msg });

  if (!share.widerrufen_am) {
    const { error } = await supabase.from('talentone_anhang_shares')
      .update({ widerrufen_am: new Date().toISOString() }).eq('id', share.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

export default router;
