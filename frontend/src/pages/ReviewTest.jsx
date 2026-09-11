/*
 * ReviewTest — token-freie Hinweis-Seite für Testmails, deren Job noch NIE echt versandt
 * wurde (kein Freigabe-Token vorhanden). Verhindert den Sprung ins Leere (/review/vorschau
 * → 404). Rein statisch: keine API, kein Token, keine Nebenwirkung.
 */
export default function ReviewTest() {
  return (
    <div style={{ minHeight: '100vh', background: '#f0efed', color: '#0a0a0a', fontFamily: '-apple-system, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '40px 32px', maxWidth: 520, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🧪</div>
        <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>Dies ist eine Testmail</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#5a5955', margin: 0 }}>
          Die Kommentar- und Freigabe-Ansicht wird automatisch aktiviert, sobald die Entwürfe
          echt an den Kunden versendet werden. In der Testmail gibt es dafür noch keinen Link —
          Inhalt und Layout der Mail sind aber exakt wie beim späteren Versand.
        </p>
      </div>
    </div>
  );
}
