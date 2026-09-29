/**
 * Zero-token uptime probe for the chat path (polled by the aeo-tools
 * scan-health job every 10 minutes). Confirms this deployment can reach
 * Factor8 with its own FACTOR8_API_KEY by listing agents, which never calls
 * the AI. A rotated or missing key, or Factor8 being unreachable, fails here
 * within one check instead of waiting for the once-a-day real chat turn.
 *
 * Public, so it returns short reason codes only (never upstream bodies,
 * raw errors, or the API key).
 */
const DEFAULT_FACTOR8_API_URL = 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30000;

let cached = null;
let inFlight = null;

function factor8ApiUrl() {
  return process.env.FACTOR8_API_URL || DEFAULT_FACTOR8_API_URL;
}

function factor8ApiKey() {
  return process.env.FACTOR8_API_KEY;
}

/**
 * Derive the agents list URL from the chat query URL.
 * Returns null (never the query URL) if the path is not …/query, so a
 * mis-set FACTOR8_API_URL cannot turn this probe into an AI call.
 */
function agentsUrl(apiUrl = factor8ApiUrl()) {
  try {
    const parsed = new URL(String(apiUrl));
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/query')) return null;
    parsed.pathname = `${pathname.slice(0, -'/query'.length)}/agents`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

async function discardBody(response) {
  if (!response || typeof response.arrayBuffer !== 'function') return;
  try {
    await response.arrayBuffer();
  } catch {
    // Ignore drain failures; the caller only uses status, never the body.
  }
}

function isTimedOut(err) {
  return Boolean(err && (err.name === 'TimeoutError' || err.name === 'AbortError'));
}

async function probeFactor8() {
  const apiKey = factor8ApiKey();
  if (!apiKey) {
    return { status: 503, body: { ok: false, reason: 'missing_factor8_key' } };
  }

  const url = agentsUrl();
  if (!url) {
    return { status: 503, body: { ok: false, reason: 'bad_factor8_url' } };
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await discardBody(upstream);
    if (upstream.ok) {
      return { status: 200, body: { ok: true } };
    }
    const reason = upstream.status === 401 || upstream.status === 403
      ? 'factor8_key_rejected'
      : `factor8_http_${upstream.status}`;
    return { status: 503, body: { ok: false, reason } };
  } catch (err) {
    return {
      status: 503,
      body: { ok: false, reason: isTimedOut(err) ? 'factor8_timeout' : 'factor8_unreachable' },
    };
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(res, 405, { ok: false, reason: 'method_not_allowed' });
  }

  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return reply(res, cached.status, cached.body);
  }

  if (!inFlight) {
    inFlight = probeFactor8().finally(() => {
      inFlight = null;
    });
  }

  const result = await inFlight;
  cached = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    status: result.status,
    body: result.body,
  };
  return reply(res, result.status, result.body);
}

function resetHealthCache() {
  cached = null;
  inFlight = null;
}

module.exports = handler;
module.exports.agentsUrl = agentsUrl;
module.exports.resetHealthCache = resetHealthCache;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports.TIMEOUT_MS = TIMEOUT_MS;
