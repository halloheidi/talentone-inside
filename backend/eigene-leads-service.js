// Eigene Meta-Lead-Ads: liest konfigurierte Google Sheets, dedupliziert robust
// (Inhalts-/Identitäts-Hash — Meta schreibt manchmal Doppelzeilen), speichert die
// Leads im Tool und überträgt sie nach Close (Lead + Note + Task, mit festen
// Feld-Werten + optionalem Spalten->Custom-Field-Mapping). Fehler blockieren nie:
// der Lead bleibt "ausstehend"/"fehler" und wird beim nächsten Lauf erneut versucht.

import crypto from 'node:crypto';
import { supabase } from './supabase.js';
import { readValues, isConfigured as sheetsConfigured } from './google-sheets.js';
import {
  findLeadByContact, createLead, addNote, addTask, deleteLead,
} from './close.js';

const MAX_VERSUCHE_WARN = 3; // ab so vielen Fehlversuchen: interne Warn-Mail

/* ─────────────────────── Header-basiertes Mapping ─────────────────────── */

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.:()\/\-–—]/g, ' ')
    .replace(/[äöü]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[m]))
    .replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}
const matchHeader = (header, aliases) => {
  const h = norm(header);
  return !!h && aliases.some(a => { const n = norm(a); return n && (h === n || h.includes(n) || n.includes(h)); });
};

const IS_NAME    = h => matchHeader(h, ['full name', 'vollstaendiger name', 'name', 'vor und nachname', 'vorname nachname']);
const IS_VORNAME = h => matchHeader(h, ['first name', 'vorname', 'firstname']);
const IS_NACHNAME= h => matchHeader(h, ['last name', 'nachname', 'lastname', 'surname']);
const IS_EMAIL   = h => matchHeader(h, ['email', 'e-mail', 'e mail', 'mail']);
const IS_TELEFON = h => matchHeader(h, ['phone number', 'phone', 'telefon', 'telefonnummer', 'handy', 'mobil', 'rufnummer', 'tel']);
const IS_KAMPAGNE= h => matchHeader(h, ['campaign name', 'kampagne', 'campaign', 'ad name', 'anzeige', 'adset name']);
// interne Sheet-/Meta-Spalten, die nicht als Formular-Antwort in die Note sollen
const IS_INTERN  = h => matchHeader(h, ['id', 'lead id', 'created', 'created time', 'zeitstempel', 'timestamp', 'importiert am', 'importiert']);

/** Wandelt eine Sheet-Zeile (header + Werte) in einen strukturierten Lead. */
export function mapRow(header, row) {
  let name = null, vorname = null, nachname = null, email = null, telefon = null, kampagne = null;
  const daten = {};
  header.forEach((h, i) => {
    const val = (row[i] == null ? '' : String(row[i])).trim();
    if (!val) return;
    if (IS_EMAIL(h) && !email)       { email = val; return; }
    if (IS_TELEFON(h) && !telefon)   { telefon = val; return; }
    if (IS_NAME(h) && !name)         { name = val; return; }
    if (IS_VORNAME(h) && !vorname)   { vorname = val; return; }
    if (IS_NACHNAME(h) && !nachname) { nachname = val; return; }
    if (IS_KAMPAGNE(h) && !kampagne) { kampagne = val; /* auch in daten behalten */ }
    if (IS_INTERN(h)) return;
    daten[String(h).trim() || `Spalte ${i + 1}`] = val;
  });
  const vollerName = name || [vorname, nachname].filter(Boolean).join(' ').trim() || null;
  return { name: vollerName, email, telefon, kampagne, daten };
}

/** Robuster Dedup-Hash: Identität (Email|Telefon|Name); Fallback voller Inhalt. */
export function rowHash(mapped) {
  const ident = [mapped.email, mapped.telefon, mapped.name].map(x => norm(x)).filter(Boolean).join('|');
  const basis = ident || JSON.stringify(Object.entries(mapped.daten || {}).sort());
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

/* ─────────────────────── Close-Übertragung ─────────────────────── */

function renderPlaceholders(text, lead) {
  if (!text) return text;
  return String(text).replace(/\[([^\]]+)\]/g, (m, key) => {
    const k = key.trim();
    if (/^name$/i.test(k)) return lead.name || '';
    if (/^telefon$/i.test(k)) return lead.telefon || '';
    if (/^e-?mail$/i.test(k)) return lead.email || '';
    if (/^kampagne$/i.test(k)) return lead.kampagne || '';
    const feld = k.match(/^sheet-?feld:\s*(.+)$/i);
    if (feld) {
      const wanted = norm(feld[1]);
      const hit = Object.entries(lead.daten || {}).find(([kk]) => norm(kk) === wanted || norm(kk).includes(wanted));
      return hit ? String(hit[1]) : '';
    }
    return m; // unbekannter Platzhalter bleibt stehen
  });
}

function dueIsoFrom(faelligkeit) {
  const d = new Date();
  const mode = faelligkeit?.mode || 'today';
  if (mode === 'plus_days') d.setDate(d.getDate() + (Number(faelligkeit?.days) || 1));
  return d.toISOString();
}

