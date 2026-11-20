import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Go-Live-Checkliste im Funnel-Bereich (ersetzt die alten zwei „manuell erledigen"-Haken).
// Manuelle Haken werden in talentone_jobs.golive_checkliste gespeichert (Datum + Nutzer,
// via PATCH /jobs/:id/golive). Vier Punkte werden automatisch grün, sobald die echten
// Daten stimmen (Funnel live, Test-Bewerbung, Pixel-Event, Kampagne zugeordnet).
//
// Props:
//  - jobId
//  - funnelTyp: 'perspective' | 'onepage'
//  - webhookUrl: zum Einblenden im Webhook-Punkt
//  - funnelLiveHint: bool — Parent weiß sofort, ob der Funnel live ist (ohne Refetch)
//  - reloadToken: ändert sich, wenn der Parent neu geladen hat → Auto-Signale neu holen

// Punkt-Definitionen. auto = Schlüssel im Auto-Signal-Objekt (sonst manueller Haken).
const META_ITEMS = [
  { key: 'domain_verifiziert',   section: 'Meta', label: 'Domain im Business Manager verifiziert' },
  { key: 'pixel_event',          section: 'Meta', label: 'Pixel-Event im Events Manager angekommen (Test-Event)', auto: 'pixel_event' },
  { key: 'werbekonto_zugeordnet',section: 'Meta', label: 'Werbekonto dem Kunden/Pool zugeordnet (/admin/meta)' },
  { key: 'kampagne_zugeordnet',  section: 'Meta', label: 'Kampagne zugeordnet (meta_zuordnung gesetzt)', auto: 'kampagne_zugeordnet' },
  { key: 'conversion_ziel',      section: 'Meta', label: 'Conversion-Ziel der Kampagne = Bewerbung (SubmitApplication / Custom Conversion), nicht Link-Klicks' },
  { key: 'facebook_seite',       section: 'Meta', label: 'Facebook-Seite: Kundenseite (bzw. „Hofjobs" bei anonymen Stellen)' },
];

function itemsFuer(funnelTyp) {
  if (funnelTyp === 'onepage') {
    return [
      { key: 'webhook_eingetragen', section: 'Funnel', label: 'Webhook im Onepage-/Heyflow-Builder eingetragen (URL mit ?job_id=…)', critical: true },
      { key: 'pixel_hinterlegt',    section: 'Funnel', label: 'Meta-Pixel-ID im Builder hinterlegt', critical: true },
      { key: 'capi_hinterlegt',     section: 'Funnel', label: 'CAPI-Zugriffstoken im Builder hinterlegt (falls unterstützt)', critical: true },
      { key: 'event_mapping',       section: 'Funnel', label: 'Conversion-Event auf dem Absende-Schritt gemappt (SubmitApplication / Lead)' },
      { key: 'funnel_veroeffentlicht', section: 'Funnel', label: 'Funnel live, Live-URL geprüft', auto: 'funnel_live' },
      { key: 'test_bewerbung',      section: 'Funnel', label: 'Test-Bewerbung durchgeschickt → im Tool angekommen', auto: 'test_bewerbung' },
      ...META_ITEMS,
    ];
  }
  // Perspective (Default)
  return [
    { key: 'webhook_eingetragen', section: 'Perspective', label: 'Webhook eingetragen (URL mit ?job_id=… aus der Kachel)', critical: true },
    { key: 'pixel_hinterlegt',    section: 'Perspective', label: 'Meta-Pixel-ID im Funnel hinterlegt (Integrationen → Meta)', critical: true },
    { key: 'capi_hinterlegt',     section: 'Perspective', label: 'CAPI-Zugriffstoken im Funnel hinterlegt (aus der Pixel-Kachel)', critical: true },
    { key: 'event_mapping',       section: 'Perspective', label: 'Event-Mapping: letzter Button → SubmitApplication, erster CTA → Lead' },
    { key: 'domain_whitelisted',  section: 'Perspective', label: 'Funnel-Domain in Perspective whitelisted (jobs.nowagwirth.com / recruiting.nowagwirth.com / Kundendomain)' },
    { key: 'funnel_veroeffentlicht', section: 'Perspective', label: 'Funnel veröffentlicht, Live-URL geprüft', auto: 'funnel_live' },
    { key: 'test_bewerbung',      section: 'Perspective', label: 'Test-Bewerbung durchgeschickt → im Tool angekommen', auto: 'test_bewerbung' },
    ...META_ITEMS,
  ];
}

export default function GoLiveCheckliste({ jobId, funnelTyp = 'perspective', webhookUrl, funnelLiveHint = false, reloadToken }) {
  const [data, setData] = useState(null); // { checkliste, auto, legacy, funnel_typ }
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [offen, setOffen] = useState(true);

  const lade = useCallback(() => {
    api(`/jobs/${jobId}/golive`)
      .then(r => setData(r))
      .catch(e => setError(e.body?.error || e.message));
  }, [jobId]);

  useEffect(() => { lade(); }, [lade, reloadToken]);

  async function toggle(item, next) {
    // Auto-Punkt, der bereits automatisch grün ist, lässt sich nicht abhaken.
    setBusyKey(item.key); setError('');
    try {
      const r = await api(`/jobs/${jobId}/golive`, { method: 'PATCH', body: { key: item.key, done: next } });
      setData(d => d ? { ...d, checkliste: r.checkliste } : d);
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusyKey('');
    }
  }

  if (error && !data) return <div className="alert alert-error" style={{ marginTop: 10 }}>Checkliste: {error}</div>;
  if (!data) return <p className="pane-hint" style={{ marginTop: 10 }}>Lade Go-Live-Checkliste…</p>;

  const items = itemsFuer(funnelTyp);
  const auto = { ...(data.auto || {}) };
  if (funnelLiveHint) auto.funnel_live = true;
  const cl = data.checkliste || {};
  const legacy = data.legacy || {};

  // Ein Punkt gilt als erledigt, wenn: Auto-Signal grün ODER manuell abgehakt ODER
  // (einmalig) der alte Funnel-Haken gesetzt war (Legacy-Vorbelegung).
  const istErledigt = (item) => {
    if (item.auto && auto[item.auto]) return true;
    if (cl[item.key]?.done) return true;
    if (legacy[item.key] && !(item.key in cl)) return true;
    return false;
  };
  const istAutoGruen = (item) => !!(item.auto && auto[item.auto]);

  const erledigt = items.filter(istErledigt).length;
  const gesamt = items.length;
  const komplett = erledigt === gesamt;

  // Live, aber kritische Haken (Pixel/CAPI/Webhook) fehlen → Warnung.
  const kritischOffen = items.filter(i => i.critical && !istErledigt(i));
  const zeigeLiveWarnung = (funnelLiveHint || auto.funnel_live) && kritischOffen.length > 0;

  const sektionen = [...new Set(items.map(i => i.section))];

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--line, #e5e5e5)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOffen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: komplett ? '#ecfdf5' : '#f8fafc', border: 'none', borderBottom: offen ? '1px solid var(--line, #e5e5e5)' : 'none',
          padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1f2937' }}>
          {komplett ? '✅' : '🚦'} Go-Live-Checkliste
          {!komplett && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: '#b45309', background: '#fef3c7', borderRadius: 999, padding: '2px 8px' }}>Funnel-Checkliste offen</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: komplett ? '#047857' : '#334155' }}>{erledigt} von {gesamt}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3, #666)' }}>{offen ? '▾' : '▸'}</span>
        </span>
      </button>

      {offen && (
        <div style={{ padding: '12px 14px' }}>
          {/* Fortschrittsbalken */}
          <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${Math.round((erledigt / gesamt) * 100)}%`, height: '100%', background: komplett ? '#10b981' : '#f59e0b', transition: 'width .2s' }} />
          </div>

          {zeigeLiveWarnung && (
            <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 13 }}>
              ⚠️ Der Funnel ist <strong>live</strong>, aber {kritischOffen.map(i => i.key === 'webhook_eingetragen' ? 'Webhook' : i.key === 'pixel_hinterlegt' ? 'Pixel' : 'CAPI').join(' / ')} fehlt noch — ohne diese Haken läuft Tracking/Weiterleitung evtl. nicht.
            </div>
          )}
          {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>{error}</div>}

          {sektionen.map(sec => (
            <div key={sec} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-4, #888)', marginBottom: 6 }}>{sec}</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {items.filter(i => i.section === sec).map(item => {
                  const done = istErledigt(item);
                  const autoGruen = istAutoGruen(item);
                  const meta = cl[item.key];
                  return (
                    <div key={item.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.4 }}>
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={busyKey === item.key || autoGruen}
                        onChange={e => toggle(item, e.target.checked)}
                        style={{ marginTop: 2, flexShrink: 0, cursor: autoGruen ? 'default' : 'pointer' }}
                        title={autoGruen ? 'Automatisch erfüllt' : ''}
                      />
                      <span style={{ color: done ? '#065f46' : '#374151', textDecoration: done && !autoGruen ? 'none' : 'none' }}>
                        {item.label}
                        {item.auto && <span style={{ marginLeft: 6, fontSize: 11, color: autoGruen ? '#059669' : '#9ca3af', fontWeight: 600 }}>{autoGruen ? '• automatisch ✓' : '• automatisch'}</span>}
                        {item.key === 'webhook_eingetragen' && webhookUrl && (
                          <span className="pane-hint" style={{ display: 'block', fontSize: 11, marginTop: 1 }}>
                            <code style={{ fontSize: 10 }}>{webhookUrl}</code>
                          </span>
                        )}
                        {meta?.done && meta.at && (
                          <span className="pane-hint" style={{ display: 'block', fontSize: 10.5, marginTop: 1 }}>
                            abgehakt {new Date(meta.at).toLocaleDateString('de-DE')}{meta.by ? ` · ${meta.by}` : ''}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
