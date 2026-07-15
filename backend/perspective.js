// Perspective.co-Integration via Anthropic MCP.
//
// Wir nutzen den offiziellen "MCP connector"-Support der Anthropic Messages
// API (Beta-Header anthropic-beta: mcp-client-2025-04-04), damit Claude
// die Perspective-Tools direkt aufrufen kann. Kein manueller REST-Client
// noetig, Perspective liefert die Tool-Schemata selbst.
//
// Voraussetzungen (ENV):
//   - ANTHROPIC_API_KEY      (schon vorhanden im Container)
//   - PERSPECTIVE_MCP_TOKEN  (Bearer-Token fuer https://api.perspective.co/mcp)
//   - PERSPECTIVE_MCP_URL    (optional, default https://api.perspective.co/mcp)
//
// Alle exportierten Funktionen sind async und werfen bei Fehlern.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL_MCP || 'claude-sonnet-4-5';
const MCP_URL = process.env.PERSPECTIVE_MCP_URL || 'https://api.perspective.co/mcp';

function requireEnv() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY nicht gesetzt.');
  if (!process.env.PERSPECTIVE_MCP_TOKEN) throw new Error('PERSPECTIVE_MCP_TOKEN nicht gesetzt — bitte in .env eintragen.');
}

/**
 * Ruft die Anthropic Messages API mit angebundenem Perspective MCP-Server auf.
 * @param {string} instruction  Frei formulierter Prompt fuer Claude.
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=4096]
 * @returns {Promise<{content:any[], tool_uses:any[], tool_results:any[], text:string}>}
 */
