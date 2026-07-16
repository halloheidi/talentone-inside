// KI-Foto-Verbesserung fuer Referenzbilder. Multi-Option: der User kann
// mehrere Verbesserungen kombinieren (Qualitaet + Hintergrund + Ausschnitt).
// Nutzt gpt-image-2 /edits.
//
// Regel: Gesichter und Personen werden NIE veraendert (keine Beautify).
// Nur die Umgebung/Qualitaet/Komposition wird verbessert. Authentizitaet
// ist das Verkaufsargument der Fotos.

import { fetchAsBuffer, uploadBuffer, safeFilenameStem } from './storage.js';
import { supabase } from './supabase.js';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const OPENAI_EDITS_API = 'https://api.openai.com/v1/images/edits';
const FALLBACK_BUCKET = 'talentone-refphotos';

/** Prompt-Fragmente pro Option. Werden mit den globalen Constraint-Zeilen
 *  am Anfang/Ende zusammengefuegt. */
const OPTION_LABELS = {
  qualitaet:     'Qualität aufpolieren',
  hg_aufraeumen: 'Hintergrund aufräumen',
  hg_ersetzen:   'Hintergrund komplett ersetzen',
  ausschnitt:    'Ausschnitt & Perspektive optimieren',
  atmosphaere:   'Atmosphäre & Look',
};

const OPTION_PROMPTS = {
  qualitaet:
    '- Qualitaet: gleichmaessige Beleuchtung, ausgewogener Kontrast, natuerliche Farben, ' +
    'mehr Schaerfe, weniger Bildrauschen, professionelle Fototechnik.',
  hg_aufraeumen:
    '- Hintergrund aufraeumen: unruhige, chaotische oder unaufgeraeumte Bereiche im ' +
    'Hintergrund beruhigen oder dezent gegen einen aufgeraeumten, zur Szene passenden ' +
    'Hintergrund tauschen (z.B. Werkstatt-Chaos -> geordnete Werkstatt derselben Branche). ' +
    'Die urspruengliche Umgebung bleibt vom Charakter her erkennbar.',
  hg_ersetzen:
    (s) =>
      `- Hintergrund komplett ersetzen: Personen freistellen und in ein neues Setting stellen. ` +
      `Neues Setting: ${s.hintergrund_setting || 'moderne, zur Branche passende Umgebung mit weichem Tageslicht'}. ` +
      `Der Uebergang muss natuerlich wirken (gleiche Lichtstimmung, konsistenter Schattenwurf, ` +
      `identische Perspektive der Personen).`,
  ausschnitt:
    '- Ausschnitt/Perspektive optimieren: besseren Bildausschnitt waehlen, schiefe Horizonte ' +
    'begradigen, stoerende Randobjekte entfernen. Personen bleiben im Zentrum und komplett ' +
    'im Bild — nichts wird angeschnitten.',
  atmosphaere:
    (s) =>
      `- Atmosphaere & Look (KINOREIFER MACHEN): Veraendere AUSSCHLIESSLICH Licht, Farbe, Himmel ` +
      `und Bildstimmung — der gesamte Bildinhalt bleibt exakt gleich. ` +
      `Warmes, goldenes Licht (Richtung golden hour), weichere Schatten, mehr Tiefe im Bild. ` +
      `Himmel dramatischer und interessanter gestalten (statt ausgewaschen weiss-grau) — ` +
      `nur die Himmelsflaeche, keine neuen Objekte. ` +
      `Farbtiefe und Kontrast-Grading wie bei professioneller Werbefotografie. ` +
      `Leichte Tiefenwirkung/Fokus-Fuehrung auf die Personen bzw. die Aktion. ` +
      `WICHTIG: KEINE Personen, Gesichter, Kleidung, Objekte, Szene oder Bildausschnitt veraendern, ` +
      `nichts hinzufuegen oder entfernen — es aendert sich nur Licht, Farbe, Himmel und Stimmung.` +
      (s.atmosphaere_setting ? ` Gewuenschte Stimmung: ${s.atmosphaere_setting}.` : ''),
};

function buildPrompt(optionen, settings = {}) {
  const uniq = Array.from(new Set((optionen || []).filter(k => OPTION_PROMPTS[k])));
  if (!uniq.length) throw new Error('Mindestens eine Verbesserungs-Option waehlen.');
  const zeilen = uniq.map(k => {
    const v = OPTION_PROMPTS[k];
    return typeof v === 'function' ? v(settings) : v;
  }).join('\n');
  return (
    `Bearbeite dieses Foto in mehreren Schritten und liefere EIN einziges Ergebnisbild:\n${zeilen}\n\n` +
    `HARTE REGELN (nicht verletzen):\n` +
    `1. Gesichter, Frisur, Statur, Hauttyp und Alter der Personen bleiben absolut identisch — ` +
    `KEINE Beautify-Retusche, KEINE geglaettete Haut, KEINE veraenderten Gesichtszuege.\n` +
    `2. Kleidung, Werkzeuge und Kernobjekte in den Haenden bleiben unveraendert.\n` +
    `3. Foege KEINE neuen Personen hinzu, entferne keine.\n` +
    `4. Das Ergebnis muss authentisch wirken — kein glossy KI-Look.`
  );
}

