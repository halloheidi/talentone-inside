// Einstellungs-CRUD + Mail-Vorschau + Speichern-Und-Senden.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  listHires, createHire, updateHire, deleteHire,
  buildHireMailPreview, recordHireAndMail,
} from '../hires-service.js';

const router = Router();

/* GET /api/hires?offer_id=... */
router.get('/', async (req, res) => {
  const { offer_id } = req.query || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const hires = await listHires(offer_id);
    res.json({ hires });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/hires  body: { offer_id, position?, hired_at?, note? } */
router.post('/', async (req, res) => {
  const { offer_id, position, hired_at, note } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const hire = await createHire({ offer_id, position, hired_at, note, created_by: req.user?.email });
    res.status(201).json({ hire });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PATCH /api/hires/:id */
router.patch('/:id', async (req, res) => {
  try {
    const hire = await updateHire(req.params.id, req.body || {});
    res.json({ hire });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/hires/:id */
router.delete('/:id', async (req, res) => {
  try {
    await deleteHire(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/hires/preview?offer_id=&hired_at=&position=&hire_index=
   Liefert Betreff+Text+Standard-Empfänger fürs Send-Modal. */
router.get('/preview', async (req, res) => {
  const { offer_id, hired_at, position, hire_index } = req.query || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  try {
    const preview = await buildHireMailPreview({
      offerId: offer_id,
      hiredAt: hired_at || null,
      position: position || null,
      hireIndex: hire_index != null ? Number(hire_index) : null,
    });
    res.json(preview);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/hires/record-and-mail
   Erfasst die Einstellung UND (falls Checkbox aktiv im UI) versendet die Mail
   mit editiertem Betreff/Text. */
router.post('/record-and-mail', async (req, res) => {
  const {
    offer_id, position, hired_at, note,
    send_mail = true, to, subject, body,
  } = req.body || {};
  if (!offer_id) return res.status(400).json({ error: 'offer_id ist Pflicht.' });
  if (send_mail && (!to || !subject || !body)) {
    return res.status(400).json({ error: 'to, subject, body sind Pflicht wenn send_mail=true.' });
  }
  try {
    const result = await recordHireAndMail({
      offerId: offer_id, position, hired_at, note,
      created_by: req.user?.email,
      send_mail, to, subject, body,
    });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
