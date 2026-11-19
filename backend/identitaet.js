// Neutrale Identität einer anonymen Stelle.
// Eine Stelle kann über talentone_jobs.anonym eine eigene Identität (Name/Logo/Farben) tragen,
// die statt der echten Kundenidentität überall gerendert wird, wo Kandidaten oder Kunde etwas
// sehen (Funnel, Creatives, Ad-Copies, Prüfungsseite). Der Normalfall (anonym NULL) liefert
// unverändert den echten Kunden.

export function anonymAktiv(job) {
  return !!(job && job.anonym && job.anonym.aktiv);
}

// kunde-ähnliches Objekt: bei anonymer Stelle mit neutraler Identität überschrieben, sonst der
// echte Kunde unverändert. Fehlt bei aktiver Anonymität ein Feld (z. B. kein Logo hochgeladen),
// wird NEUTRALISIERT (null), niemals auf den echten Kunden zurückgefallen — Leak-Schutz.
export function identitaet(job, kunde) {
  if (!anonymAktiv(job)) return kunde;
  const a = job.anonym || {};
  return {
    ...kunde,
    firmenname: a.name || 'Unternehmen',
    logo_url: a.logo_url ?? null,
    logo_transparent_url: a.logo_transparent_url ?? null,
    logo_uploaded_at: a.logo_uploaded_at ?? null,
    farben: a.farben || null,
    branche: a.branche || null,
    website_domain: null,
    website_url: null,
    perspective_brand_id: a.perspective_brand_id ?? null,
    // Echte Kunden-PII niemals am neutralen Identitätsobjekt mitschleppen — sonst
    // leakt sie, sobald ein (künftiger) kandidatensichtbarer Renderer eines dieser
    // Felder liest. Für den anonymen Absender steht absenderName() bereit.
    ansprechpartner: a.absender_name || null,
    nachname: null,
    vorname: null,
    email: null,
    telefon: null,
    // Marker für Hard-Stop / Badges (nicht kandidatensichtbar):
    _anonym: true,
    _echter_firmenname: kunde?.firmenname || '',
    _echtes_logo_url: kunde?.logo_url || '',
  };
}

// Kandidatensichtbarer Ort: bei anonymer Stelle optionaler Anzeige-Ort statt der echten Region.
export function anzeigeOrt(job) {
  if (anonymAktiv(job) && job.anonym?.ort_anzeige) return job.anonym.ort_anzeige;
  return job?.region || '';
}

// Absendername für kandidaten-/kundengerichtete Mails (falls anonym mit eigenem Absender).
export function absenderName(job, fallback) {
  if (anonymAktiv(job) && job.anonym?.absender_name) return job.anonym.absender_name;
  return fallback;
}

/* ── Hard-Stop: echte Kundenidentität in kandidatensichtbaren Inhalten erkennen ── */

const LEAK_STOP = new Set([
  'gmbh', 'mbh', 'gmbh&co', 'co', 'kg', 'ohg', 'ug', 'ag', 'kgaa', 'gbr', 'ev',
  'und', 'der', 'die', 'das', 'mit', 'für', 'von', 'the',
]);

// Distinktive Tokens der ECHTEN Identität, die in anonymen Inhalten nicht auftauchen dürfen:
// Firmenname (+ Einzelwörter), Ansprechpartner-Name, Website-Domain.
export function identitaetsTokens(kundeEcht) {
  const toks = new Set();
  const addWords = (s) => {
    if (!s) return;
    const full = String(s).trim().toLowerCase();
    if (full.length >= 4) toks.add(full);
    for (const w of full.split(/[^a-zäöüß0-9]+/i)) {
      const wl = w.toLowerCase();
      if (wl.length >= 4 && !LEAK_STOP.has(wl)) toks.add(wl);
    }
  };
  addWords(kundeEcht?.firmenname);
  addWords(kundeEcht?.ansprechpartner);
  const dom = String(kundeEcht?.website_domain || kundeEcht?.website_url || '')
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
  if (dom.length >= 4) {
    toks.add(dom);
    const base = dom.split('.')[0];
    if (base.length >= 4 && !LEAK_STOP.has(base)) toks.add(base);
  }
  return [...toks];
}

// Gibt die gefundenen Identitäts-Tokens zurück (leer = kein Leak).
export function findeLeaks(texte, tokens) {
  const hay = (texte || []).filter(Boolean).map(String).join(' \n ').toLowerCase();
  const hits = new Set();
  for (const t of tokens) { if (t && hay.includes(t)) hits.add(t); }
  return [...hits];
}
