// Persistierte Start-Ansicht nach Login (pro Gerät, localStorage). Default: /kunden.
const KEY = 'inside:startview';

export function getStartView() {
  try { return localStorage.getItem(KEY) || '/kunden'; } catch { return '/kunden'; }
}

export function setStartView(path) {
  try {
    if (path) localStorage.setItem(KEY, path);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
