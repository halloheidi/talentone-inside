// "Worauf achten" — Caller-Box für den Telefonisten.
//
// Erscheint im Bewerber-Slide-Over (intern + Telefonisten-Modus), damit während
// des Gesprächs sofort sichtbar ist, was abzuklopfen ist.
// Pflicht-Kriterien mit ❗. Die Anforderung steht als Zusatz daneben:
//   "Führerschein ❗ — Klasse B zwingend"

export default function WoraufAchtenBox({ kriterien = [], compact = false }) {
  const liste = (kriterien || []).filter(k => k?.kriterium);
  if (!liste.length) return null;

  // Pflicht zuerst — das ist im Gespräch das Entscheidende.
  const sortiert = [...liste].sort((a, b) => (b.pflicht ? 1 : 0) - (a.pflicht ? 1 : 0));

  return (
    <div style={{
      background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
      padding: compact ? '10px 12px' : '12px 14px',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: '#78350f', marginBottom: 8,
      }}>
        ⭐ Worauf achten
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {sortiert.map((k, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.45, display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ width: 14, flexShrink: 0 }}>{k.pflicht ? '❗' : '·'}</span>
            <span>
              <strong style={{ color: k.pflicht ? '#7f1d1d' : '#0a0a0a' }}>{k.kriterium}</strong>
              {k.anforderung && <span style={{ color: '#78350f' }}> — {k.anforderung}</span>}
              {k.pflicht && <span style={{ color: '#9a9994', fontSize: 11 }}> (Pflicht)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
