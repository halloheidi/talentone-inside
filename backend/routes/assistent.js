// Interner KI-Assistent (Phase 1) — serverseitiger Anthropic-Proxy mit Tool-Use.
//
// Sicherheits-Eckpfeiler:
//   - API-Key bleibt im Backend (ANTHROPIC_API_KEY). Nie im Frontend.
//   - Route läuft unter requireAuth (in server.js gemountet) → req.user gesetzt.
//   - Schreibende Tools (projekt_anlegen, email_vorlage_bearbeiten:aendern) werden
//     NICHT ausgeführt, bis der Nutzer sie im Chat per Klick bestätigt hat
//     (approvals-Map vom Frontend). Der Server führt die Rechte-Prüfung selbst
//     durch (z. B. Admin-Pflicht für Vorlagen-Änderungen) — nie das Widget.
//   - Jeder ausgeführte Tool-Aufruf wird in talentone_assistent_log protokolliert.
//
// Konversation ist zustandslos: das Frontend hält die messages-Historie (Browser-
// Session) und schickt sie bei jeder Anfrage mit. Bei einer bestätigungspflichtigen
// Aktion antwortet der Server mit { status:'pending', pending, messages }; nach
// Bestätigung schickt das Frontend dieselbe Historie + approvals erneut.

import { Router } from 'express';
import { supabase } from '../supabase.js';
import { isAdminEmail } from '../team.js';
import { callClaudeWithRetry } from '../claude.js';
import { anlageKundeProjektJob, PROJEKTE_STATI } from '../projekt-anlage.js';
import { tageSeit, parseSollTage, STATUS_GRUPPEN } from '../controlling-ops-service.js';
import { EMAIL_TEMPLATE_CATALOG, EMAIL_TEMPLATE_CATALOG_BY_KEY } from '../email-template-defaults.js';

const router = Router();

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_STEPS = 8;
const MAX_MESSAGES = 60;

const SYSTEM_PROMPT = `Du bist der interne KI-Assistent des Recruiting-Tools „TalentOne Inside". Du hilfst Mitarbeitenden (Agenturen TalentOne und Nowag & Wirth) bei der täglichen Arbeit im Tool.

Sprache & Stil: Deutsch, knapp, professionell, freundlich. Keine Floskeln, keine langen Vorreden. Antworte in kurzen Absätzen oder Stichpunkten.

Dir stehen diese Funktionen zur Verfügung:
- projekt_anlegen: Legt einen neuen Kunden samt Projekt/Job an. Pflicht: firmenname und stelle. Optional: agentur (talentone|nowagwirth), ansprechpartner, email, telefon, branche, region, gehalt, projektart, projektdauer, verantwortlich.
- stale_projekte_abfragen: Liefert Projekte ohne Aktivität/Fortschritt seit X Tagen (Standard 7). Optional nach Agentur filtern.
- email_vorlage_bearbeiten: Liest (aktion=lesen) oder ändert (aktion=aendern) eine E-Mail-Vorlage in der Datenbank. Betreff oder Body, je Du-/Sie-Fassung, Agentur als Parameter. Ändern ist nur Admins erlaubt.

Regeln:
- Bei Unsicherheit oder fehlenden Angaben fragst du kurz nach, statt zu raten. Rate niemals Pflichtfelder (z. B. Firmenname oder Stelle) zusammen.
- Schreibende Aktionen (Projekt anlegen, Vorlage ändern) muss der Nutzer bestätigen — das übernimmt das System automatisch. Kündige die Aktion knapp an.
- Erfindе keine Daten. Wenn eine Funktion einen Fehler liefert, erkläre ihn verständlich.
- Nutze für Fakten über Projekte/Vorlagen immer die Funktionen statt zu vermuten.`;

