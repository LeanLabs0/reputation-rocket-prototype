/**
 * Ops alerts for Reputation Rocket outages.
 *
 * Posts with the Slack bot this app already uses (SLACK_BOT_TOKEN, the
 * "Reputation Rocket" bot) via chat.postMessage. Destination is #ai-support
 * unless SLACK_ALERT_CHANNEL overrides it. This is not the per-client review
 * thread used by /api/notify, and it is not an incoming webhook.
 *
 * If SLACK_BOT_TOKEN is unset the helper returns immediately.
 *
 * Cooldown (one Slack message per error signature):
 *   - 15 minutes
 *   - Keyed by upstream status + scrubbed detail, not by session or client.
 *     The client named in the message is whoever hit it first in the window.
 *   - This process remembers the key in memory, so one warm instance cannot
 *     spam. Serverless instances do not share that memory.
 *   - When KV_REST_API_URL and KV_REST_API_TOKEN are set (they are on Vercel),
 *     a SET NX EX 900 makes the same window apply across instances.
 *   - If KV is unset or errors, we still send, limited by this instance's
 *     memory. A cold-start burst can post a handful of copies, not one per
 *     visitor. A different status or detail alerts on its own.
 *
 * The Slack call is awaited with a 2s timeout so Vercel does not freeze the
 * function before the post finishes. Nothing here throws.
 */

const crypto = require('crypto');
const { kvCommand, kvConfigured } = require('./kv-rest');

const DEFAULT_ALERT_CHANNEL = 'C09BD2WUQ4B'; // #ai-support
const COOLDOWN_MS = 15 * 60 * 1000;
const COOLDOWN_SEC = Math.round(COOLDOWN_MS / 1000);
const SLACK_TIMEOUT_MS = 2000;
const DETAIL_MAX = 400;
const KV_KEY_PREFIX = 'rr:ops-alert:';

const recent = new Map();

function slackToken() {
  return String(process.env.SLACK_BOT_TOKEN || '').trim();
}

function slackChannel() {
  const override = String(process.env.SLACK_ALERT_CHANNEL || '').trim();
  return override || DEFAULT_ALERT_CHANNEL;
}

function scrubAlertText(value, max = DETAIL_MAX) {
  const text = String(value == null ? '' : value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted-token]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/https:\/\/hooks\.slack\.com\/services\/\S+/gi, '[redacted-webhook]')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function safeToken(value, pattern, fallback) {
  const text = String(value || '').trim();
  return pattern.test(text) ? text : fallback;
}

function safeSlug(value) {
  return safeToken(String(value || '').trim().toLowerCase(), /^[a-z0-9-]{1,80}$/, '');
}

function safeName(value) {
  const text = scrubAlertText(value, 80);
  if (!text || text === '[redacted-email]') return '';
  return text;
}

function environmentName() {
  const raw = process.env.VERCEL_ENV || process.env.NODE_ENV || 'local';
  return safeToken(String(raw).toLowerCase(), /^[a-z0-9_-]{1,32}$/, 'local');
}

function slugFromReferer(req) {
  const headers = (req && req.headers) || {};
  const referer = headers.referer || headers.referrer || '';
  try {
    const url = new URL(referer);
    const seg = url.pathname.split('/').filter(Boolean)[0] || '';
    return safeSlug(seg);
  } catch (_) {
    return '';
  }
}

/**
 * Prefer a short error string. Never dump a whole JSON body: Factor8 may
 * echo the prompt or the customer fields.
 */
function alertDetailFromBody(text) {
  const raw = String(text || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const preferred = [parsed.detail, parsed.error, parsed.message]
        .find((item) => typeof item === 'string' && item.trim());
      if (preferred) return scrubAlertText(preferred);
      const nested = parsed.error && typeof parsed.error === 'object'
        ? parsed.error.message
        : '';
      if (typeof nested === 'string' && nested.trim()) return scrubAlertText(nested);
      return 'Upstream returned an error';
    }
  } catch (_) { /* not JSON */ }
  return scrubAlertText(raw) || 'Upstream returned an error';
}

