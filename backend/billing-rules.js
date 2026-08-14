// Abrechnungsregel für den monatlichen Lauf (Phase 5 Nachtrag).
//
// Entscheidet für einen Servicezeitraum, WAS in Rechnung gestellt wird.
// Rein-funktional — keine DB-Aufrufe, keine Zeit-globals — damit die Regel
// vollständig per Unit-Tests belegbar ist.
//
// Actions:
//   'bill_full'                    → Service-Pauschale + (TalentOne) Werbebudget
//   'bill_budget_only'             → nur Werbebudget-Position + Servicefrei-Hinweis
//                                    (nur TalentOne, max 1× im Kampagnenverlauf)
//   'skip_and_wait_first_hire'     → N&W: gar keine Rechnung; wartet auf 1. Einstellung
//   'skip_manual_reactivation'     → TalentOne: max servicefrei erreicht,
//                                    Team muss manuell reaktivieren
//   'skip_service_waived'          → manueller Kulanz-Schalter aktiv
//   'skip_campaign_ended'          → Abo beendet
//   'skip_billing_paused'          → Team hat den Lauf pausiert
//
// Der Cron muss NUR die Regel anwenden, den Skip-Log schreiben und im
// bill_-Fall runMonthlyBillingForOffer aufrufen.

/**
 * @param {object} offer  Row aus talentone_offers
 * @param {object} ctx    Aufruf-Kontext
 * @param {Date}   ctx.today                       Rechnungslauf-Tag
 * @param {boolean} ctx.hasHire                    gibt es min. eine Einstellung?
 * @param {number} ctx.serviceFreeMonthsUsed       Anzahl bisher servicefreier
 *                                                 Monate (aus billing_skip_log)
 * @returns {{ action:string, reason:string, meta?:object }}
 */
export function evaluateMonthlyBilling(offer, ctx) {
  const today = ctx.today || new Date();

  // Extern (direkt in easybill) abgerechnet — das Tool stellt nichts in Rechnung.
  if (offer.billing_external_at) {
    return { action: 'skip_external_billing', reason: 'external_billing' };
  }
  if (offer.billing_ended_at) {
    return { action: 'skip_campaign_ended', reason: 'campaign_ended' };
  }
  if (offer.billing_paused_at) {
    // Bedeutet: TalentOne max_month_reached wurde in einem vorherigen Lauf
    // gesetzt. Der Cron ruft danach nicht mehr, außer das Team reaktiviert.
    return { action: 'skip_billing_paused', reason: 'billing_paused',
             meta: { pause_reason: offer.billing_pause_reason } };
  }
  if (offer.service_waived_override) {
    return { action: 'skip_service_waived', reason: 'service_waived_override' };
  }

  const hasHire = !!ctx.hasHire;
  if (hasHire) return { action: 'bill_full', reason: 'hire_registered' };

  // Innerhalb der Garantiefrist?
  if (offer.campaign_started_at) {
    const start = new Date(offer.campaign_started_at);
    const cutoff = addDays(start, Number(offer.guarantee_period_days) || 30);
    if (today <= cutoff) {
      return { action: 'bill_full', reason: 'within_guarantee' };
    }
  }

  // Frist abgelaufen ohne Einstellung
  if (offer.brand === 'nowag_wirth') {
    return { action: 'skip_and_wait_first_hire', reason: 'guarantee_no_hire' };
  }
  // TalentOne: max 1× servicefrei
  const usedFreeMonths = Math.max(0, Number(ctx.serviceFreeMonthsUsed) || 0);
  if (usedFreeMonths === 0) {
    return { action: 'bill_budget_only',
             reason: 'guarantee_no_hire',
             meta: { budget_note: 'Servicepauschale entfällt in diesem Monat gemäß Bewerbungsgarantie.' } };
  }
  return { action: 'skip_manual_reactivation', reason: 'talentone_max_month_reached' };
}

/**
 * Nach der ersten Einstellung: falls Abo pausiert wurde (TalentOne max),
 * darf die Einstellungs-Erfassung nicht automatisch reaktivieren — der User
 * muss den Reaktivierungs-Button drücken. Aber der Pause-Grund fällt weg,
 * wenn nach einer Einstellung wieder abgerechnet wird. Der Cron entscheidet
 * das später — dieses Modul liefert nur den Regel-Entscheid.
 */

/** Fügt Tage zu einem Datum hinzu (ohne Zeit-Anteil). */
function addDays(from, days) {
  const d = new Date(from);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

/** Wählt den Body-Key für die Einstellungs-Mail. */
export function pickHireMailBodyKey({ hiresBefore, hiresTarget }) {
  const now = Number(hiresBefore) + 1;
  const target = Math.max(1, Number(hiresTarget) || 1);
  if (target === 1) return 'hire_email_body_complete'; // Randfall: Ziel bereits mit 1. Einstellung erreicht
  if (now === 1)         return 'hire_email_body_first';
  if (now >= target)     return 'hire_email_body_complete';
  return 'hire_email_body_progress';
}

/**
 * Löst den {{abrechnung_hinweis}}-Merge-Tag auf:
 *   - Einstellung innerhalb der Garantiefrist  →   "Ihre monatliche Betreuung läuft unverändert weiter."
 *   - Einstellung nach servicefreier Phase     →   "Ab {{naechster_monat}} wird … wieder regulär …"
 *
 * @param {object} offer
 * @param {object} ctx
 * @param {Date} ctx.hireDate
 * @param {number} ctx.serviceFreeMonthsUsed
 * @param {string} [ctx.naechster_monat] Formatiertes Datum (z.B. '01.08.2026')
 */
export function resolveAbrechnungsHinweis(offer, ctx) {
  const hireDate = ctx.hireDate || new Date();
  const start = offer.campaign_started_at ? new Date(offer.campaign_started_at) : null;
  const days = Number(offer.guarantee_period_days) || 30;
  const withinGuarantee = start && hireDate <= addDays(start, days);
  const wasServiceFree  = Number(ctx.serviceFreeMonthsUsed) > 0;

  if (withinGuarantee && !wasServiceFree) {
    return 'Ihre monatliche Betreuung läuft unverändert weiter.';
  }
  const monatLabel = ctx.naechster_monat || 'dem nächsten regulären Monatslauf';
  return `Ab ${monatLabel} wird die monatliche Betreuung wieder regulär berechnet — die servicefreien Monate während der Garantiephase bleiben selbstverständlich unberechnet.`;
}