const TOOLS = [
  {
    name: 'projekt_anlegen',
    description: 'Legt einen neuen Kunden mit Projekt/Job an (Kunde + Job + Kanban-Projekt). Firmenname und Stelle sind Pflicht.',
    input_schema: {
      type: 'object',
      properties: {
        firmenname: { type: 'string', description: 'Name des Kundenunternehmens (Pflicht).' },
        stelle: { type: 'string', description: 'Zu besetzende Stelle / Projekttitel (Pflicht).' },
        agentur: { type: 'string', enum: ['talentone', 'nowagwirth'], description: 'Betreuende Agentur. Standard talentone.' },
        ansprechpartner: { type: 'string' },
        email: { type: 'string' },
        telefon: { type: 'string' },
        branche: { type: 'string' },
        region: { type: 'string', description: 'Standort/Region der Stelle.' },
        gehalt: { type: 'string' },
        projektart: { type: 'string' },
        projektdauer: { type: 'string', description: 'z. B. „30 Tage", „3 Monate".' },
        verantwortlich: { type: 'string', description: 'Intern verantwortliche Person.' },
      },
      required: ['firmenname', 'stelle'],
    },
  },
  {
    name: 'stale_projekte_abfragen',
    description: 'Liefert aktive Projekte ohne Aktivität/Fortschritt seit mindestens X Tagen (Basis: letzte Änderung am Projekt sowie überschrittene Soll-Laufzeit).',
    input_schema: {
      type: 'object',
      properties: {
        tage: { type: 'integer', description: 'Schwelle in Tagen ohne Aktivität. Standard 7.' },
        agentur: { type: 'string', enum: ['talentone', 'nowagwirth', 'alle'], description: 'Agentur-Filter. Standard alle.' },
        status_gruppe: { type: 'string', enum: ['aktiv', 'live', 'alle'], description: 'Welche Status berücksichtigt werden. Standard aktiv.' },
      },
    },
  },
  {
    name: 'email_vorlage_bearbeiten',
    description: 'Liest oder ändert eine E-Mail-Vorlage (talentone_email_templates). Ändern nur für Admins. Betreff oder Body, je Du/Sie-Fassung.',
    input_schema: {
      type: 'object',
      properties: {
        aktion: { type: 'string', enum: ['lesen', 'aendern'], description: 'lesen = aktuellen Stand zurückgeben; aendern = Wert überschreiben.' },
        key: { type: 'string', description: 'Vorlagen-Key, z. B. daten_pruefung, kampagne_live.' },
        agentur: { type: 'string', enum: ['talentone', 'nowagwirth'] },
        feld: { type: 'string', enum: ['betreff', 'body'], description: 'Nur bei aktion=aendern.' },
        form: { type: 'string', enum: ['du', 'sie'], description: 'Du- oder Sie-Fassung. Nur bei aktion=aendern.' },
        neuer_wert: { type: 'string', description: 'Neuer Text. Nur bei aktion=aendern.' },
      },
      required: ['aktion', 'key', 'agentur'],
    },
  },
];

// ── Bestätigungs-Logik ──────────────────────────────────────────────────────
function needsConfirmation(name, input) {
  if (name === 'projekt_anlegen') return true;
  if (name === 'email_vorlage_bearbeiten') return input?.aktion === 'aendern';
  return false;
}

function summarize(name, input) {
  if (name === 'projekt_anlegen') {
    const ag = input?.agentur === 'nowagwirth' ? 'Nowag & Wirth' : 'TalentOne';
    return `Projekt „${input?.stelle || '—'}" für Kunde „${input?.firmenname || '—'}" (${ag}) anlegen — ausführen?`;
  }
  if (name === 'email_vorlage_bearbeiten') {
    const cat = EMAIL_TEMPLATE_CATALOG_BY_KEY[input?.key];
    const feld = input?.feld === 'body' ? 'Body' : 'Betreff';
    const form = input?.form === 'sie' ? 'Sie' : 'Du';
    const ag = input?.agentur === 'nowagwirth' ? 'Nowag & Wirth' : 'TalentOne';
    const vorschau = (input?.neuer_wert || '').slice(0, 120);
    return `Vorlage „${cat?.name || input?.key}" (${ag}) — ${feld} (${form}) ändern zu:\n„${vorschau}${(input?.neuer_wert || '').length > 120 ? '…' : ''}" — ausführen?`;
  }
  return `Aktion „${name}" ausführen?`;
}

// ── Logging ─────────────────────────────────────────────────────────────────
async function logToolCall(email, tool, params, ergebnis) {
  try {
    await supabase.from('talentone_assistent_log').insert({
      user_email: email || null,
      tool_name: tool,
      parameter: params || {},
      ergebnis: ergebnis || null,
    });
  } catch (err) {
    console.warn('[assistent-log] Konnte Tool-Aufruf nicht protokollieren:', err.message);
  }
}

// ── Tool-Implementierungen ──────────────────────────────────────────────────
async function toolProjektAnlegen(input, user) {
  const firmenname = (input?.firmenname || '').trim();
  const stelle = (input?.stelle || '').trim();
  if (!firmenname) return { content: 'Firmenname fehlt — bitte erfragen.', is_error: true };
  if (!stelle) return { content: 'Stelle fehlt — bitte erfragen.', is_error: true };
  const agentur = input?.agentur === 'nowagwirth' ? 'nowagwirth' : 'talentone';

  const kundeData = {
    agentur,
    firmenname,
    ansprechpartner: input?.ansprechpartner || null,
    email: input?.email || null,
    telefon: input?.telefon || null,
    branche: input?.branche || null,
    notizen: null,
  };
  const jobData = {
    stelle,
    region: input?.region || null,
    gehalt: input?.gehalt || null,
    eingabe_methode: 'neu',
  };
  const { kunde, job } = await anlageKundeProjektJob({
    kundeData, jobData,
    meta: {
      status: 'vorbereitung',
      projektart: input?.projektart,
      projektdauer: input?.projektdauer,
      verantwortlich: input?.verantwortlich,
    },
  });
  return {
    content: JSON.stringify({
      ok: true, kunde_id: kunde.id, job_id: job.id,
      firmenname: kunde.firmenname, stelle: job.stelle, agentur,
    }),
    is_error: false,
  };
}

