// Seitenbreite zentral steuern.
//
// Standard: JEDE Seite bekommt automatisch die begrenzte Lesebreite aus
// `.content` (max-width, zentriert) — neue Seiten müssen dafür nichts tun.
//
// Volle Breite: Seiten, die den Platz wirklich brauchen (Kanban, Gantt,
// breite Tabellen, Dashboards), deklarieren das selbst:
//   <PageContainer wide />            // als Marker irgendwo in der Seite
//   <PageContainer wide>…</PageContainer>  // oder umschließend
// Die eigentliche Breite setzt die Content-Spalte im DashboardLayout
// (.content / .content.is-wide) — hier wird sie nur angemeldet. Damit steht
// die Entscheidung in der Seite statt in Einzelfall-CSS.

import { createContext, useContext, useEffect } from 'react';

const PageWidthContext = createContext(null);

export function PageWidthProvider({ value, children }) {
  return <PageWidthContext.Provider value={value}>{children}</PageWidthContext.Provider>;
}

export default function PageContainer({ wide = false, children }) {
  const setWide = useContext(PageWidthContext);
  useEffect(() => {
    setWide?.(wide);
    return () => setWide?.(false);
  }, [wide, setWide]);
  return <>{children}</>;
}