function bufferToFile(buf, name, contentType) {
  return new File([buf], name, { type: contentType });
}

/**
 * Generiert eine verbesserte Version + laedt sie in Storage hoch, aber
 * legt KEINE Referenzbild-Row an. Rueckgabe: {preview_url, angewendete_optionen, prompt}.
 *
 * @param {object} p
 * @param {string} p.referenzbildId
 * @param {string[]} p.optionen  z.B. ['qualitaet', 'hg_aufraeumen', 'atmosphaere']
 * @param {string} [p.hintergrund_setting]  nur bei 'hg_ersetzen'
 * @param {string} [p.atmosphaere_setting]  optionale Stimmung, nur bei 'atmosphaere'
 */
export async function generateVerbesserung({ referenzbildId, optionen, hintergrund_setting, atmosphaere_setting }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');

  const { data: original, error: eGet } = await supabase.from('talentone_referenzbilder')
    .select('*').eq('id', referenzbildId).maybeSingle();
  if (eGet || !original) throw new Error('Referenzbild nicht gefunden.');
  if (original.verbessert_von) {
    // Man kann auch verbesserte Versionen erneut verbessern (Kette),
    // aber der Prompt basiert dann auf der letzten Version.
  }
  if (!original.bild_url) throw new Error('Original hat keine bild_url.');

  const { data: kunde } = await supabase.from('talentone_kunden')
    .select('id, keine_ki_bilder').eq('id', original.kunde_id).maybeSingle();
  if (kunde?.keine_ki_bilder) {
    throw new Error('Kunde hat KI-Bildbearbeitung deaktiviert (keine_ki_bilder=true).');
  }

  const prompt = buildPrompt(optionen, { hintergrund_setting, atmosphaere_setting });
  const { buffer } = await fetchAsBuffer(original.bild_url);

  // OpenAI /images/edits akzeptiert nur PNG/JPEG/WebP in RGB, <50MB, max 4096px.
  // Referenzbilder koennen HEIC (iPhone), CMYK-JPEGs oder sehr gross sein und werden
  // dann mit "invalid_image_file" abgelehnt. Deshalb vor dem Call per Sharp normalisieren:
  // EXIF-Rotation anwenden, nach sRGB konvertieren, auf max 2048px verkleinern, als PNG re-encoden.
  let pngBuffer;
  try {
    pngBuffer = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .toColourspace('srgb')
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (e) {
    throw new Error(`Bild konnte nicht verarbeitet werden (nicht unterstuetztes Format, z.B. HEIC?): ${e.message}`);
  }

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('image[]', bufferToFile(pngBuffer, 'original.png', 'image/png'));

  const response = await fetch(OPENAI_EDITS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 400)}`);
  }
  const json = await response.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: kein b64_json in der Response.');
  const outBuffer = Buffer.from(b64, 'base64');

  // Upload in gleichen Bucket wie Original (Preview-Datei — Cleanup optional).
  const marker = '/storage/v1/object/public/';
  const idx = original.bild_url.indexOf(marker);
  const bucketAndPath = idx >= 0
    ? original.bild_url.slice(idx + marker.length)
    : `${FALLBACK_BUCKET}/${original.kunde_id}/fallback.png`;
  const bucket = bucketAndPath.split('/')[0];
  const stem = safeFilenameStem(original.label || 'foto');
  const previewPath = `${original.kunde_id}/preview-${Date.now()}-${randomUUID().slice(0, 6)}-${stem}.png`;
  const preview_url = await uploadBuffer({
    bucket, path: previewPath, buffer: outBuffer, contentType: 'image/png',
  });
  return { preview_url, angewendete_optionen: Array.from(new Set(optionen)), prompt, original };
}

/**
 * Persistiert eine vorher generierte Preview als neue Referenzbild-Row
 * (Original bleibt unberuehrt). Wird aufgerufen wenn der User im Modal
 * "Speichern" klickt.
 */
export async function saveVerbesserung({ referenzbildId, preview_url, angewendete_optionen }) {
  const { data: original } = await supabase.from('talentone_referenzbilder')
    .select('*').eq('id', referenzbildId).maybeSingle();
  if (!original) throw new Error('Original nicht gefunden.');

  const angewendetLabel = (angewendete_optionen || [])
    .map(k => OPTION_LABELS[k]).filter(Boolean).join(' + ') || '✨';

  const insertPayload = {
    kunde_id: original.kunde_id,
    bild_url: preview_url,
    typ: original.typ || 'foto',
    label: `${original.label || 'Foto'} · ✨ ${angewendetLabel}`,
    beschreibung: original.beschreibung || null,
    uploaded_via: 'ai_enhance',
    verbessert_von: original.id,
    verbesserungs_optionen: angewendete_optionen || [],
  };
  const { data: neu, error } = await supabase
    .from('talentone_referenzbilder').insert(insertPayload).select().single();
  if (error) throw new Error(`Insert fehlgeschlagen: ${error.message}`);
  return neu;
}

export const OPTION_LABEL_MAP = OPTION_LABELS;
