// Regression für die drei belegten Anrede-Fälle: pro Mail-Typ je ein Du- und ein
// Sie-Kunde rendern → GENAU EINE Begrüßung, durchgängig konsistente Form,
// korrekte Namensvariante (Du = Vorname, Sie = Titel + Nachname).
//
// Kein echter Versand: sendEntwurfsMail via renderOnly; Termin/Reminder über
// einen gemockten fetch, der die Resend-Payload abfängt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLeadingGreeting, startsWithGreeting } from '../anrede.js';
import { sendEntwurfsMail } from '../exports.js';
import { sendTerminEinladung, sendEntwurfReminder } from '../mail.js';

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-key';

const DU  = { anrede_form: 'du',  ansprechpartner: 'Nadine Bizjak', firmenname: 'Bizjak GmbH', agentur: 'talentone' };
const SIE = { anrede_form: 'sie', anrede_titel: 'herr', ansprechpartner: 'Uwe Junk', nachname: 'Junk', firmenname: 'Junk AG', agentur: 'talentone' };

// Alle Begrüßungen im HTML (Hallo … , oder Guten Tag).
function greetings(html) {
  return String(html).match(/(?:Hallo|Guten Tag)[^,<]*,/g) || [];
}

// Fängt die Resend-Payload eines Send-Aufrufs ab, ohne zu senden.
async function capture(sendFn) {
  const orig = global.fetch;
  let captured = null;
  global.fetch = async (_url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 'test' }), text: async () => '' };
  };
  try { await sendFn(); } finally { global.fetch = orig; }
  return captured;
}

/* ── Helfer selbst ── */
test('stripLeadingGreeting entfernt führende Grußzeile, lässt Body-Text unberührt', () => {
  assert.equal(stripLeadingGreeting('Hallo Nadine Bizjak,\n\nvor ein paar Tagen …'), 'vor ein paar Tagen …');
  assert.equal(stripLeadingGreeting('Guten Tag Herr Junk,\n\nText'), 'Text');
  assert.equal(stripLeadingGreeting('{{anrede}},\n\nText'), 'Text');
  assert.equal(stripLeadingGreeting('wir freuen uns …'), 'wir freuen uns …'); // ohne Gruß unverändert
  assert.equal(startsWithGreeting('Hallo X,'), true);
  assert.equal(startsWithGreeting('wir bereiten …'), false);
});

/* ── Fall (b): Termin-Einladung ── */
test('Termin-Einladung: genau eine Anrede, korrekte Namensform (Du/Sie)', async () => {
  const du = await capture(() => sendTerminEinladung({
    to: 'x@example.com', kunde: DU, agentur: 'talentone', subject: 'S', calLink: 'https://c',
    customText: 'Hallo Nadine Bizjak,\n\nwir haben deinen Termin vorbereitet.',
  }));
  assert.deepEqual(greetings(du.html), ['Hallo Nadine,']);         // genau eine, Vorname
  assert.ok(!du.html.includes('Hallo Nadine Bizjak,'));            // keine Vorname+Nachname bei Du

  const sie = await capture(() => sendTerminEinladung({
    to: 'x@example.com', kunde: SIE, agentur: 'talentone', subject: 'S', calLink: 'https://c',
    customText: 'Hallo Herr Junk,\n\nwir haben Ihren Termin vorbereitet.',
  }));
  assert.deepEqual(greetings(sie.html), ['Hallo Herr Junk,']);     // genau eine, Titel+Nachname
});

/* ── Fall (c): Entwurfs-Erinnerung ── */
test('Entwurfs-Erinnerung: genau eine Anrede, keine doppelte/inkonsistente Namensform', async () => {
  const du = await capture(() => sendEntwurfReminder({
    to: 'x@example.com', kunde: DU, agentur: 'talentone', reviewUrl: 'https://r',
    customText: 'Hallo Nadine Bizjak,\n\nvor ein paar Tagen haben wir dir die Entwürfe geschickt.',
  }));
  assert.deepEqual(greetings(du.html), ['Hallo Nadine,']);
  assert.ok(!du.html.includes('Hallo Nadine Bizjak,'));

  const sie = await capture(() => sendEntwurfReminder({
    to: 'x@example.com', kunde: SIE, agentur: 'talentone', reviewUrl: 'https://r',
    customText: 'Hallo Herr Junk,\n\nvor ein paar Tagen haben wir Ihnen die Entwürfe geschickt.',
  }));
  assert.deepEqual(greetings(sie.html), ['Hallo Herr Junk,']);
});

/* ── Fall (a): Entwürfe-Freigabe-Mail (Anschreiben mit eigener Grußzeile) ── */
test('Entwürfe-Mail: zentrale Anrede, Anschreiben-Grußzeile wird nicht doppelt', async () => {
  const outSie = await sendEntwurfsMail({
    to: 'x@example.com', betreff: 'B',
    anschreiben: 'Hallo Frau Rudolph,\n\nwir senden Ihnen die überarbeiteten Entwürfe.',
    job: { stelle: 'Anlagenmechaniker' }, kunde: SIE, creatives: [], adcopies: [],
    reviewUrl: 'https://r', renderOnly: true,
  });
  assert.deepEqual(greetings(outSie.html), ['Hallo Herr Junk,']);  // zentral, EINE Anrede
  assert.ok(!outSie.html.includes('Rudolph'));                     // mitgelieferte Gruß-Zeile entfernt

  const outDu = await sendEntwurfsMail({
    to: 'x@example.com', betreff: 'B',
    anschreiben: 'Hallo Nadine Bizjak,\n\nwir senden dir die Entwürfe.',
    job: { stelle: 'Anlagenmechaniker' }, kunde: DU, creatives: [], adcopies: [],
    reviewUrl: 'https://r', renderOnly: true,
  });
  assert.deepEqual(greetings(outDu.html), ['Hallo Nadine,']);
  assert.ok(!outDu.html.includes('Hallo Nadine Bizjak,'));
});
