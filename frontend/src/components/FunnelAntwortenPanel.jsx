import { normalizeBewerbung } from '../lib/perspectiveParser.js';

// Funnel-Antworten eines Bewerbers: Frage grau, Antwort fett; stelle_gewaehlt
// prominent als erste Zeile; KO-auslösende Antworten rot + „KO"-Badge (berechnet
// aus der registrierten Funnel-Definition fragen[].options[].ko). Rendert Array-
// UND Objekt-Form (normalizeBewerbung vereinheitlicht beide), mit raw-Fallback.

function norm(s) { return String(s || '').trim().toLowerCase(); }
function fmt(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Fallback: bekannte Keys aus bewerbung.raw (Perspective profile.question_* / answers[]).
function rawPairs(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const prof = raw.profile || raw.data?.profile;
  const out = [];
  if (prof && typeof prof === 'object') {
    for (const [k, v] of Object.entries(prof)) {
      if (/^question/i.test(k) && v && typeof v === 'object') out.push({ frage_text: v.title || v.label || k, antwort: fmt(v.value) });
    }
  }
  if (!out.length && Array.isArray(raw.answers)) {
    for (const a of raw.answers) out.push({ frage_text: a.question || a.title || a.label || '', antwort: fmt(a.answer ?? a.value) });
  }
  return out.filter(p => p.frage_text || p.antwort);
}

export function antwortPaare(bewerbung) {
  const n = normalizeBewerbung(bewerbung);
  let pairs = (n.antworten || []).map(a => ({ frage_text: a.frage_text || '', antwort: fmt(a.antwort) })).filter(p => p.frage_text || p.antwort);
  if (!pairs.length) pairs = rawPairs(bewerbung?.raw);
  return pairs;
}

// Erste aussagekräftige Antwort für die Kompakt-Vorschau in der Zeile.
export function erstePreview(bewerbung) {
  const p = antwortPaare(bewerbung).find(x => x.antwort && x.antwort.trim().length > 1);
  return p ? p.antwort : '';
}

function koMap(fragen) {
  const m = {};
  for (const q of (fragen || [])) {
    const ko = new Set((q.options || []).filter(o => o && o.ko).map(o => norm(o.text)));
    if (ko.size) m[norm(q.text)] = ko;
  }
  return m;
}

// Einzelne Frage/Antwort gegen die Funnel-Definition prüfen (für Inline-Spalten).
export function istKo(frage, antwort, fragen) {
  return !!koMap(fragen)[norm(frage)]?.has(norm(antwort));
}

export default function FunnelAntwortenPanel({ bewerbung, fragen }) {
  const pairs = antwortPaare(bewerbung);
  const stelle = bewerbung?.stelle_gewaehlt;
  const kos = koMap(fragen);
  if (!pairs.length && !stelle) return <div className="funnel-antworten-leer">Keine Antworten übermittelt.</div>;
  return (
    <div className="funnel-antworten">
      {stelle && <div className="fa-stelle">📍 Stelle gewählt: <strong>{stelle}</strong></div>}
      {pairs.map((p, i) => {
        const isKo = kos[norm(p.frage_text)]?.has(norm(p.antwort));
        return (
          <div key={i} className={`fa-row${isKo ? ' fa-ko' : ''}`}>
            <span className="fa-frage">{p.frage_text || '—'}</span>
            <span className="fa-antwort">{p.antwort || '—'}{isKo && <span className="fa-ko-badge">KO</span>}</span>
          </div>
        );
      })}
    </div>
  );
}