async function askClaudeWithPerspective(instruction, opts = {}) {
  requireEnv();
  const body = {
    model: MODEL,
    max_tokens: opts.maxTokens || 4096,
    mcp_servers: [{
      type: 'url',
      url: MCP_URL,
      name: 'perspective',
      authorization_token: process.env.PERSPECTIVE_MCP_TOKEN,
    }],
    messages: [{ role: 'user', content: instruction }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 400)}`);
  }
  const data = await res.json();

  // Claude gibt bei MCP eine Mischung aus text-Blocks und mcp_tool_use / mcp_tool_result zurueck.
  const content = Array.isArray(data.content) ? data.content : [];
  const tool_uses    = content.filter(c => c.type === 'mcp_tool_use');
  const tool_results = content.filter(c => c.type === 'mcp_tool_result');
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return { content, tool_uses, tool_results, text, raw: data };
}

/** Sucht in einer tool_results-Liste nach der Result-JSON fuer den passenden Tool-Namen. */
function findToolResult(tool_uses, tool_results, toolName) {
  const use = tool_uses.find(t => t.name === toolName);
  if (!use) return null;
  const result = tool_results.find(r => r.tool_use_id === use.id);
  if (!result?.content?.length) return null;
  // Result-Content ist ein Array von Text-Blocks; wir versuchen das erste als JSON zu parsen.
  for (const block of result.content) {
    if (block.type === 'text') {
      try { return JSON.parse(block.text); }
      catch { return { raw_text: block.text }; }
    }
  }
  return null;
}

/* ═════════════════════ Public API ═════════════════════ */

/**
 * Listet die verbundenen Custom-Domains eines Perspective-Workspaces.
 * @returns {Promise<Array<{id:string,name:string,verified?:boolean}>>}
 */
export async function listDomains() {
  const { tool_uses, tool_results } = await askClaudeWithPerspective(
    'Rufe list_domains auf und gib mir das rohe Ergebnis zurueck. Kein Kommentartext.'
  );
  const raw = findToolResult(tool_uses, tool_results, 'list_domains');
  return Array.isArray(raw) ? raw : (raw?.domains || raw?.data || []);
}

/**
 * Sucht/Erstellt ein Perspective-Brand fuer den Kunden. Wenn brand_id bereits am
 * Kunden gespeichert ist, wird nur validiert (mit list_brands). Sonst wird
 * create_brand mit source=domain aufgerufen und die ID zurueckgegeben.
 * @param {object} kunde  talentone_kunden-Row
 * @returns {Promise<{brand_id:string, created:boolean}>}
 */
export async function findOrCreateBrandForKunde(kunde) {
  if (kunde.perspective_brand_id) {
    return { brand_id: kunde.perspective_brand_id, created: false };
  }
  const domain = (kunde.website_domain || kunde.website_url || '').trim();
  if (!domain) throw new Error('Website-Domain fehlt am Kunden — bitte ergaenzen.');

  // 1. Erst: existiert schon eine Brand mit passendem Namen? (Name-Match, kein Delete-Risk)
  const listing = await askClaudeWithPerspective(
    `Rufe list_brands auf. Wenn es eine Brand mit Name "${kunde.firmenname}" gibt, gib nur { existing_brand_id: "<id>" } zurueck. Sonst rufe create_brand mit { name: "${kunde.firmenname}", source: "domain", domain: "${domain.replace(/^https?:\/\//, '')}" } auf. Antworte am Ende NUR mit einem JSON-Objekt: { brand_id: "<id>", created: true|false }.`
  );

  // Try create_brand first
  const created = findToolResult(listing.tool_uses, listing.tool_results, 'create_brand');
  if (created?.brand_id || created?.id) {
    return { brand_id: String(created.brand_id || created.id), created: true };
  }
  // Fallback: try to parse Claude's summary text as JSON
  const m = listing.text.match(/\{[\s\S]*"brand_id"[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.brand_id) return { brand_id: String(parsed.brand_id), created: !!parsed.created };
    } catch {}
  }
  throw new Error('Konnte brand_id aus Perspective-Response nicht extrahieren. Text: ' + listing.text.slice(0, 300));
}

/**
 * Loest create_funnel mit dem Recruiting-Prompt aus und gibt die job_id zurueck,
 * die dann per get_funnel_job_status gepollt werden kann.
 * @param {object} p
 * @param {string} p.brand_id
 * @param {string} p.name
 * @param {string} p.prompt  vollstaendiger Recruiting-Prompt
 * @returns {Promise<{job_id:string, funnel_id?:string}>}
 */
export async function createFunnel({ brand_id, name, prompt }) {
  const { tool_uses, tool_results, text } = await askClaudeWithPerspective(
    `Rufe create_funnel mit exakt diesen Parametern auf:\n\n{ "brandId": "${brand_id}", "name": ${JSON.stringify(name)}, "prompt": ${JSON.stringify(prompt)} }\n\nAntworte am Ende NUR mit dem JSON-Objekt { "job_id": "<id>", "funnel_id": "<id oder null>" }.`,
    { maxTokens: 2048 }
  );
  const raw = findToolResult(tool_uses, tool_results, 'create_funnel');
  const job_id = raw?.job_id || raw?.jobId || raw?.id;
  const funnel_id = raw?.funnel_id || raw?.funnelId || null;
  if (job_id) return { job_id: String(job_id), funnel_id: funnel_id ? String(funnel_id) : null };

  const m = text.match(/\{[\s\S]*"job_id"[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (j.job_id) return { job_id: String(j.job_id), funnel_id: j.funnel_id ? String(j.funnel_id) : null }; } catch {}
  }
  throw new Error('create_funnel: keine job_id in Response. Text: ' + text.slice(0, 300));
}

/**
 * Fragt den aktuellen Status eines Funnel-Erstellungs-Jobs ab.
 * @param {string} jobId
 * @returns {Promise<{status:string, funnel_id?:string, editor_url?:string, error?:string}>}
 */
export async function getFunnelJobStatus(jobId) {
  const { tool_uses, tool_results, text } = await askClaudeWithPerspective(
    `Rufe get_funnel_job_status mit { "job_id": "${jobId}" } auf. Antworte NUR mit dem JSON-Ergebnis.`
  );
  const raw = findToolResult(tool_uses, tool_results, 'get_funnel_job_status');
  if (raw?.status) {
    return {
      status: String(raw.status).toLowerCase(),
      funnel_id: raw.funnel_id || raw.funnelId || null,
      editor_url: raw.editor_url || raw.editorUrl || null,
      error: raw.error || null,
    };
  }
  const m = text.match(/\{[\s\S]*"status"[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('get_funnel_job_status: keine status-Info in Response.');
}

/**
 * Veroeffentlicht einen erstellten Funnel auf einer Custom-Domain.
 * @param {object} p
 * @param {string} p.funnel_id
 * @param {string} [p.domain_id]  Perspective domain-id (custom); wenn leer: Perspective-Standard
 * @param {string} p.slug
 * @returns {Promise<{live_url:string}>}
 */
export async function publishFunnel({ funnel_id, domain_id, slug }) {
  const params = { funnelId: funnel_id, slug };
  if (domain_id) params.domainId = domain_id;
  const { tool_uses, tool_results, text } = await askClaudeWithPerspective(
    `Rufe publish_funnel mit ${JSON.stringify(params)} auf. Antworte NUR mit dem JSON { "live_url": "<url>" }.`
  );
  const raw = findToolResult(tool_uses, tool_results, 'publish_funnel');
  const live_url = raw?.live_url || raw?.url || raw?.publicUrl;
  if (live_url) return { live_url: String(live_url) };
  const m = text.match(/https?:\/\/[^\s"'}]+/);
  if (m) return { live_url: m[0] };
  throw new Error('publish_funnel: keine live_url. Text: ' + text.slice(0, 300));
}

/**
 * Uebergibt eine Aenderungs-Anweisung an update_funnel; liefert ein neues job_id zurueck.
 */
export async function updateFunnel({ funnel_id, prompt }) {
  const { tool_uses, tool_results, text } = await askClaudeWithPerspective(
    `Rufe update_funnel mit { "funnelId": "${funnel_id}", "prompt": ${JSON.stringify(prompt)} } auf. Antworte NUR mit dem JSON { "job_id": "<id>" }.`
  );
  const raw = findToolResult(tool_uses, tool_results, 'update_funnel');
  const job_id = raw?.job_id || raw?.jobId;
  if (job_id) return { job_id: String(job_id) };
  const m = text.match(/\{[\s\S]*"job_id"[\s\S]*\}/);
  if (m) { try { const j = JSON.parse(m[0]); if (j.job_id) return { job_id: String(j.job_id) }; } catch {} }
  throw new Error('update_funnel: keine job_id in Response.');
}

/* ═════════════════════ Prompt-Builder ═════════════════════ */

const SLUG_REGEX = /[^a-z0-9]+/g;
export function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[äöüß]/g, m => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[m]))
    .replace(SLUG_REGEX, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Baut den Recruiting-Prompt fuer create_funnel.
 * @param {object} p
 * @param {object} p.job
 * @param {object} p.kunde
 * @param {'lang'|'kurz'} [p.schema='lang']
 * @param {string[]} [p.bildUrls]  optionale Referenzbild-URLs
 */
export function buildRecruitingPrompt({ job, kunde, schema = 'lang', bildUrls = [] }) {
  const fd = job.formdata_komplett || {};
  const stelle = job.stelle || 'die Stelle';
  const region = job.region || 'der Region';
  const firmenname = kunde?.firmenname || 'unser Unternehmen';
  const branche = kunde?.branche || fd.branche || '';
  const benefits = Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [];
  const usp = fd.unterschied || fd.usp || null;
  const besonderheiten = job.besonderheiten || fd.besonderheiten || null;
  const quali = job.vorqualifizierung_felder || [];

  const bildLine = bildUrls.length
    ? `\n\nECHTE KUNDENBILDER (bitte im Funnel verwenden, keine Stock-Fotos):\n${bildUrls.map(u => `- ${u}`).join('\n')}`
    : '';

  const kurz = schema === 'kurz';

  return `WICHTIG — Kontext:
- Recruiting-Funnel fuer wechselwillige ${stelle} in ${region}
- Traffic-Quelle: kalter Meta-Traffic (Facebook/Instagram-Ads)
- Sprache: Deutsch, Du-Form, bodenstaendig, ehrlich, kein Marketing-Sprech
- Zielgruppe fuehlt sich zuhause bei Handwerk/Praxis, nicht bei Bullshit-Bingo
- Firma: ${firmenname}${branche ? ` (${branche})` : ''}${usp ? `. USP: ${usp}` : ''}${besonderheiten ? `. Besonderheiten: ${besonderheiten}` : ''}

Konversionsziel: Bewerbung in ${kurz ? '30' : '60'} Sekunden ohne Lebenslauf.

Aufbau ${kurz ? '(kurz)' : '(lang)'}:
${kurz ? `1. Start-Hook: eingaengige Headline + 1-2 Saetze warum diese Stelle anders ist
2. Benefits kompakt: 3-4 wichtigste Punkte mit Icons
3. 1-2 Kurz-Fragen (Auto-Weiter)
4. Kontakt: Name + Telefon-PFLICHT + Email
5. Danke: nachste Schritte`
: `1. Start-Hook: Headline + Sub-Headline + 60-Sekunden-Versprechen + 2 CTAs
2. Vorteile: die Benefits als eigene Seite mit Icons und je 1 Satz Kontext:
${benefits.length ? benefits.map(b => `   - ${b}`).join('\n') : '   (Benefits mit Icons pro Zeile)'}
3. Aufgaben: kurzer Text was der Alltag beim Job wirklich ist (was er NICHT ist)
4. 3 Quali-Fragen mit Auto-Weiter${quali.length ? ' — beruecksichtige diese Felder: ' + quali.map(f => (f.frage || f.label || f)).join(', ') : ' (Ausbildung / Fuehrerschein / Verfuegbarkeit)'}
5. Kontakt: Vorname + Nachname + Telefon-PFLICHT (mit Validierung) + E-Mail
6. Danke-Seite: sichtbare naechste Schritte, Kontakt-Zusage in Zeitrahmen (z.B. 24h)`}

Design: mobile-first, Fortschrittsbalken sichtbar, Buttons gross und offensichtlich, Kontaktseite muss auf einen Blick zum Absenden fuehren.
Farben: Marken-Farben der Brand verwenden. Wenn ein zweiter Akzent gebraucht wird (z.B. fuer Warnungen/CTA): eine kraeftige, freundliche Kontrastfarbe passend zur Zielgruppe (Handwerk = z.B. Warnweste-Orange, Buero = z.B. dunkles Petrol).${bildLine}`;
}
