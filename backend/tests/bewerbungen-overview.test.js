// Regressionstest zum Oktober-26-Vorfall:
//
// Die globale Bewerber-Overview (/api/bewerbungen) hat ihre `notizen` / `feedback`-
// Maps mit einem einzelnen `supabase.from(...).select().in('bewerbung_id', ids)`
// gebaut. Bei >~200 Bewerbungen (hier real 408) übersteigt die resultierende
// GET-URL die PostgREST-/Nginx-URL-Limits und liefert ein leeres Datenset. Die
// Overview rendert dann für JEDE Zeile Default-Werte: Status "Neu", 0 Anrufe,
// Sterne leer, Ampel grau — obwohl 276 Rows in talentone_bewerber_notizen stehen.
//
// Fix: `fetchChildrenByBewerbungIds` lädt die Child-Rows in Chunks von 100 IDs.
// Dieser Test sichert zwei Eigenschaften ab, die der nächste Umbau nicht wieder
// stillschweigend verlieren darf:
//
//   1. Bei vielen IDs werden MEHRERE `.in()`-Calls abgesetzt — kein einzelner
//      Mega-Query mehr.
//   2. Das Merge-Ergebnis enthält ALLE Rows aller Chunks (nicht nur den ersten).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChildrenByBewerbungIds } from '../routes/bewerbungen.js';

/**
 * Fake-Supabase-Client, der jeden `.in()`-Call protokolliert und für die
 * übergebenen IDs eine simulierte Notiz-Row zurückliefert.
 */
function makeFakeClient() {
  const calls = []; // {table, ids}
  return {
    calls,
    from(table) {
      return {
        select() {
          return {
            in(_col, ids) {
              calls.push({ table, ids: [...ids] });
              const data = ids.map(id => ({
                bewerbung_id: id,
                status: 'kontaktiert',
                anrufversuche: [{ datum: '2026-07-15', ergebnis: 'nicht_erreicht' }],
              }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  };
}

test('fetchChildrenByBewerbungIds: chunked bei >100 IDs — kein Mega-Query', async () => {
  const client = makeFakeClient();
  // 408 IDs — der reale Fall aus dem Oktober-Vorfall.
  const ids = Array.from({ length: 408 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  const rows = await fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ids, { client });

  // 1. Mehrere Chunks: 408 / 100 = 5 Calls (100, 100, 100, 100, 8).
  assert.equal(client.calls.length, 5, 'Chunking soll bei 408 IDs genau 5 Calls machen');
  assert.equal(client.calls[0].ids.length, 100);
  assert.equal(client.calls[4].ids.length, 8);

  // 2. Alle Rows gemerged.
  assert.equal(rows.length, 408, 'Merge-Ergebnis soll ALLE Rows über alle Chunks enthalten');
  assert.equal(rows[0].bewerbung_id, ids[0]);
  assert.equal(rows[407].bewerbung_id, ids[407]);

  // 3. Notizen-Felder sind durchgereicht (Repro-Garantie: nicht nur IDs matchen,
  //    sondern status/anrufversuche kommen durch).
  assert.equal(rows[0].status, 'kontaktiert');
  assert.equal(rows[0].anrufversuche[0].ergebnis, 'nicht_erreicht');
});

test('fetchChildrenByBewerbungIds: leere ID-Liste → kein Call, leeres Array', async () => {
  const client = makeFakeClient();
  const rows = await fetchChildrenByBewerbungIds('talentone_bewerber_notizen', [], { client });
  assert.equal(client.calls.length, 0);
  assert.deepEqual(rows, []);
});

test('fetchChildrenByBewerbungIds: unter Chunk-Größe → genau 1 Call', async () => {
  const client = makeFakeClient();
  const ids = ['a', 'b', 'c'];
  const rows = await fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ids, { client });
  assert.equal(client.calls.length, 1);
  assert.equal(rows.length, 3);
});

test('fetchChildrenByBewerbungIds: Fehler aus Supabase propagiert mit Tabellenname', async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            in() { return Promise.resolve({ data: null, error: { message: 'boom' } }); },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ['x'], { client }),
    /talentone_bewerber_notizen: boom/,
  );
});

// Integrationstest-Shape — simuliert das volle Mapping der Overview, damit auch
// der NÄCHSTE Umbau nicht die Response-Shape bricht. Beweist die drei Spalten
// die laut User "fehlen": status, anrufversuche, vorqualifizierung_werte.
test('Overview-Response-Shape: notizen-Map füllt ALLE Zeilen mit status/anrufversuche/vq-werte', async () => {
  const client = {
    from() {
      return {
        select() {
          return {
            in(_col, ids) {
              return Promise.resolve({
                data: ids.map((id, i) => ({
                  bewerbung_id: id,
                  status: i % 2 === 0 ? 'kontaktiert' : 'interessiert',
                  anrufversuche: [{ datum: '2026-07-15', ergebnis: 'nicht_erreicht' }],
                  vorqualifizierung_werte: { Ausbildung: 'Facharbeiter', Alter: '32' },
                  notizen: 'Testnotiz',
                })),
                error: null,
              });
            },
          };
        },
      };
    },
  };
  const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
  const rows = await fetchChildrenByBewerbungIds('talentone_bewerber_notizen', ids, { client });

  // Map bauen wie die Route es tut.
  const notizen = {};
  for (const n of rows) notizen[n.bewerbung_id] = n;

  // Sicherstellen: KEINE Zeile fällt auf Default.
  for (const id of ids) {
    const n = notizen[id];
    assert.ok(n, `Zeile ${id}: notiz-Row fehlt — Overview würde Default-Werte zeigen`);
    assert.ok(['kontaktiert', 'interessiert'].includes(n.status), `Status fehlt für ${id}`);
    assert.ok(Array.isArray(n.anrufversuche) && n.anrufversuche.length > 0, `Anrufversuche fehlt für ${id}`);
    assert.ok(n.vorqualifizierung_werte && Object.keys(n.vorqualifizierung_werte).length > 0, `VQ-Werte fehlen für ${id}`);
    assert.equal(n.notizen, 'Testnotiz');
  }
});
