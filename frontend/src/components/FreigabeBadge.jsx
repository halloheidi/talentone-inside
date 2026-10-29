// Kunden-Freigabe eines Referenzbilds (aus der Foto-Durchsicht im Prüfungs-Flow).
// 'nein' = vom Kunden gesperrt (rot, in Pickern ausgeblendet, nie an KI).
// 'unsicher' = gelb, weiter nutzbar, zur Klärung. 'ja'/NULL = unauffällig.

export function istGesperrt(r) { return r?.kunde_freigabe === 'nein' || r?.freigabe === 'nein'; }
export function istUnsicher(r) { return r?.kunde_freigabe === 'unsicher' || r?.freigabe === 'unsicher'; }
export function freigabeWert(r) { return r?.kunde_freigabe ?? r?.freigabe ?? null; }
export function freigabeKommentar(r) { return r?.kunde_kommentar ?? r?.kommentar ?? null; }

// Zählt Fotos, die zur Klärung markiert sind ('unsicher').
export function zaehleUnsicher(list) {
  return (list || []).filter(istUnsicher).length;
}

// Kleines Badge für Bild-Kacheln. Positionierung über `style` je Oberfläche.
export function FreigabeBadge({ r, style }) {
  const wert = freigabeWert(r);
  if (wert !== 'nein' && wert !== 'unsicher') return null;
  const kommentar = freigabeKommentar(r);
  const gesperrt = wert === 'nein';
  const base = {
    position: 'absolute', bottom: 4, left: 4, zIndex: 2,
    fontSize: 9, fontWeight: 700, letterSpacing: 0.03, textTransform: 'uppercase',
    padding: '2px 6px', borderRadius: 5, maxWidth: 'calc(100% - 8px)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    background: gesperrt ? '#b91c1c' : '#f59e0b',
    color: gesperrt ? '#fff' : '#0a0a0a',
    ...style,
  };
  const label = gesperrt ? 'vom Kunden gesperrt' : 'unsicher';
  return <span style={base} title={kommentar ? `${label}: ${kommentar}` : label}>{label}</span>;
}

export default FreigabeBadge;