function formatUpstream(status) {
  if (typeof status === 'number' && status > 0) return `HTTP ${status}`;
  const text = safeToken(status, /^[a-z0-9_-]{1,32}$/i, '');
  return text || 'unknown';
}

function formatClient(slug, name) {
  if (slug && name) return `${slug} (${name})`;
  return slug || name || 'unknown';
}

function normalizeDetail(detail) {
  return scrubAlertText(detail, 200).toLowerCase();
}

function dedupeKey(status, detail) {
  const raw = `${formatUpstream(status)}\n${normalizeDetail(detail)}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function pruneMemory(now) {
  if (recent.size < 100) return;
  for (const [key, at] of recent) {
    if (now - at >= COOLDOWN_MS) recent.delete(key);
  }
}

function memoryClaim(key, now) {
  pruneMemory(now);
  const prev = recent.get(key) || 0;
  if (now - prev < COOLDOWN_MS) return false;
  recent.set(key, now);
  return true;
}

/**
 * true = this caller may send. false = another instance already did.
 * Unconfigured or broken KV fails open (the in-memory claim still applies).
 */
async function crossInstanceClaim(key) {
  if (!kvConfigured()) return true;
  const result = await kvCommand(
    ['SET', `${KV_KEY_PREFIX}${key}`, '1', 'NX', 'EX', String(COOLDOWN_SEC)],
    800,
  );
  if (!result.ok) return true;
  return result.result === 'OK';
}

function buildOpsAlertText(fields) {
  return [
    ':rotating_light: *Reputation Rocket chat is failing*',
    `Source: ${fields.source}`,
    `Environment: ${fields.environment}`,
    `Client: ${fields.client}`,
    `Agent: ${fields.agent}`,
    `Session: ${fields.sessionId}`,
    `Upstream: ${fields.upstream}`,
    `Detail: ${fields.detail}`,
    `Time: ${fields.timestamp}`,
  ].join('\n');
}

function presentAlert(input) {
  const source = input.source === 'deep health check' ? 'deep health check' : 'chat request';
  const slug = safeSlug(input.clientSlug);
  const name = safeName(input.clientName);
  const detail = scrubAlertText(input.detail) || 'Unknown error';
  return {
    source,
    environment: environmentName(),
    client: formatClient(slug, name),
    agent: safeToken(input.agent, /^[A-Za-z0-9_-]{1,80}$/, 'unknown'),
    sessionId: safeToken(input.sessionId, /^[A-Za-z0-9_-]{1,80}$/, 'unknown'),
    upstream: formatUpstream(input.status),
    detail,
    timestamp: input.timestamp || new Date().toISOString(),
    dedupe: dedupeKey(input.status, detail),
  };
}

async function postToSlack(text) {
  const token = slackToken();
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: slackChannel(),
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) { /* ignore */ }
  if (!res.ok || !data.ok) {
    console.warn('[alert] slack post failed', data.error || res.status);
    return false;
  }
  return true;
}

async function sendOpsAlert(input) {
  try {
    if (!slackToken()) return { sent: false, skipped: 'unconfigured' };
    const fields = presentAlert(input || {});
    const now = Date.now();
    if (!memoryClaim(fields.dedupe, now)) return { sent: false, skipped: 'cooldown' };
    const allowed = await crossInstanceClaim(fields.dedupe);
    if (!allowed) return { sent: false, skipped: 'cooldown' };
    const sent = await postToSlack(buildOpsAlertText(fields));
    return { sent, skipped: sent ? null : 'slack' };
  } catch (err) {
    console.warn('[alert] failed', err && err.name ? err.name : 'error');
    return { sent: false, skipped: 'error' };
  }
}

function resetOpsAlertCooldown() {
  recent.clear();
}

module.exports = {
  sendOpsAlert,
  buildOpsAlertText,
  presentAlert,
  scrubAlertText,
  alertDetailFromBody,
  slugFromReferer,
  safeSlug,
  dedupeKey,
  resetOpsAlertCooldown,
  DEFAULT_ALERT_CHANNEL,
  COOLDOWN_MS,
  SLACK_TIMEOUT_MS,
};