async function toolStaleProjekte(input) {
  const tage = Number.isFinite(input?.tage) && input.tage > 0 ? Math.floor(input.tage) : 7;
  const agenturFilter = ['talentone', 'nowagwirth'].includes(input?.agentur) ? input.agentur : null;
  const gruppe = ['aktiv', 'live', 'alle'].includes(input?.status_gruppe) ? input.status_gruppe : 'aktiv';
  const statusList = STATUS_GRUPPEN[gruppe]; // null bei 'alle'

  let q = supabase.from('talentone_projekte')
    .select('id, projekt, kunde, agentur, status, updated_at, start_phase1, live_termin, projektdauer')
    .neq('status', 'abgeschlossen');
  if (agenturFilter) q = q.eq('agentur', agenturFilter);
  if (statusList) q = q.in('status', statusList);
  const { data, error } = await q;
  if (error) return { content: 'Fehler beim Laden: ' + error.message, is_error: true };

  const now = new Date();
  const rows = (data || []).map(p => {
    const tageOhne = tageSeit(p.updated_at, now);
    const liveStart = p.start_phase1 || p.live_termin || null;
    const liveTag = liveStart ? tageSeit(liveStart, now) : null;
    const sollTage = parseSollTage(p.projektdauer);
    const ueberLaufzeit = sollTage != null && liveTag != null && liveTag > sollTage;
    return {
      projekt: p.projekt, kunde: p.kunde, agentur: p.agentur, status: p.status,
      tage_ohne_aktivitaet: tageOhne, live_tag: liveTag, soll_tage: sollTage, ueber_laufzeit: ueberLaufzeit,
    };
  }).filter(r => (r.tage_ohne_aktivitaet != null && r.tage_ohne_aktivitaet >= tage) || r.ueber_laufzeit)
    .sort((a, b) => (b.tage_ohne_aktivitaet || 0) - (a.tage_ohne_aktivitaet || 0));

  return {
    content: JSON.stringify({ schwelle_tage: tage, agentur: agenturFilter || 'alle', anzahl: rows.length, projekte: rows.slice(0, 50) }),
    is_error: false,
  };
}

async function toolEmailVorlage(input, user) {
  const key = input?.key;
  const agentur = input?.agentur;
  const cat = EMAIL_TEMPLATE_CATALOG_BY_KEY[key];
  if (!cat) return { content: `Unbekannte Vorlage: ${key}. Verfügbare Keys: ${EMAIL_TEMPLATE_CATALOG.map(t => t.key).join(', ')}`, is_error: true };
  if (!['talentone', 'nowagwirth'].includes(agentur)) return { content: 'agentur muss talentone oder nowagwirth sein.', is_error: true };

  const { data: row } = await supabase.from('talentone_email_templates')
    .select('*').eq('key', key).eq('agentur', agentur).maybeSingle();

  const aktion = input?.aktion === 'aendern' ? 'aendern' : 'lesen';
  if (aktion === 'lesen') {
    return {
      content: JSON.stringify({
        key, agentur, name: cat.name, nur_betreff: cat.betreffOnly, platzhalter: cat.platzhalter,
        betreff_du: row?.betreff_du ?? cat.betreff_du, betreff_sie: row?.betreff_sie ?? cat.betreff_sie,
        body_du: row?.body_du ?? cat.body_du, body_sie: row?.body_sie ?? cat.body_sie,
        aktiv: row?.aktiv ?? true,
      }),
      is_error: false,
    };
  }

  // aendern → Rechte-Prüfung im Server
  if (!isAdminEmail(user?.email)) {
    return { content: 'Nicht ausgeführt: E-Mail-Vorlagen ändern ist nur Admins erlaubt.', is_error: true };
  }
  const feld = input?.feld === 'body' ? 'body' : 'betreff';
  const form = input?.form === 'sie' ? 'sie' : 'du';
  if (feld === 'body' && cat.betreffOnly) {
    return { content: `Vorlage „${key}" ist Nur-Betreff — der Body wird dynamisch im Code erzeugt und kann nicht geändert werden.`, is_error: true };
  }
  if (input?.neuer_wert == null) return { content: 'neuer_wert fehlt.', is_error: true };
  const col = `${feld}_${form}`;

  // Bestehende Werte erhalten (Fallback Katalog), nur die eine Spalte überschreiben.
  const base = {
    key, agentur, name: cat.name, beschreibung: cat.beschreibung, platzhalter: cat.platzhalter,
    betreff_du: row?.betreff_du ?? cat.betreff_du, betreff_sie: row?.betreff_sie ?? cat.betreff_sie,
    body_du: row?.body_du ?? cat.body_du, body_sie: row?.body_sie ?? cat.body_sie,
    aktiv: row?.aktiv ?? true,
  };
  base[col] = String(input.neuer_wert);
  base.updated_at = new Date().toISOString();
  base.updated_by = `ki-assistent (${user?.email || '?'})`;

  const { error } = await supabase.from('talentone_email_templates')
    .upsert(base, { onConflict: 'key,agentur' });
  if (error) return { content: 'Fehler beim Speichern: ' + error.message, is_error: true };
  return { content: JSON.stringify({ ok: true, key, agentur, geaendert: col, updated_by: base.updated_by }), is_error: false };
}

