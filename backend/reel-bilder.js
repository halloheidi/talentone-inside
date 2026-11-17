// Reel-Modul Schritt 2: Motiv-Bilder via OpenAI gpt-image-2 (Edits-Pfad mit Referenzen).
// Bewusst eigener, schlanker Pfad (nicht generateOneCreative), weil hier Prompt = Master + Motiv
// gilt und KEINE Creative-Overlays/Logo-Einbrennung erwünscht sind. Spiegelt aber exakt den
// bewährten gpt-image-2-Aufruf aus imagegen.js (Referenzen via normalizeImageForOpenAI).

import { fetchAsBuffer, uploadBuffer } from './storage.js';
import { normalizeImageForOpenAI } from './imageops.js';
import { STORAGE_BUCKET } from './imagegen.js';
import { STIL_BLOCK, IMG_BREITE, IMG_HOEHE } from './reel-config.js';

const OPENAI_IMAGES_API = 'https://api.openai.com/v1/images/generations';
const OPENAI_EDITS_API = 'https://api.openai.com/v1/images/edits';
const SIZE = `${IMG_BREITE}x${IMG_HOEHE}`; // 1024x1536

function bufferToFile(buf, name, type) {
  return new File([buf], name, { type });
}

// Referenzen: [{url, rolle:'logo'|'person'|'fahrzeug'|'gebaeude'|'ref'}]
async function ladeRefs(referenzen) {
  const out = [];
  for (const ref of referenzen) {
    if (!ref?.url) continue;
    let roh;
    try {
      roh = await fetchAsBuffer(ref.url);
    } catch (err) {
      console.warn(`[reel-ref] ${ref.url}: ${err.message}`);
      continue;
    }
    const norm = await normalizeImageForOpenAI(roh.buffer, { label: ref.rolle || 'Referenz' });
    out.push({ buffer: norm.buffer, contentType: norm.contentType, ext: norm.ext, rolle: ref.rolle || 'ref' });
  }
  return out;
}

export function buildBildPrompt({ masterPrompt, motiv, stil }) {
  return [
    masterPrompt || '',
    `Motiv: ${motiv?.prompt || motiv?.titel || ''}`,
    `Stil: ${STIL_BLOCK[stil] || STIL_BLOCK.foto}`,
    'Format: Hochformat 2:3, Hauptmotiv mittig, seitlich Luft. Kein Text außer Logo/Fahrzeugbeschriftung, keine Wasserzeichen, keine Grafikelemente.',
  ].filter(Boolean).join('\n\n');
}

// Erzeugt ein Motiv-Bild (1024×1536, high) und lädt es in den Creatives-Bucket.
// Rückgabe: { url, prompt }.
export async function generateMotivBild({ reelId, motivNr, masterPrompt, motiv, stil, referenzen = [] }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY nicht gesetzt.');
  const prompt = buildBildPrompt({ masterPrompt, motiv, stil });
  const refs = await ladeRefs(referenzen);

  let response;
  if (refs.length > 0) {
    // Logo zuerst (Prompt referenziert die Reihenfolge), Rest dahinter.
    const rang = (r) => (r.rolle === 'logo' ? 0 : 1);
    refs.sort((a, b) => rang(a) - rang(b));
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', SIZE);
    form.append('quality', 'high');
    form.append('n', '1');
    refs.forEach((r) => {
      const fn = r.rolle === 'logo' ? `firmenlogo.${r.ext}`
        : r.rolle === 'person' ? `person.${r.ext}`
        : r.rolle === 'fahrzeug' ? `fahrzeug.${r.ext}`
        : r.rolle === 'gebaeude' ? `gebaeude.${r.ext}`
        : `referenz.${r.ext}`;
      form.append('image[]', bufferToFile(r.buffer, fn, r.contentType));
    });
    console.log(`[reel-bild] motiv=${motivNr} refs=[${refs.map((r) => r.rolle).join(', ')}]`);
    response = await fetch(OPENAI_EDITS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    response = await fetch(OPENAI_IMAGES_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2', prompt, size: SIZE, quality: 'high', n: 1 }),
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 400)}`);
  }
  const data = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI: keine Bild-Daten in Response.');

  const buffer = Buffer.from(b64, 'base64');
  const path = `reels/${reelId}/motiv-${motivNr}-${Date.now()}.png`;
  const url = await uploadBuffer({ bucket: STORAGE_BUCKET, path, buffer, contentType: 'image/png' });
  return { url, prompt };
}
