// Public Routen — KEIN Login nötig, aber abgesichert per Token im Pfad.
// Wird in server.js OHNE requireAuth gemountet.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { uploadBuffer, extFromMime, safeFilenameStem } from '../storage.js';

const router = Router();

// GET /api/public/upload/:token — minimale Kunden-Info für die öffentliche Upload-Seite
router.get('/upload/:token', async (req, res) => {
  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, ansprechpartner, logo_url')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });
  res.json({
    kunde: {
      firmenname: kunde.firmenname,
      ansprechpartner: kunde.ansprechpartner,
      hat_logo: !!kunde.logo_url,
    },
  });
});

// POST /api/public/upload/:token  body: { typ: 'logo' | 'foto', fileData (base64), fileName, contentType, beschreibung? }
router.post('/upload/:token', async (req, res) => {
  const { typ, fileData, fileName = 'datei.jpg', contentType = 'image/jpeg', beschreibung } = req.body || {};
  if (!['logo', 'foto'].includes(typ)) return res.status(400).json({ error: 'typ muss "logo" oder "foto" sein.' });
  if (!fileData) return res.status(400).json({ error: 'fileData fehlt.' });

  const { data: kunde } = await supabase
    .from('talentone_kunden')
    .select('id, firmenname, logo_url')
    .eq('upload_token', req.params.token)
    .maybeSingle();
  if (!kunde) return res.status(404).json({ error: 'Link ungültig oder abgelaufen.' });

  try {
    const buffer = Buffer.from(fileData, 'base64');
    const ext = extFromMime(contentType, typ === 'logo' ? 'png' : 'jpg');
    const stem = safeFilenameStem(fileName);
    const path = `${kunde.id}/${Date.now()}-${stem}.${ext}`;

    if (typ === 'logo') {
      const publicUrl = await uploadBuffer({
        bucket: 'talentone-logos', path, buffer, contentType,
      });
      // Altes Logo aufräumen
      if (kunde.logo_url) {
        const { deleteFromBucket } = await import('../storage.js');
        await deleteFromBucket('talentone-logos', kunde.logo_url);
      }
      await supabase.from('talentone_kunden').update({ logo_url: publicUrl }).eq('id', kunde.id);
      // zusätzlich in talentone_referenzbilder als typ=logo loggen, damit der Mitarbeiter den Verlauf sieht
      await supabase.from('talentone_referenzbilder').insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'logo', uploaded_via: 'kunde',
      });
      return res.status(201).json({ ok: true, typ: 'logo', bild_url: publicUrl });
    }

    // typ === 'foto'
    const publicUrl = await uploadBuffer({
      bucket: 'talentone-referenzbilder', path, buffer, contentType,
    });
    const { data: row, error: insErr } = await supabase
      .from('talentone_referenzbilder')
      .insert({
        kunde_id: kunde.id, bild_url: publicUrl, typ: 'foto',
        beschreibung: beschreibung || null,
        uploaded_via: 'kunde',
      })
      .select().single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.status(201).json({ ok: true, typ: 'foto', referenzbild: row });
  } catch (err) {
    console.error('[public-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
