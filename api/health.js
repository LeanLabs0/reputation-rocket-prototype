/**
 * Uptime probe for the chat path.
 *
 * The default GET (no query) is the zero-token check polled by the aeo-tools
 * scan-health job. It lists Factor8 agents and never calls the model. That
 * check stayed green during the Oct 9 2026 outage, because Factor8 itself
 * was up while Anthropic was rejecting chat turns.
 *
 * GET /api/health?deep=1 runs one tiny chat turn. It returns non-200 when
 * that turn fails, and posts to #ai-support. Do not add ?deep=1 to the
 * normal visitor traffic or to the existing zero-token poller unless you
 * mean to spend a model call. Results are cached for 8 minutes so a tight
 * loop cannot fan out. When KV is configured, instances share that cache.
 *
 * If DEEP_HEALTH_TOKEN is set, deep checks must send it as
 * Authorization: Bearer <token> or ?token=. The token is optional so an
 * external monitor can call the URL before the secret exists.
 *
 * Public responses are short reason codes only (never upstream bodies,
 * raw errors, or the API key). The Slack message carries the truncated
 * upstream detail.
 */
const crypto = require('crypto');
const { sendOpsAlert, alertDetailFromBody } = require('../lib/slack-alert');
const { kvCommand, kvConfigured } = require('../lib/kv-rest');

const DEFAULT_FACTOR8_API_URL = 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query';
const TIMEOUT_MS = 8000;
const DEEP_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 30000;
const DEEP_CACHE_TTL_MS = 8 * 60 * 1000;
const DEEP_CACHE_KEY = 'rr:health:deep';

const DEEP_PROMPT = 'Health check only. Reply with the single word ok.';

let cached = null;
let inFlight = null;
let deepCached = null;
let deepInFlight = null;

function factor8ApiUrl() {
  return process.env.FACTOR8_API_URL || DEFAULT_FACTOR8_API_URL;
}