function buildCustomFields(quelle, lead) {
  const cf = {};
  for (const f of (quelle.close_fixed_fields || [])) {
    if (f?.field_id && f.value !== undefined && f.value !== null && f.value !== '') cf[`custom.${f.field_id}`] = f.value;
  }
  for (const m of (quelle.spalten_mapping || [])) {
    if (!m?.sheet_col || !m?.close_field_id) continue;
    const entry = Object.entries(lead.daten || {}).find(([k]) => norm(k) === norm(m.sheet_col));
    if (entry && entry[1] !== '') cf[`custom.${m.close_field_id}`] = entry[1];
  }
  return cf;
}

function formularNote(lead) {
  const zeilen = Object.entries(lead.daten || {}).map(([k, v]) => `• ${k}: ${v}`).join('\n');
  const quelle = `Meta Lead Ad — ${lead.kampagne || lead.quelle_name || 'Eigene Leads'}`;
  return `📋 Neuer Lead über ${quelle}\n\nKontakt: ${lead.name || '—'}${lead.telefon ? ' · ' + lead.telefon : ''}${lead.email ? ' · ' + lead.email : ''}\n\nFormular-Antworten:\n${zeilen || '—'}`;
}

/**
 * Überträgt EINEN Tool-Lead nach Close (Duplikat-Schutz: bestehenden Lead
 * wiederverwenden statt doppelt anzulegen). Aktualisiert den Lead-Datensatz.
 * @returns {{ ok: boolean, close_lead_id?, error? }}
 */
