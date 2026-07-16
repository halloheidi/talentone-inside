import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';

const PHASE1_DAYS = 30;

function daysBetween(fromIso, toDate) {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  const diffMs = toDate.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function farbeFuerTage(tag) {
  if (tag == null) return { bg: '#e5e7eb', text: '#374151', label: 'unbekannt' };
  if (tag >= 28) return { bg: '#dc2626', text: '#fff', label: 'überfällig' };
  if (tag >= 20) return { bg: '#f59e0b', text: '#111', label: 'kritisch' };
  return { bg: '#16a34a', text: '#fff', label: 'ok' };
}

export default function LiveKampagnen() {
  const nav = useNavigate();
  const [projekte, setProjekte] = useState([]);
  const [jobsByKunde, setJobsByKunde] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const p = await api('/projekte');
        const liveProjekte = (p.projekte || []).filter(x => x.status === 'live');
        setProjekte(liveProjekte);

        // Für jeden Live-Kunden den primären Job holen
        const kundeIds = [...new Set(liveProjekte.map(x => x.kunde_id).filter(Boolean))];
        const jobResults = await Promise.all(
          kundeIds.map(id => api(`/jobs?kunde_id=${id}`).catch(() => ({ jobs: [] })))
        );
        const map = {};
        kundeIds.forEach((id, i) => {
          const jobs = jobResults[i]?.jobs || [];
          if (jobs.length) map[id] = jobs[0]; // erster/primärer
        });
        setJobsByKunde(map);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const heute = useMemo(() => new Date(), []);

  const rows = useMemo(() => {
    return projekte.map(p => {
      const start = p.start_phase1 || p.live_seit || null;
      const ende  = p.ende_phase1 || null;
      const tag   = daysBetween(start, heute);
      const rest  = tag != null ? PHASE1_DAYS - tag : null;
      const job   = jobsByKunde[p.kunde_id];
      return {
        ...p,
        _start: start,
        _ende: ende,
        _tag: tag,
        _rest: rest,
        _stelle: job?.stelle || p.projekt || '',
        _job_id: job?.id || null,
      };
    }).sort((a, b) => {
      // dringendste oben: kleinstes rest zuerst (überfällige als kleinste negative)
      const ar = a._rest ?? 999;
      const br = b._rest ?? 999;
      return ar - br;
    });
  }, [projekte, jobsByKunde, heute]);

  if (loading) return <div style={{ padding: 24 }}>Lade Live-Kampagnen…</div>;
  if (error) return <div style={{ padding: 24, color: '#c1272d' }}>{error}</div>;

  return (
    <div style={{ padding: '24px 32px' }}>
      <PageContainer wide />
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Live-Kampagnen</h1>
        <p style={{ color: '#5a5955', fontSize: 14 }}>
          Alle aktiven Projekte in Phase 1 (30-Tage-Ziel). Sortiert nach verbleibender Restlaufzeit — dringendste oben.
        </p>
      </header>

      {rows.length === 0 ? (
        <div style={{ padding: 40, background: '#fff', borderRadius: 12, textAlign: 'center', color: '#9a9994' }}>
          Aktuell keine Live-Projekte.
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* Legende */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 12 }}>
            <span><Chip bg="#16a34a" /> &lt; 20 Tage</span>
            <span><Chip bg="#f59e0b" /> 20–27 Tage</span>
            <span><Chip bg="#dc2626" /> 28+ Tage / überfällig</span>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map(r => {
              const farbe = farbeFuerTage(r._tag);
              const progress = r._tag != null ? Math.min(100, (r._tag / PHASE1_DAYS) * 100) : 0;
              const isOverdue = r._tag != null && r._tag >= PHASE1_DAYS;
              const tagLabel = r._tag != null
                ? (isOverdue
                    ? `Überfällig — Tag ${r._tag} (${r._tag - PHASE1_DAYS} über Ziel)`
                    : `Tag ${r._tag} von ${PHASE1_DAYS}`)
                : 'Kein Start-Datum';
              return (
                <div key={r.id}
                  onClick={() => {
                    if (r._job_id) nav(`/kunden/${r.kunde_id}/jobs/${r._job_id}/stelle`);
                    else if (r.kunde_id) nav(`/kunden/${r.kunde_id}`);
                    else nav(`/projekte?open=${r.id}`);
                  }}
                  style={{
                    padding: '12px 14px', border: '1px solid #ececea', borderRadius: 10,
                    cursor: 'pointer', transition: 'background 120ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafaf8'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ fontSize: 15 }}>{r.kunde || 'Unbekannter Kunde'}</strong>
                      {r._stelle && <span style={{ color: '#5a5955', marginLeft: 8, fontSize: 13 }}>· {r._stelle}</span>}
                    </div>
                    <span style={{
                      background: farbe.bg, color: farbe.text,
                      padding: '3px 10px', borderRadius: 100,
                      fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{tagLabel}</span>
                  </div>

                  <div style={{ position: 'relative', height: 14, background: '#f1f1ee', borderRadius: 7, overflow: 'hidden' }}>
                    <div style={{
                      width: `${progress}%`, height: '100%',
                      background: farbe.bg, transition: 'width 240ms',
                    }} />
                    {r._ende && !isOverdue && (
                      <div style={{
                        position: 'absolute', top: -2, right: 0, height: 18,
                        borderRight: '2px dashed #5a5955',
                      }} title={`Ende Phase 1: ${new Date(r._ende).toLocaleDateString('de-DE')}`} />
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#5a5955' }}>
                    <span>{r._start ? `Start: ${new Date(r._start).toLocaleDateString('de-DE')}` : '—'}</span>
                    <span>{r._ende ? `Ziel: ${new Date(r._ende).toLocaleDateString('de-DE')}` : `Ziel: 30 Tage`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ bg }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: bg, marginRight: 4 }} />;
}
