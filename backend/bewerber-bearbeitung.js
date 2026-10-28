// Abgeleiteter Bearbeitungsstatus eines Bewerbungs-Eingangs (Backend-Spiegel der
// Frontend-Kaskade in BewerberListe.jsx `bearbeitungStatus`). Erster Treffer gilt.
// „Eingestellt" = intern eingestellt='ja' ODER Kundenfeedback-Status 'eingestellt'.

// Rang der Stufen (für Dubletten: die weiteste Stufe einer Person gilt).
export const BEARB_RANK = { neu: 0, in_bearbeitung: 1, kontaktversuch: 2, vorqualifiziert: 3, vorgestellt: 4, vg: 5, eingestellt: 6 };

export function deriveBearbeitung(n, feedbackStatus, hatKommentar) {
  n = n || {};
  const av = Array.isArray(n.anrufversuche) ? n.anrufversuche.filter(a => a && a.datum) : [];
  if (n.eingestellt === 'ja' || feedbackStatus === 'eingestellt') return 'eingestellt';
  if (n.vg_vereinbart_am || feedbackStatus === 'vorstellungsgespraech') return 'vg';
  if (n.kunde_kontaktiert || (feedbackStatus && feedbackStatus !== 'neu')) return 'vorgestellt';
  if (n.nw_kontaktiert || av.some(a => a.erreicht === true || a.ergebnis === 'erreicht')) return 'vorqualifiziert';
  if (av.length > 0) return 'kontaktversuch';
  const ch = n.kriterien_check || {};
  const hatCheck = Object.values(ch).some(v => v === true || v === false);
  if (n.ampel || (n.notizen && String(n.notizen).trim()) || hatCheck || hatKommentar) return 'in_bearbeitung';
  return 'neu';
}
