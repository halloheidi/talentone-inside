// Caches für die teure Kunden-Kanban-Aggregation.
//
//  - Listen-Cache: die fertige /kanban-Antwort (TTL 60s). Invalidierung bei jeder
//    Status-/Vertrags-/Pausen-/Stellen-Änderung.
//  - Laufzeit-Cache je Projekt: das Ergebnis von laufzeitStatus (TTL 10 min). Die
//    aktiven Lauftage ändern sich nur durch Meta-Sync bzw. Vertrags-/Pausen-Edits,
//    NICHT durch einen reinen Status-Drag — deshalb überlebt dieser Cache die
//    Listen-Invalidierung und ein Status-Wechsel bleibt billig.
let listStore = new Map();
const LIST_TTL = 60_000;

let lzStore = new Map();
const LZ_TTL = 600_000;

export function getKanban(key) { const e = listStore.get(key); return (e && Date.now() - e.at < LIST_TTL) ? e.data : null; }
export function setKanban(key, data) { listStore.set(key, { at: Date.now(), data }); }
export function invalidateKanban() { listStore.clear(); }

export function getLaufzeit(projektId) { const e = lzStore.get(projektId); return (e && Date.now() - e.at < LZ_TTL) ? e.value : undefined; }
export function setLaufzeit(projektId, value) { lzStore.set(projektId, { at: Date.now(), value }); }
export function invalidateLaufzeit(projektId) { if (projektId) lzStore.delete(projektId); else lzStore.clear(); }
