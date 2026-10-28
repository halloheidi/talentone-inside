// Etappe 3: Gesellenwerk-Pool (intern). Geschützt (requireAuth) — alle eingeloggten
// Inside-Nutzer, kein Admin-Zwang. Niemals über Portal/Token-Zugänge erreichbar.
// Listet Vormerkungen, leitet Gewerk (Stelle) und Wohnort (Funnel-Antwort) beim Lesen ab.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { gewerkAusStelle, wohnortAusAntworten, gwMailReady, versendeOptinMail } from '../gesellenwerk.js';

const router = Router();

// Vormerkungen + abgeleitete Felder (Name/Gewerk/Wohnort/Ursprungskunde) zusammenführen.
async function ladeVormerkungen() {
  const { data: vms = [] } = await supabase.from('talentone_gesellenwerk_vormerkungen')
    .select('*').order('created_at', { ascending: false });
  if (!vms.length) return [];
  const bewIds = [...new Set(vms.map(v => v.bewerbung_id))];
  const { data: bews = [] } = await supabase.from('talentone_bewerbungen')
    .select('id, name, email, telefon, job_id, antworten').in('id', bewIds);
  const bewById = Object.fromEntries((bews || []).map(b => [b.id, b]));
  const jobIds = [...new Set((bews || []).map(b => b.job_id).filter(Boolean))];
  const { data: jobs = [] } = jobIds.length
    ? await supabase.from('talentone_jobs').select('id, stelle, kunde_id').in('id', jobIds)
    : { data: [] };
  const jobById = Object.fromEntries((jobs || []).map(j => [j.id, j]));
  const kundeIds = [...new Set((jobs || []).map(j => j.kunde_id).filter(Boolean))];
  const { data: kunden = [] } = kundeIds.length
    ? await supabase.from('talentone_kunden').select('id, firmenname').in('id', kundeIds)
    : { data: [] };
  const kundeById = Object.fromEntries((kunden || []).map(k => [k.id, k]));

  return vms.map(v => {
    const b = bewById[v.bewerbung_id] || {};
    const job = b.job_id ? jobById[b.job_id] : null;
    const kunde = job?.kunde_id ? kundeById[job.kunde_id] : null;
    return {
      id: v.id,
      bewerbung_id: v.bewerbung_id,
      status: v.status,
      quelle: v.quelle,
      einwilligung: !!v.einwilligung,
      einwilligung_art: v.einwilligung_art || null,
      einwilligung_am: v.einwilligung_am || null,
      optin_gesendet_am: v.optin_gesendet_am || null,
      vorgemerkt_am: v.vorgemerkt_am || null,
      vorgemerkt_von: v.vorgemerkt_von || null,
      notiz: v.notiz || null,
      gesellenwerk_kandidat_id: v.gesellenwerk_kandidat_id || null,
      created_at: v.created_at,
      name: b.name || '—',
      email: b.email || null,
      telefon: b.telefon || null,
      gewerk: gewerkAusStelle(job?.stelle),
      wohnort: wohnortAusAntworten(b.antworten),
      ursprungskunde: kunde?.firmenname || '—',
    };
  });
}

// GET /api/gesellenwerk — alle Vormerkungen (Frontend filtert Tabs/Filter clientseitig).
router.get('/', async (req, res) => {
  try {
    const list = await ladeVormerkungen();
    const gewerke = [...new Set(list.map(v => v.gewerk).filter(g => g && g !== '–'))].sort();
    res.json({ vormerkungen: list, gewerke, mail_ready: gwMailReady() });
  } catch (err) { console.error('[gesellenwerk/list]', err.message); res.status(500).json({ error: err.message }); }
});

// GET /api/gesellenwerk/export.csv — CSV mit Spalte kontaktierbar.
router.get('/export.csv', async (req, res) => {
  try {
    const list = await ladeVormerkungen();
    const STATUS_LABEL = { vorgeschlagen: 'Zu prüfen', vorgemerkt: 'Vorgemerkt', uebertragen: 'Übertragen', zurueckgezogen: 'Zurückgezogen' };
    const EINW_LABEL = v => !v.einwilligung ? 'fehlt' : (v.einwilligung_art === 'telefon' ? 'Telefon' : v.einwilligung_art === 'optin_mail' ? 'Mail' : 'ja');
    const esc = s => { const t = (s == null ? '' : String(s)); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Name', 'Gewerk', 'Wohnort', 'Ursprungskunde', 'Status', 'Einwilligung', 'Vorgemerkt am', 'Vorgemerkt von', 'Notiz', 'kontaktierbar'];
    const rows = list.map(v => [
      v.name, v.gewerk, v.wohnort, v.ursprungskunde, STATUS_LABEL[v.status] || v.status,
      EINW_LABEL(v), v.vorgemerkt_am ? new Date(v.vorgemerkt_am).toLocaleDateString('de-DE') : '',
      v.vorgemerkt_von || '', v.notiz || '',
      v.einwilligung ? 'ja' : 'nur mit Einladungs-Opt-in',
    ].map(esc).join(';'));
    const csv = '﻿' + [head.join(';'), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gesellenwerk-pool-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) { console.error('[gesellenwerk/csv]', err.message); res.status(500).json({ error: err.message }); }
});

// PATCH /api/gesellenwerk/:id/vormerken — vorgeschlagen → vorgemerkt.
router.patch('/:id/vormerken', async (req, res) => {
  try {
    const jetzt = new Date().toISOString();
    const { data, error } = await supabase.from('talentone_gesellenwerk_vormerkungen')
      .update({ status: 'vorgemerkt', vorgemerkt_am: jetzt, vorgemerkt_von: req.user?.email || null, updated_at: jetzt })
      .eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ vormerkung: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/gesellenwerk/:id/zurueckziehen
router.patch('/:id/zurueckziehen', async (req, res) => {
  try {
    const { data, error } = await supabase.from('talentone_gesellenwerk_vormerkungen')
      .update({ status: 'zurueckgezogen', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ vormerkung: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/gesellenwerk/:id/notiz  body: { notiz }
router.patch('/:id/notiz', async (req, res) => {
  try {
    const notiz = (req.body?.notiz ?? '').toString().trim() || null;
    const { data, error } = await supabase.from('talentone_gesellenwerk_vormerkungen')
      .update({ notiz, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ vormerkung: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/gesellenwerk/:id/optin-mail — Opt-in-Mail an den Kandidaten senden.
// Setzt optin_token (einmalig, 30 Tage) + optin_gesendet_am. Status/Einwilligung
// ändern sich erst beim Klick auf den Bestätigungslink (Public-Route).
router.post('/:id/optin-mail', async (req, res) => {
  try {
    if (!gwMailReady()) return res.status(409).json({ error: 'Absender-Domain (gesellenwerk.de) noch nicht verifiziert.' });
    const row = await versendeOptinMail(req.params.id);
    res.json({ vormerkung: row });
  } catch (err) { console.error('[gesellenwerk/optin-mail]', err.message); res.status(500).json({ error: err.message }); }
});

export default router;