export async function syncLeadToClose(lead, quelle) {
  if (!process.env.CLOSE_API_KEY) return { ok: false, error: 'CLOSE_API_KEY nicht gesetzt' };
  try {
    let closeLead = await findLeadByContact({ email: lead.email, phone: lead.telefon });
    let reused = !!closeLead;
    if (!closeLead) {
      closeLead = await createLead({
        name: lead.name || lead.kampagne || 'Neuer Lead',
        contactName: lead.name,
        email: lead.email,
        phone: lead.telefon,
        statusId: quelle.close_lead_status_id || null,
        customFields: buildCustomFields(quelle, lead),
      });
    }
    await addNote({ leadId: closeLead.id, note: formularNote(lead) });
    let taskId = null;
    if (quelle.close_task_text?.trim()) {
      const task = await addTask({
        leadId: closeLead.id,
        text: renderPlaceholders(quelle.close_task_text, lead),
        assignedTo: quelle.close_task_assignee || null,
        dueIso: dueIsoFrom(quelle.close_task_faelligkeit),
      });
      taskId = task?.id || null;
    }
    await supabase.from('talentone_eigene_leads')
      .update({ close_lead_id: closeLead.id, close_task_id: taskId, close_status: 'ok', close_error: null, updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    console.log(`[eigene-leads] Lead ${lead.id.slice(0, 8)} -> Close ${closeLead.id}${reused ? ' (wiederverwendet)' : ' (neu)'}`);
    return { ok: true, close_lead_id: closeLead.id, reused };
  } catch (err) {
    const versuche = (lead.close_sync_versuche || 0) + 1;
    await supabase.from('talentone_eigene_leads')
      .update({ close_status: 'fehler', close_error: err.message?.slice(0, 500), close_sync_versuche: versuche, updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    console.warn(`[eigene-leads] Close-Sync fehlgeschlagen (Lead ${lead.id.slice(0, 8)}, Versuch ${versuche}): ${err.message}`);
    if (versuche === MAX_VERSUCHE_WARN) await warnMail(quelle, err.message);
    return { ok: false, error: err.message };
  }
}

async function warnMail(quelle, fehler) {
  try {
    const { sendTeamAlertMail } = await import('./mail.js');
    await sendTeamAlertMail({
      subject: 'Eigene-Leads: Close-Sync scheitert wiederholt',
      headline: 'Close-Sync scheitert wiederholt',
      lead: `Quelle "${quelle?.name || '—'}": Close-Übertragung ${MAX_VERSUCHE_WARN}× fehlgeschlagen. Letzter Fehler: ${fehler}. Die Leads bleiben im Tool als "Close-Sync ausstehend" und werden weiter erneut versucht.`,
    });
  } catch (e) { console.warn('[eigene-leads] Warn-Mail:', e.message); }
}

async function neuerLeadMail(quelle, lead, closeLeadId) {
  if (quelle.benachrichtigung === false) return;
  try {
    const { sendTeamAlertMail } = await import('./mail.js');
    await sendTeamAlertMail({
      subject: `Neuer Lead: ${lead.name || 'Unbekannt'} (${quelle.name})`,
      headline: `Neuer Lead über ${quelle.name}`,
      lead: `${lead.name || '—'}${lead.telefon ? ' · ' + lead.telefon : ''}${lead.email ? ' · ' + lead.email : ''}${lead.kampagne ? '\nKampagne: ' + lead.kampagne : ''}`,
      linkUrl: closeLeadId ? `https://app.close.com/lead/${closeLeadId}/` : undefined,
      linkLabel: 'In Close öffnen',
    });
  } catch (e) { console.warn('[eigene-leads] Lead-Mail:', e.message); }
}

/* ─────────────────────── Sheet-Polling ─────────────────────── */

/** Liest eine Quelle, legt neue Leads an und synct sie nach Close. */
export async function pollQuelle(quelle) {
  if (!sheetsConfigured()) return { neu: 0, error: 'GOOGLE_SERVICE_ACCOUNT_JSON fehlt' };
  const values = await readValues(quelle.spreadsheet_id, quelle.sheet_name || '', 'A:Z');
  if (!values.length) return { neu: 0 };
  const header = values[0];
  const rows = values.slice(1);

  // bekannte Hashes dieser Quelle laden (Dedup)
  const { data: bekannt = [] } = await supabase.from('talentone_eigene_leads')
    .select('row_hash').eq('quelle_id', quelle.id);
  const gesehen = new Set((bekannt || []).map(r => r.row_hash));

  let neu = 0;
  for (const row of rows) {
    const mapped = mapRow(header, row);
    if (!mapped.email && !mapped.telefon && !mapped.name) continue; // leere Zeile
    const hash = rowHash(mapped);
    if (gesehen.has(hash)) continue;
    gesehen.add(hash);

    const { data: lead, error } = await supabase.from('talentone_eigene_leads')
      .insert({
        quelle_id: quelle.id, quelle_name: quelle.name,
        name: mapped.name, email: mapped.email, telefon: mapped.telefon,
        kampagne: mapped.kampagne, daten: mapped.daten, row_hash: hash,
        close_status: 'ausstehend',
      }).select().single();
    if (error) {
      if (error.code === '23505') continue; // Race: parallel schon angelegt
      console.warn('[eigene-leads] Insert-Fehler:', error.message);
      continue;
    }
    neu++;
    const r = await syncLeadToClose(lead, quelle);
    if (r.ok) await neuerLeadMail(quelle, { ...lead, ...mapped }, r.close_lead_id);
  }
  return { neu };
}

/** Erneuter Versuch für alle offenen (ausstehend/fehler) Leads. */
export async function retryPending() {
  const { data: offen = [] } = await supabase.from('talentone_eigene_leads')
    .select('*').in('close_status', ['ausstehend', 'fehler']).eq('ist_test', false)
    .order('created_at', { ascending: true }).limit(100);
  if (!offen?.length) return { retried: 0 };
  const quellenById = {};
  for (const lead of offen) {
    let q = quellenById[lead.quelle_id];
    if (q === undefined) {
      const { data } = await supabase.from('talentone_lead_quellen').select('*').eq('id', lead.quelle_id).maybeSingle();
      q = quellenById[lead.quelle_id] = data || null;
    }
    if (q) await syncLeadToClose(lead, q);
  }
  return { retried: offen.length };
}

/** Haupt-Cron-Einstieg: alle aktiven Quellen pollen + offene Leads erneut versuchen. */
export async function pollAllQuellen() {
  const { data: quellen = [] } = await supabase.from('talentone_lead_quellen')
    .select('*').eq('aktiv', true);
  let neuGesamt = 0;
  for (const q of (quellen || [])) {
    try { const r = await pollQuelle(q); neuGesamt += r.neu || 0; }
    catch (err) { console.warn(`[eigene-leads] Quelle "${q.name}" Fehler:`, err.message); }
  }
  await retryPending().catch(err => console.warn('[eigene-leads] retry:', err.message));
  if (neuGesamt) console.log(`[eigene-leads] Poll fertig — ${neuGesamt} neue Lead(s).`);
  return { neu: neuGesamt };
}

/* ─────────────────────── Test-Lead ─────────────────────── */

/** Legt einen klar markierten TEST-Lead an (Tool + Close), um das Mapping zu prüfen. */
export async function createTestLead(quelle) {
  const mapped = {
    name: 'TEST — ' + (quelle.name || 'Eigene Leads'),
    email: `test+${Date.now()}@nowagwirth.de`,
    telefon: '+49 000 0000000',
    kampagne: `TEST ${quelle.name}`,
    daten: { 'Testfeld': 'Testwert', 'Hinweis': 'Automatisch erzeugter Test-Lead — bitte löschen.' },
  };
  const { data: lead, error } = await supabase.from('talentone_eigene_leads')
    .insert({
      quelle_id: quelle.id, quelle_name: quelle.name,
      name: mapped.name, email: mapped.email, telefon: mapped.telefon,
      kampagne: mapped.kampagne, daten: mapped.daten,
      row_hash: 'test-' + crypto.randomUUID(), close_status: 'ausstehend', ist_test: true,
    }).select().single();
  if (error) throw new Error(error.message);
  const r = await syncLeadToClose(lead, quelle);
  return { lead, close: r };
}
