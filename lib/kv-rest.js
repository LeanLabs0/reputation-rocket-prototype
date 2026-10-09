/**
 * Tiny Upstash REST helper for the KV store this app already uses
 * (KV_REST_API_URL + KV_REST_API_TOKEN). Failures return { ok: false }
 * and never throw, so a KV blip cannot break a user request.
 */

const KV_TIMEOUT_MS = 800;

function kvConfigured() {
  return Boolean(String(process.env.KV_REST_API_URL || '').trim()
    && String(process.env.KV_REST_API_TOKEN || '').trim());
}

async function kvCommand(args, timeoutMs = KV_TIMEOUT_MS) {
  if (!kvConfigured()) return { ok: false, reason: 'unconfigured' };
  const url = String(process.env.KV_REST_API_URL).trim().replace(/\/$/, '');
  const token = String(process.env.KV_REST_API_TOKEN).trim();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      try { await res.arrayBuffer(); } catch (_) { /* ignore */ }
      return { ok: false, reason: 'http', status: res.status };
    }
    const data = await res.json();
    return { ok: true, result: data ? data.result : null };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}

module.exports = {
  kvConfigured,
  kvCommand,
  KV_TIMEOUT_MS,
};
