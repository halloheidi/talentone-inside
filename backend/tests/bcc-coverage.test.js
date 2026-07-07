// Statischer Audit: alle kundengerichteten Mail-Funktionen in mail.js MÜSSEN
// getInternalBcc verwenden. Rein-lokal, kein SMTP-Call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIL_JS = readFileSync(join(HERE, '..', 'mail.js'), 'utf8');

// Alle kundengerichteten Send-Funktionen — bewusst hardcoded, damit ein neu
// hinzugefügter Sender explizit hier eingetragen werden muss.
const CUSTOMER_FACING = [
  'sendUploadAnfrage',
  'sendFormularEinladung',
  'sendZahlungsMail',
  'sendRechnungsMail',       // PayPal-Zahlungslink-Mail (Alt-Flow)
  'sendReaktivierungsMail',
  'sendKampagneLiveMail',
  'sendAngebotMail',
  'sendAuftragMail',
  'sendRechnungMail',        // neue Standalone-/Setup-Mail (Migration 013)
  'sendEinstellungsMail',
  'sendErinnerungsMail',
];

// Team-Notifications und interne Mails — GARANTIERT ohne BCC. Werden hier
// gelistet, damit ein Umbau (z. B. „doch an Kunden schicken") den Test bricht.
const INTERNAL_ONLY = [
  'sendFormularEingang',       // → NOTIFICATION_EMAILS
  'sendReviewBenachrichtigung', // → sendInternalNotification
  'sendMentionMail',            // → an erwähnten Kollegen intern
];

// Extrahiert den Text-Bereich einer Funktion — vom `export async function
// <name>` bis zum nächsten `export ` (oder Datei-Ende). Robust gegen Template-
// Literale, weil wir nur nach Textmarkern suchen, nicht Klammern balancieren.
function extractFunctionBody(source, name) {
  const openRe = new RegExp(`export async function ${name}\\s*\\(`, 'g');
  const m = openRe.exec(source);
  if (!m) return null;
  const rest = source.slice(m.index + 1);
  const nextExport = rest.search(/\nexport (async )?function |\nexport (const|function|let|var) /);
  const stopAt = nextExport === -1 ? rest.length : nextExport;
  return rest.slice(0, stopAt);
}

test('Alle kundengerichteten Mail-Funktionen setzen getInternalBcc', () => {
  const missing = [];
  for (const name of CUSTOMER_FACING) {
    const body = extractFunctionBody(MAIL_JS, name);
    if (!body) {
      missing.push(`${name}: nicht gefunden in mail.js`);
      continue;
    }
    if (!/getInternalBcc\s*\(/.test(body)) {
      missing.push(`${name}: kein getInternalBcc-Aufruf`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('Interne Team-Mails setzen explizit KEIN getInternalBcc', () => {
  const misapplied = [];
  for (const name of INTERNAL_ONLY) {
    const body = extractFunctionBody(MAIL_JS, name);
    if (!body) continue; // OK — kann optional entfernt werden
    if (/getInternalBcc\s*\(/.test(body)) {
      misapplied.push(`${name}: interne Mail sollte KEIN getInternalBcc setzen`);
    }
  }
  assert.deepEqual(misapplied, [], misapplied.join('\n'));
});

test('getInternalBcc-Default enthält info@nowagwirth.de', () => {
  const fnMatch = MAIL_JS.match(/export function getInternalBcc[\s\S]*?(?=\nexport|\n\/\*|\n\}\n)/);
  assert.ok(fnMatch, 'getInternalBcc-Signatur nicht gefunden');
  // Fallback-Liste — hier ist info@nowagwirth.de hart hinterlegt (Sicherheit,
  // falls INTERNAL_BCC-Env-Var fehlt).
  assert.match(fnMatch[0], /info@nowagwirth\.de/);
});