function factor8ApiKey() {
  return String(process.env.FACTOR8_API_KEY || '').trim();
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

function queryUrl(apiUrl = factor8ApiUrl()) {
  try {
    const parsed = new URL(String(apiUrl));
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/query')) return null;
    parsed.pathname = pathname;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function searchParams(req) {
  const fromQuery = req && req.query && typeof req.query === 'object' ? req.query : {};
  const raw = (req && req.url) || '';
  const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const params = new URLSearchParams(q);
  return { fromQuery, params };
}

function wantsDeep(req) {
  const { fromQuery, params } = searchParams(req);
  const deep = fromQuery.deep != null ? fromQuery.deep : params.get('deep');
  return deep === '1' || deep === 'true' || deep === true;
}

function headerValue(req, name) {
  const headers = (req && req.headers) || {};
  const direct = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0] || '';
  return direct || '';
}

function tokenMatches(expected, provided) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function deepAuthorized(req) {
  const expected = String(process.env.DEEP_HEALTH_TOKEN || '').trim();
  if (!expected) return true;
  const header = String(headerValue(req, 'authorization') || '');
  if (header.startsWith('Bearer ') && tokenMatches(expected, header.slice('Bearer '.length).trim())) {
    return true;
  }
  const { fromQuery, params } = searchParams(req);
  const token = fromQuery.token != null ? fromQuery.token : params.get('token');
  return tokenMatches(expected, token);
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

function deepRequestBody(sessionId) {
  return {
    prompt: DEEP_PROMPT,
    agent: 'reputation-rocket',
    session_id: sessionId,
    config: {
      client_name: 'Health check',
      customer_name: 'Health Check',
      customer_email: 'healthcheck@example.com',
      platforms: ['hubspot'],
      review_links: { hubspot: 'https://example.com/health-check' },
    },
  };
}

async function probeDeep() {
  const sessionId = `health-deep-${Date.now()}`;
  const apiKey = factor8ApiKey();
  if (!apiKey) {
    return {
      status: 503,
      body: { ok: false, deep: true, reason: 'missing_factor8_key' },
      alert: { status: 'config', detail: 'Missing FACTOR8_API_KEY', sessionId },
    };
  }

  const url = queryUrl();
  if (!url) {
    return {
      status: 503,
      body: { ok: false, deep: true, reason: 'bad_factor8_url' },
      alert: { status: 'config', detail: 'FACTOR8_API_URL is not a /query endpoint', sessionId },
    };
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(deepRequestBody(sessionId)),
      signal: AbortSignal.timeout(DEEP_TIMEOUT_MS),
    });
    const text = typeof upstream.text === 'function' ? await upstream.text() : '';
    if (upstream.ok) {
      return { status: 200, body: { ok: true, deep: true } };
    }
    const reason = upstream.status === 401 || upstream.status === 403
      ? 'factor8_key_rejected'
      : `factor8_http_${upstream.status}`;
    return {
      status: 503,
      body: { ok: false, deep: true, reason },
      alert: { status: upstream.status, detail: alertDetailFromBody(text), sessionId },
    };
  } catch (err) {
    const timedOut = isTimedOut(err);
    return {
      status: 503,
      body: { ok: false, deep: true, reason: timedOut ? 'factor8_timeout' : 'factor8_unreachable' },
      alert: {
        status: timedOut ? 'timeout' : 'network',
        detail: timedOut ? 'Deep health check timed out' : 'Deep health check could not reach Factor8',
        sessionId,
      },
    };
  }
}

async function readSharedDeepCache() {
  if (!kvConfigured()) return null;
  const result = await kvCommand(['GET', DEEP_CACHE_KEY]);
  if (!result.ok || typeof result.result !== 'string' || !result.result) return null;
  try {
    const parsed = JSON.parse(result.result);
    if (!parsed || !parsed.body || !parsed.status || !parsed.expiresAt) return null;
    if (Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function writeSharedDeepCache(entry) {
  if (!kvConfigured()) return;
  const ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  await kvCommand(['SET', DEEP_CACHE_KEY, JSON.stringify(entry), 'EX', String(ttlSec)]);
}

async function storeDeepCache(result) {
  const entry = {
    status: result.status,
    body: result.body,
    expiresAt: Date.now() + DEEP_CACHE_TTL_MS,
  };
  deepCached = entry;
  await writeSharedDeepCache(entry);
  return entry;
}

async function executeDeep() {
  const shared = await readSharedDeepCache();
  if (shared) {
    deepCached = shared;
    return shared;
  }
  const result = await probeDeep();
  if (result.alert) {
    await sendOpsAlert({
      source: 'deep health check',
      clientSlug: 'health-check',
      clientName: 'Health check',
      agent: 'reputation-rocket',
      sessionId: result.alert.sessionId,
      status: result.alert.status,
      detail: result.alert.detail,
    });
  }
  await storeDeepCache(result);
  return result;
}

async function runDeep(res) {
  if (deepCached && Date.now() < deepCached.expiresAt) {
    return reply(res, deepCached.status, deepCached.body);
  }
  if (!deepInFlight) {
    deepInFlight = executeDeep().finally(() => {
      deepInFlight = null;
    });
  }
  const result = await deepInFlight;
  return reply(res, result.status, result.body);
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(res, 405, { ok: false, reason: 'method_not_allowed' });
  }

  if (wantsDeep(req)) {
    if (!deepAuthorized(req)) {
      return reply(res, 401, { ok: false, reason: 'deep_unauthorized' });
    }
    return runDeep(res);
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
  deepCached = null;
  deepInFlight = null;
}

module.exports = handler;
module.exports.agentsUrl = agentsUrl;
module.exports.queryUrl = queryUrl;
module.exports.wantsDeep = wantsDeep;
module.exports.resetHealthCache = resetHealthCache;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports.DEEP_CACHE_TTL_MS = DEEP_CACHE_TTL_MS;
module.exports.TIMEOUT_MS = TIMEOUT_MS;
module.exports.DEEP_TIMEOUT_MS = DEEP_TIMEOUT_MS;
module.exports.DEEP_PROMPT = DEEP_PROMPT;
