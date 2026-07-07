import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import Modal from '../../components/Modal.jsx';

const BRANDS = [
  { key: 'talentone',   label: 'TalentOne' },
  { key: 'nowag_wirth', label: 'Nowag & Wirth' },
];
const CATEGORIES = [
  { key: 'setup',           label: 'Setup (Pflicht)' },
  { key: 'monthly',         label: 'Monatlich (Pflicht)' },
  { key: 'option_setup',    label: 'Optionen (Setup, einmalig)' },
  { key: 'option_monthly',  label: 'Optionen (monatlich)' },
];

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export default function OfferKatalog() {
  const { isAdmin, me } = useAuth();
  const [tab, setTab] = useState('products'); // 'products' | 'templates' | 'assets'
  const [brand, setBrand] = useState('talentone');

  // Ohne Admin-Rechte: nur Info anzeigen.
  if (me && !isAdmin) {
    return (
      <div>
        <div className="page-head"><div><h1 className="page-title">Angebots-Katalog</h1></div></div>
        <div className="card empty"><h2>Kein Zugriff</h2><p>Nur Admin-Mitglieder dürfen den Katalog bearbeiten.</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Angebots-Katalog</h1>
          <p className="page-sub">Preise, Positionstexte und Textbausteine für Angebote — je Marke.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="proj-view-toggle">
            {BRANDS.map(b => (
              <button
                key={b.key}
                className={`pub-filter ${brand === b.key ? 'is-active' : ''}`}
                onClick={() => setBrand(b.key)}
              >{b.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="proj-view-toggle" style={{ marginBottom: 16 }}>
        <button className={`pub-filter ${tab === 'products' ? 'is-active' : ''}`} onClick={() => setTab('products')}>Positionen</button>
        <button className={`pub-filter ${tab === 'templates' ? 'is-active' : ''}`} onClick={() => setTab('templates')}>Textbausteine</button>
        <button className={`pub-filter ${tab === 'assets' ? 'is-active' : ''}`} onClick={() => setTab('assets')}>Anhänge</button>
      </div>

      {tab === 'products'  && <ProductsTab brand={brand} />}
      {tab === 'templates' && <TemplatesTab brand={brand} />}
      {tab === 'assets'    && <AssetsTab brand={brand} />}
    </div>
  );
}

// ────────────────────────── Positionen ──────────────────────────
function ProductsTab({ brand }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // Vollständiger Positionstext
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    api(`/offer-catalog/products?brand=${brand}&include_inactive=1`)
      .then(res => setProducts(res.products || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [brand]);

  const grouped = useMemo(() => {
    const g = {};
    CATEGORIES.forEach(c => { g[c.key] = []; });
    for (const p of products) (g[p.category] = g[p.category] || []).push(p);
    return g;
  }, [products]);

  async function patch(id, patchObj) {
    try {
      const res = await api(`/offer-catalog/products/${id}`, { method: 'PATCH', body: patchObj });
      setProducts(cur => cur.map(p => p.id === id ? res.product : p));
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Neue Position</button>
      </div>

      {loading ? <div className="card empty">Lade…</div> : (
        <>
          {CATEGORIES.map(cat => (
            <section key={cat.key} style={{ marginBottom: 26 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)', marginBottom: 10 }}>{cat.label}</h2>
              <div className="bewerbungen-table-scroll">
                <table className="bewerbungen-table">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>SKU</th>
                      <th>Titel</th>
                      <th style={{ width: 130 }}>Preis (€ netto)</th>
                      <th style={{ width: 70 }} title="Bei Optionen: standardmäßig angehakt?">Default</th>
                      <th style={{ width: 90 }}>Sortierung</th>
                      <th style={{ width: 90 }}>Aktiv</th>
                      <th style={{ width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grouped[cat.key] || []).length === 0 && (
                      <tr><td colSpan="7" style={{ color: 'var(--ink-4)', fontStyle: 'italic' }}>Keine Positionen in dieser Kategorie.</td></tr>
                    )}
                    {(grouped[cat.key] || []).map(p => (
                      <ProductRow
                        key={p.id}
                        p={p}
                        onPatch={patch}
                        onOpenText={() => setEditing(p)}
                        isOptionCategory={cat.key.startsWith('option')}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}

      <ProductTextModal
        product={editing}
        onClose={() => setEditing(null)}
        onSave={async (text) => {
          await patch(editing.id, { description: text });
          setEditing(null);
        }}
      />

      <NewProductModal
        open={creating}
        brand={brand}
        onClose={() => setCreating(false)}
        onCreated={p => { setProducts(cur => [...cur, p].sort((a,b) => a.sort_order - b.sort_order)); setCreating(false); }}
      />
    </div>
  );
}

function ProductRow({ p, onPatch, onOpenText, isOptionCategory }) {
  const [title, setTitle] = useState(p.title);
  const [price, setPrice] = useState(String(p.unit_price));
  const [sort, setSort] = useState(String(p.sort_order));

  useEffect(() => { setTitle(p.title); setPrice(String(p.unit_price)); setSort(String(p.sort_order)); }, [p.id, p.title, p.unit_price, p.sort_order]);

  return (
    <tr>
      <td><code style={{ fontSize: 11, background: 'var(--gray-50)', padding: '2px 6px', borderRadius: 4 }}>{p.sku}</code></td>
      <td>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== p.title) onPatch(p.id, { title }); }}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }}
        />
      </td>
      <td>
        <input
          type="number" step="0.01" min="0"
          value={price}
          onChange={e => setPrice(e.target.value)}
          onBlur={() => { const n = parseFloat(price); if (Number.isFinite(n) && n !== +p.unit_price) onPatch(p.id, { unit_price: n }); }}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'right' }}
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        {isOptionCategory ? (
          <input
            type="checkbox"
            checked={!!p.is_default}
            onChange={e => onPatch(p.id, { is_default: e.target.checked })}
          />
        ) : <span style={{ color: 'var(--ink-4)' }}>—</span>}
      </td>
      <td>
        <input
          type="number" step="1"
          value={sort}
          onChange={e => setSort(e.target.value)}
          onBlur={() => { const n = parseInt(sort, 10); if (Number.isFinite(n) && n !== p.sort_order) onPatch(p.id, { sort_order: n }); }}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'right' }}
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={!!p.active}
          onChange={e => onPatch(p.id, { active: e.target.checked })}
        />
      </td>
      <td>
        <button className="btn-ghost btn-sm" onClick={onOpenText}>Text bearbeiten</button>
      </td>
    </tr>
  );
}

function ProductTextModal({ product, onClose, onSave }) {
  const [text, setText] = useState('');
  useEffect(() => { setText(product?.description || ''); }, [product?.id]);
  if (!product) return null;

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={`Positionstext — ${product.title}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={() => onSave(text)}>Speichern</button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
        Der vollständige Positionstext, der später auf dem Angebot erscheint. Sie-Form, keine Preisangaben im Text.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={14}
        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
      />
    </Modal>
  );
}

function NewProductModal({ open, brand, onClose, onCreated }) {
  const [form, setForm] = useState({ category: 'setup', sku: '', title: '', unit_price: '0', is_default: false, sort_order: '100', description: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setForm({ category: 'setup', sku: '', title: '', unit_price: '0', is_default: false, sort_order: '100', description: '' }); setErr(''); }
  }, [open]);

  async function submit() {
    setErr('');
    const price = parseFloat(form.unit_price);
    const sort = parseInt(form.sort_order, 10);
    if (!form.sku.trim()) { setErr('SKU ist Pflicht.'); return; }
    if (!form.title.trim()) { setErr('Titel ist Pflicht.'); return; }
    if (!Number.isFinite(price) || price < 0) { setErr('Preis ungültig.'); return; }
    setBusy(true);
    try {
      const res = await api('/offer-catalog/products', {
        method: 'POST',
        body: {
          brand, category: form.category, sku: form.sku.trim(), title: form.title.trim(),
          description: form.description, unit_price: price, is_default: !!form.is_default,
          sort_order: Number.isFinite(sort) ? sort : 100, active: true,
        },
      });
      onCreated(res.product);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neue Position"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>Anlegen</button>
        </>
      }
    >
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Kategorie</span>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }}>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>SKU (eindeutig)</span>
          <input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="z. B. TO-OPT-XYZ" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'monospace', fontSize: 12 }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Titel</span>
          <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Preis (€ netto)</span>
            <input type="number" step="0.01" min="0" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'right' }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Sortierung</span>
            <input type="number" step="1" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, textAlign: 'right' }} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 22 }}>
            <input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} />
            <span style={{ fontSize: 12 }}>Default bei Optionen</span>
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Positionstext</span>
          <textarea rows={6} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
        </label>
      </div>
    </Modal>
  );
}

// ────────────────────────── Textbausteine ──────────────────────────
function TemplatesTab({ brand }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({}); // id → text
  const [saving, setSaving] = useState({}); // id → boolean

  function load() {
    setLoading(true); setError('');
    api(`/offer-catalog/templates?brand=${brand}`)
      .then(res => {
        setTemplates(res.templates || []);
        const d = {}; for (const t of (res.templates || [])) d[t.id] = t.text;
        setDrafts(d);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [brand]);

  async function save(t) {
    const text = drafts[t.id] ?? '';
    if (text === t.text) return;
    setSaving(s => ({ ...s, [t.id]: true }));
    try {
      const res = await api(`/offer-catalog/templates/${t.id}`, { method: 'PATCH', body: { text } });
      setTemplates(cur => cur.map(x => x.id === t.id ? res.template : x));
    } catch (e) { setError(e.message); }
    finally { setSaving(s => ({ ...s, [t.id]: false })); }
  }

  const LABELS = {
    guarantee:      'Garantie',
    payment_terms:  'Zahlungsbedingungen',
    reminder_email: 'Erinnerungs-Mail (überfällige Rechnungen)',
  };

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div className="card empty">Lade…</div> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {templates.map(t => {
            const isDirty = (drafts[t.id] ?? '') !== t.text;
            return (
              <div key={t.id} className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                    {LABELS[t.key] || t.key}
                    <code style={{ marginLeft: 10, fontSize: 11, color: 'var(--ink-4)' }}>{t.key}</code>
                  </h3>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    zuletzt geändert: {new Date(t.updated_at).toLocaleString('de-DE')}
                  </span>
                </div>
                <textarea
                  rows={8}
                  value={drafts[t.id] ?? ''}
                  onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 8 }}>
                  {isDirty && (
                    <button className="btn-ghost btn-sm" onClick={() => setDrafts(d => ({ ...d, [t.id]: t.text }))}>Verwerfen</button>
                  )}
                  <button
                    className="btn-primary btn-sm"
                    disabled={!isDirty || saving[t.id]}
                    onClick={() => save(t)}
                  >{saving[t.id] ? 'Speichere…' : 'Speichern'}</button>
                </div>
              </div>
            );
          })}
          {templates.length === 0 && (
            <div className="card empty">Keine Textbausteine für diese Marke.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Anhänge (Flyer) ──────────────────────────
function AssetsTab({ brand }) {
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    setLoading(true); setErr('');
    api(`/offer-catalog/brand-assets?brand=${brand}&asset_key=offer_flyer`)
      .then(r => setAsset((r.assets || [])[0] || null))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [brand]);

  async function upload(file) {
    setErr('');
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return setErr('Nur PDF-Dateien erlaubt.');
    if (file.size > 8 * 1024 * 1024) return setErr('Datei > 8 MB.');
    setUploading(true);
    try {
      const reader = new FileReader();
      const fileData = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api('/offer-catalog/brand-assets', {
        method: 'POST',
        body: { brand, filename: file.name, fileData, size_bytes: file.size },
      });
      load();
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 10, marginBottom: 14, fontSize: 13, color: 'var(--ink-2)' }}>
        Der Flyer ist ein optionaler zweiter Anhang beim Angebotsversand. Nur PDF, <strong>max. 8 MB</strong>.
        Achte darauf, dass Angebots-PDF + Flyer zusammen klein bleiben — sonst landet die Mail im Spam-Filter.
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? <div className="card empty">Lade…</div> : (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Angebots-Flyer — {brand === 'nowag_wirth' ? 'Nowag & Wirth' : 'TalentOne'}</h3>
          {asset ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, fontSize: 13 }}>
                <div style={{ color: 'var(--ink-3)' }}>Dateiname:</div>
                <div><code style={{ fontSize: 12 }}>{asset.filename}</code></div>
                <div style={{ color: 'var(--ink-3)' }}>Größe:</div>
                <div>{Math.round(asset.size_bytes / 1024)} KB</div>
                <div style={{ color: 'var(--ink-3)' }}>Hochgeladen:</div>
                <div>{new Date(asset.uploaded_at).toLocaleString('de-DE')} {asset.uploaded_by ? `von ${asset.uploaded_by}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <a href={`/api/offer-catalog/brand-assets/${brand}/preview`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">📄 Vorschau</a>
                <label className="btn-primary btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                  {uploading ? '⏳ Lade…' : '↻ Ersetzen'}
                  <input type="file" accept="application/pdf" style={{ display: 'none' }}
                    onChange={e => upload(e.target.files?.[0])} disabled={uploading} />
                </label>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>Noch kein Flyer hinterlegt.</p>
              <label className="btn-primary btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                {uploading ? '⏳ Lade…' : '+ Flyer hochladen'}
                <input type="file" accept="application/pdf" style={{ display: 'none' }}
                  onChange={e => upload(e.target.files?.[0])} disabled={uploading} />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
