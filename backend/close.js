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
