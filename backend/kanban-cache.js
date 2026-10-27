// Kurzlebiger In-Memory-Cache für die teure Kunden-Kanban-Aggregation (laufzeitStatus
// pro Live-/Pause-Projekt). TTL 60s; Invalidierung bei Status-/Vertrags-/Pausen-Änderung.
let store = new Map();
const TTL_MS = 60_000;

export function getKanban(key) {
  const e = store.get(key);
  if (e && Date.now() - e.at < TTL_MS) return e.data;
  return null;
}
export function setKanban(key, data) { store.set(key, { at: Date.now(), data }); }
export function invalidateKanban() { store.clear(); }