async function execTool(tu, user) {
  let out;
  try {
    if (tu.name === 'projekt_anlegen') out = await toolProjektAnlegen(tu.input, user);
    else if (tu.name === 'stale_projekte_abfragen') out = await toolStaleProjekte(tu.input, user);
    else if (tu.name === 'email_vorlage_bearbeiten') out = await toolEmailVorlage(tu.input, user);
    else out = { content: 'Unbekannte Funktion.', is_error: true };
  } catch (err) {
    out = { content: 'Fehler: ' + err.message, is_error: true };
  }
  await logToolCall(user?.email, tu.name, tu.input, out.is_error ? 'fehler' : 'ok');
  return out;
}

// ── Gespräch verarbeiten (zustandslos, Historie kommt vom Client) ────────────
async function runConversation({ messages, approvals, user }) {
  let steps = 0;
  while (steps++ < MAX_TOOL_STEPS) {
    const last = messages[messages.length - 1];
    const pendingToolUse = last && last.role === 'assistant' && Array.isArray(last.content)
      && last.content.some(b => b?.type === 'tool_use');

    if (pendingToolUse) {
      const toolUses = last.content.filter(b => b?.type === 'tool_use');
      // Zuerst prüfen, ob eine bestätigungspflichtige Aktion noch offen ist.
      for (const tu of toolUses) {
        if (needsConfirmation(tu.name, tu.input) && !approvals[tu.id]) {
          return { status: 'pending', pending: { id: tu.id, name: tu.name, input: tu.input, summary: summarize(tu.name, tu.input) }, messages };
        }
      }
      // Alle Tools auflösen (ausführen bzw. bei Ablehnung ein Ablehnungs-Result).
      const resultBlocks = [];
      for (const tu of toolUses) {
        if (needsConfirmation(tu.name, tu.input) && approvals[tu.id] === 'declined') {
          await logToolCall(user?.email, tu.name, tu.input, 'abgelehnt');
          resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Der Nutzer hat diese Aktion abgelehnt. Führe sie nicht aus und frage, wie es weitergehen soll.' });
          continue;
        }
        const out = await execTool(tu, user);
        resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, is_error: !!out.is_error });
      }
      messages.push({ role: 'user', content: resultBlocks });
      continue;
    }

    const resp = await callClaudeWithRetry({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason !== 'tool_use') {
      return { status: 'done', messages };
    }
    // nächste Iteration löst die tool_use-Blöcke auf
  }
  return { status: 'done', messages };
}

// ── Eingehende Nachrichten grob validieren (nur user/assistant, erlaubte Blöcke) ─
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (typeof m.content === 'string') { clean.push({ role: m.role, content: m.content }); continue; }
    if (Array.isArray(m.content)) {
      const blocks = m.content.filter(b => b && ['text', 'tool_use', 'tool_result'].includes(b.type));
      if (blocks.length) clean.push({ role: m.role, content: blocks });
    }
  }
  return clean;
}

router.post('/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY ist im Backend nicht gesetzt.' });
  }
  const messages = sanitizeMessages(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: 'Keine Nachrichten übergeben.' });

  const approvals = (req.body?.approvals && typeof req.body.approvals === 'object') ? req.body.approvals : {};

  try {
    const result = await runConversation({ messages, approvals, user: req.user });
    res.json(result);
  } catch (err) {
    console.error('[assistent] Fehler:', err);
    res.status(502).json({ error: 'Assistent-Fehler: ' + err.message });
  }
});

export default router;
