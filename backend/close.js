// Close CRM Integration (Inside-Tool) — Best-effort, blockt niemals.
// Wird u.a. nach Reaktivierungs-Mail-Versand getriggert.

const CLOSE_API = 'https://api.close.com/api/v1';

let cachedUserMap = null; // name → id

function authHeader() {
  const token = Buffer.from(`${process.env.CLOSE_API_KEY}:`).toString('base64');
  return { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' };
}

async function closeFetch(path, options = {}) {
  const res = await fetch(`${CLOSE_API}${path}`, {
    ...options,
    headers: { ...authHeader(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Close ${options.method || 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Cached lookup of all org users → name→id map. */
export async function getUserIdByName(name) {
  if (!cachedUserMap) {
    const res = await closeFetch('/user/?_limit=100');
    cachedUserMap = {};
    for (const u of res.data || []) {
      const full = `${u.first_name || ''} ${u.last_name || ''}`.trim();
      if (full) cachedUserMap[full.toLowerCase()] = u.id;
    }
  }
  return cachedUserMap[(name || '').trim().toLowerCase()] || null;
}

/* ═══════════════ Close-Metadaten (fuer Lead-Mapping-Konfiguration) ═══════════════ */

/** Alle Org-User (fuer Task-Zuweisung). @returns [{id, name, email}] */
export async function listUsers() {
  const res = await closeFetch('/user/?_limit=100');
  return (res.data || []).map(u => ({
    id: u.id,
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
    email: u.email || null,
  }));
}

/** Lead-Custom-Fields inkl. Typ + Dropdown-Optionen. @returns [{id, name, type, choices}] */
export async function listLeadCustomFields() {
  const res = await closeFetch('/custom_field/lead/?_limit=100');
  return (res.data || []).map(f => ({
    id: f.id,                                  // cf_...
    key: `custom.${f.id}`,
    name: f.name,
    type: f.type,                              // text|choices|number|date|user|...
    choices: Array.isArray(f.choices) ? f.choices : [],
  }));
}

/** Lead-Status-Liste. @returns [{id, label}] */
export async function listLeadStatuses() {
  const res = await closeFetch('/status/lead/?_limit=100');
  return (res.data || []).map(s => ({ id: s.id, label: s.label }));
}

/** Sucht einen bestehenden Lead per Email ODER Telefon (Duplikat-Schutz). */
export async function findLeadByContact({ email, phone }) {
  if (email) {
    const res = await closeFetch(`/lead/?query=${encodeURIComponent('email:' + email)}&_limit=1`);
    if (res.data?.[0]) return res.data[0];
  }
  if (phone) {
    const digits = String(phone).replace(/[^\d+]/g, '');
    if (digits.length >= 6) {
      const res = await closeFetch(`/lead/?query=${encodeURIComponent(digits)}&_limit=1`);
      if (res.data?.[0]) return res.data[0];
    }
  }
  return null;
}

/**
 * Legt einen neuen Lead an. customFields = { 'custom.cf_...': value }.
 * @returns der angelegte Lead (inkl. id)
 */
export async function createLead({ name, contactName, email, phone, statusId, customFields = {} }) {
  const contact = { name: contactName || name || 'Lead' };
  if (email) contact.emails = [{ email, type: 'office' }];
  if (phone) contact.phones = [{ phone, type: 'office' }];
  const body = {
    name: name || contactName || 'Neuer Lead',
    contacts: [contact],
    ...(statusId ? { status_id: statusId } : {}),
    ...customFields,
  };
  return closeFetch('/lead/', { method: 'POST', body: JSON.stringify(body) });
}

/** Löscht einen Lead (fuer Test-Leads aufräumen). */
export async function deleteLead(leadId) {
  return closeFetch(`/lead/${leadId}/`, { method: 'DELETE' });
}

/** Aktualisiert einen Lead (z.B. Anzeige-Name). */
export async function updateLead(leadId, patch) {
  return closeFetch(`/lead/${leadId}/`, { method: 'PUT', body: JSON.stringify(patch) });
}

/** Aktualisiert einen Kontakt (Name/Telefon korrigieren). */
export async function updateContact(contactId, patch) {
  return closeFetch(`/contact/${contactId}/`, { method: 'PUT', body: JSON.stringify(patch) });
}

/** Findet einen Lead per Email — oder per ID wenn closeLeadId gegeben. */
export async function findLead({ closeLeadId, email }) {
  if (closeLeadId) {
    try { return await closeFetch(`/lead/${closeLeadId}/`); }
    catch (err) { console.warn('[Close] Lead per ID nicht gefunden:', err.message); }
  }
  if (email) {
    const res = await closeFetch(`/lead/?query=${encodeURIComponent('email:' + email)}`);
    return res.data?.[0] || null;
  }
  return null;
}

/** Legt eine Note am Lead an. */
export async function addNote({ leadId, note }) {
  return closeFetch('/activity/note/', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, note }),
  });
}

/** Legt einen Task am Lead an. `dueIso` = ISO-Date-String. */
export async function addTask({ leadId, text, assignedTo, dueIso }) {
  return closeFetch('/task/', {
    method: 'POST',
    body: JSON.stringify({
      lead_id: leadId,
      text,
      assigned_to: assignedTo || null,
      date: dueIso ? dueIso.slice(0, 10) : null,
    }),
  });
}

/**
 * Best-effort-Note für allgemeine Tool-Aktivitäten (Formular-Versand, Feedback,
 * Zahlungen, Go-Live etc.). Liest close_lead_id vom Kunden (primär), fällt
 * bei Bedarf auf projekte.close_lead_id oder Email-Suche zurück. Blockt nie
 * den aufrufenden Flow, loggt bei Misserfolg als warn.
 *
 * @param {object} kunde  — talentone_kunden-Zeile (mindestens close_lead_id oder email)
 * @param {string} noteText — der volle Notiz-Text (Emoji-Prefix nach Wunsch)
 * @returns {Promise<{ok: boolean, leadId?: string, error?: string}>}
 */
export async function notifyKunde(kunde, noteText) {
  if (!process.env.CLOSE_API_KEY) return { ok: false, error: 'CLOSE_API_KEY nicht gesetzt' };
  if (!kunde || !noteText) return { ok: false, error: 'kunde oder noteText fehlt' };
  const leadIdCandidate = kunde.close_lead_id;
  try {
    const lead = await findLead({
      closeLeadId: leadIdCandidate,
      email: !leadIdCandidate ? kunde.email : null,
    });
    if (!lead?.id) return { ok: false, error: `Kein Close-Lead gefunden (kunde=${kunde.id?.slice?.(0,8)})` };
    await addNote({ leadId: lead.id, note: noteText });
    return { ok: true, leadId: lead.id };
  } catch (err) {
    console.warn('[close/notifyKunde]', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Wie notifyKunde, aber lädt den Kunden selbst per ID nach.
 * Für Kontexte, in denen nur eine kunde_id verfügbar ist.
 */
export async function notifyKundeById(kundeId, noteText, supabaseClient) {
  if (!kundeId || !noteText || !supabaseClient) return { ok: false, error: 'Args fehlen' };
  try {
    const { data: kunde } = await supabaseClient
      .from('talentone_kunden')
      .select('id, close_lead_id, email')
      .eq('id', kundeId)
      .maybeSingle();
    if (!kunde) return { ok: false, error: 'Kunde nicht gefunden' };
    return await notifyKunde(kunde, noteText);
  } catch (err) {
    console.warn('[close/notifyKundeById]', err.message);
    return { ok: false, error: err.message };
  }
}

/** Convenience: Reaktivierungs-Task + Note kombiniert. */
export async function logReaktivierung({ leadIdOrEmail, kundenname, stelle, assignToName = 'Daniel Nowag' }) {
  if (!process.env.CLOSE_API_KEY) {
    console.warn('[Close] CLOSE_API_KEY nicht gesetzt — Reaktivierungs-Log übersprungen.');
    return null;
  }
  try {
    const lead = await findLead({ closeLeadId: leadIdOrEmail?.startsWith('lead_') ? leadIdOrEmail : null, email: leadIdOrEmail?.includes('@') ? leadIdOrEmail : null });
    if (!lead?.id) {
      console.warn('[Close] Kein Lead gefunden für Reaktivierung:', leadIdOrEmail);
      return null;
    }
    const assignedTo = await getUserIdByName(assignToName);
    const due = new Date(); due.setDate(due.getDate() + 7);
    await addNote({
      leadId: lead.id,
      note: `Reaktivierungs-Mail mit neuen KI-Creatives gesendet am ${new Date().toLocaleDateString('de-DE')} — Kunde: ${kundenname || '—'} · Stelle: ${stelle || '—'}`,
    });
    await addTask({
      leadId: lead.id,
      text: 'Reaktivierung: Hinterher telefonieren — neue Creatives wurden an Kunden geschickt',
      assignedTo,
      dueIso: due.toISOString(),
    });
    console.log(`[Close] Reaktivierung gelogged für Lead ${lead.id} (Task an ${assignToName})`);
    return { leadId: lead.id, assignedTo };
  } catch (err) {
    console.error('[Close] Reaktivierung fehlgeschlagen:', err.message);
    return null;
  }
}
