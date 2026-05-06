// Gemeinsamer Claude-API-Wrapper mit Retry-Policy.
// 429 (Rate-Limit), 529 (Overloaded), 5xx → bis zu 4 Versuche mit exp. Backoff + Jitter.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export async function callClaudeWithRetry(payload, maxAttempts = 4) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY nicht gesetzt.');
  }

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) return await response.json();

    const body = await response.text();
    const retryable = response.status === 429 || response.status === 529 || response.status >= 500;
    lastErr = new Error(`Claude API ${response.status}: ${body.slice(0, 200)}`);

    if (!retryable || attempt === maxAttempts) throw lastErr;

    const base = 1500 * Math.pow(2, attempt - 1); // 1.5s, 3s, 6s
    const jitter = Math.floor(Math.random() * 500);
    const wait = base + jitter;
    console.warn(`[Claude] ${response.status} — retry ${attempt}/${maxAttempts - 1} in ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
  }
  throw lastErr;
}

// Liest content[0].text aus, entfernt Markdown-Backticks, parsed JSON.
export function parseJsonContent(claudeResponse) {
  const raw = claudeResponse.content?.[0]?.text || '{}';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Claude-Antwort war kein gültiges JSON.');
  }
}
