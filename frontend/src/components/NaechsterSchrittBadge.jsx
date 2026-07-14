import { useNavigate } from 'react-router-dom';

// Farbschema — synchron zum Backend-color-Enum:
// grau (wartet auf Kunde), farbig (wir sind dran), gruen (live),
// gelb (überarbeitung), rot (warnung), dunkelgrau (abgeschlossen/pausiert)
const FARBE = {
  grau:        { bg: '#f3f4f6', color: '#374151' },
  farbig:      { bg: '#dbeafe', color: '#1e40af' },
  gruen:       { bg: '#dcfce7', color: '#166534' },
  gelb:        { bg: '#fef3c7', color: '#92400e' },
  rot:         { bg: '#fee2e2', color: '#991b1b' },
  dunkelgrau:  { bg: '#e5e7eb', color: '#6b7280' },
};

// Einzelner Badge — kompakt (klick springt in den Ziel-Tab).
export function ItemBadge({ item, kundeId, compact = false }) {
  const nav = useNavigate();
  const farbe = FARBE[item.schritt.color] || FARBE.grau;
  const showKurzname = !compact;

  function open() {
    if (!item.job_id) return; // Kein Job → nicht klickbar
    const tab = item.schritt.tab || 'stelle';
    nav(`/kunden/${kundeId}/jobs/${item.job_id}/${tab}`);
  }

  return (
    <button
      type="button" onClick={(e) => { e.stopPropagation(); open(); }}
      disabled={!item.job_id}
      title={`${item.stelle}: ${item.schritt.label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: farbe.bg, color: farbe.color,
        border: 'none', padding: '3px 10px', borderRadius: 100,
        fontSize: 11, fontWeight: 600, cursor: item.job_id ? 'pointer' : 'default',
        maxWidth: '100%', textAlign: 'left', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      <span style={{ flexShrink: 0 }}>{item.schritt.icon}</span>
      {showKurzname && <strong style={{ marginRight: 2 }}>{item.kurzname}:</strong>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.schritt.label}</span>
    </button>
  );
}

// Stapel-Anzeige fuer die Kundenliste — max. 3 sichtbar, danach "+N weitere"
// Filtert pausiert/abgeschlossen wenn es auch aktive gibt (Fallback: einzelner
// Abgeschlossen-Badge).
export default function NaechsterSchrittStapel({ items, kundeId, max = 3 }) {
  if (!items?.length) return <span style={{ color: '#9a9994', fontSize: 12 }}>—</span>;

  const aktive = items.filter(i =>
    i.schritt.key !== 'pausiert' && i.schritt.key !== 'abgeschlossen');
  const anzuzeigen = aktive.length ? aktive : items;

  const sichtbar = anzuzeigen.slice(0, max);
  const uebrig = anzuzeigen.length - sichtbar.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {sichtbar.map((it, i) => (
        <ItemBadge key={it.job_id || i} item={it} kundeId={kundeId} />
      ))}
      {uebrig > 0 && (
        <span style={{ fontSize: 11, color: '#9a9994', paddingLeft: 8 }}>
          + {uebrig} weitere{uebrig === 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
