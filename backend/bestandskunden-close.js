// Close-Steuerung für Bestandskunden: Lead-Matching + Task-Lebenszyklus.
// „Angehen" + Zuweisung legt einen „Altkunde"-Task am Lead an. Alle Close-Aufrufe
// defensiv — Fehler blockieren nie das Speichern im Tool (Aufrufer zeigt Warnung).

import { supabase } from './supabase.js';
import { searchLeads, createLead, addTask, updateTask, deleteTask } from './close.js';
import { normFirma } from './bestandskunden-sync.js';

const eur = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} €`;

function taskText(kunde) {
  const mm = kunde.letzte_rechnung
    ? new Date(kunde.letzte_rechnung).toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' })
    : '—';
  let t = `Altkunde — letzte Rechnung ${mm}, ${kunde.anzahl_rechnungen || 0} Rechnungen, ${eur(kunde.umsatz_netto)} netto gesamt.`;
  if (kunde.notiz && kunde.notiz.trim()) t += `\n\n${kunde.notiz.trim()}`;
  return t;
}

/** Lead-Kandidaten für einen Kunden (Firma + frühere Bezeichnung). */
export async function findLeadCandidates(kunde) {
  if (!process.env.CLOSE_API_KEY) return { ok: false, error: 'CLOSE_API_KEY nicht gesetzt' };
  const namen = [kunde.firma, kunde.fruehere_bezeichnung].filter(Boolean);
  const seen = new Set();
  const candidates = [];
  for (const n of namen) {
    let leads = [];
    try { leads = await searchLeads(n, 8); }
    catch (e) { return { ok: false, error: e.message }; }
    for (const l of leads) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      candidates.push({ id: l.id, name: l.display_name || l.name || '(ohne Name)' });
    }
  }
  const nf = new Set(namen.map(normFirma));
  const exact = candidates.filter(c => nf.has(normFirma(c.name)));
  return { ok: true, candidates, exact };
}

/** Lead sicherstellen: vorhandene ID > eindeutiger Match > anlegen; sonst Kandidaten. */
async function ensureLead(kunde) {
  if (kunde.close_lead_id) return { leadId: kunde.close_lead_id };
  const res = await findLeadCandidates(kunde);
  if (!res.ok) throw new Error(res.error);
  if (res.exact.length === 1) return { leadId: res.exact[0].id };
  if (res.candidates.length === 0) {
    const lead = await createLead({
      name: kunde.firma,
      contactName: kunde.ansprechpartner || kunde.firma,
      phone: kunde.telefon || null,
      email: kunde.email || null,
    });
    return { leadId: lead.id, created: true };
  }
  if (res.candidates.length === 1) return { leadId: res.candidates[0].id };
  return { candidates: res.candidates }; // mehrdeutig → Frontend fragt
}

async function reload(kundeId) {
  const { data } = await supabase.from('talentone_bk_kunden_uebersicht').select('*').eq('id', kundeId).maybeSingle();
  return data;
}

/**
 * Reconciled den Close-Zustand nach einer Änderung an reaktivierung/zustaendig/notiz.
 * @returns {Promise<{kunde, close_warnung?, needs_lead_choice?, candidates?}>}
 */
export async function applyCloseTaskState(kundeId) {
  const kunde = await reload(kundeId);
  if (!kunde) return { kunde: null, close_warnung: 'Kunde nicht gefunden.' };
  if (!process.env.CLOSE_API_KEY) return { kunde, close_warnung: 'CLOSE_API_KEY nicht gesetzt — Task nicht synchronisiert.' };

  const willTask = kunde.reaktivierung === 'angehen' && !!kunde.zustaendig_close_user_id;

  try {
    // Kein Task gewünscht (offen/verbrannt oder keine Zuweisung) → offenen Task löschen.
    if (!willTask) {
      if (kunde.close_task_id && kunde.close_task_status === 'offen') {
        try { await deleteTask(kunde.close_task_id); }
        catch (e) { if (!/→ 404/.test(e.message)) throw e; }
        await supabase.from('talentone_bk_kunden')
          .update({ close_task_id: null, close_task_status: 'kein_task', updated_at: new Date().toISOString() })
          .eq('id', kundeId);
      }
      return { kunde: await reload(kundeId) };
    }

    // Task gewünscht → Lead sicherstellen.
    let leadId = kunde.close_lead_id;
    if (!leadId) {
      const r = await ensureLead(kunde);
      if (r.candidates) return { kunde, needs_lead_choice: true, candidates: r.candidates };
      leadId = r.leadId;
      await supabase.from('talentone_bk_kunden').update({ close_lead_id: leadId, updated_at: new Date().toISOString() }).eq('id', kundeId);
      kunde.close_lead_id = leadId;
    }

    const text = taskText(kunde);
    const due = new Date(); due.setDate(due.getDate() + 1);
    const dueIso = due.toISOString();

    if (kunde.close_task_id && kunde.close_task_status === 'offen') {
      // Bestehenden offenen Task umhängen / Text aktualisieren (nie löschen+neu).
      await updateTask(kunde.close_task_id, {
        assigned_to: kunde.zustaendig_close_user_id, text, date: dueIso.slice(0, 10),
      });
    } else {
      // Kein offener Task (kein_task ODER erledigt) → neuen anlegen. Erledigte bleiben unberührt.
      const task = await addTask({ leadId, text, assignedTo: kunde.zustaendig_close_user_id, dueIso });
      await supabase.from('talentone_bk_kunden')
        .update({ close_task_id: task.id, close_task_status: 'offen', updated_at: new Date().toISOString() })
        .eq('id', kundeId);
    }
    return { kunde: await reload(kundeId) };
  } catch (err) {
    console.warn('[bk-close] applyCloseTaskState:', err.message);
    return { kunde: await reload(kundeId), close_warnung: `Close-Sync fehlgeschlagen: ${err.message}` };
  }
}
