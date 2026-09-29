/**
 * Zero-token uptime probe for the chat path (polled by the aeo-tools
 * scan-health job every 10 minutes). Confirms this deployment can reach
 * Factor8 with its own FACTOR8_API_KEY by listing agents, which never calls
 * the AI. A rotated or missing key, or Factor8 being unreachable, fails here
 * within one check instead of waiting for the once-a-day real chat turn.
 *
 * Public, so it returns short reason codes only (never upstream bodies).
 */
const FACTOR8_API_URL = process.env.FACTOR8_API_URL || 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query';
const FACTOR8_API_KEY = process.env.FACTOR8_API_KEY;

const TIMEOUT_MS = 15000;

function agentsUrl() {
  return FACTOR8_API_URL.replace(/\/query\/?$/, '/agents');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  if (!FACTOR8_API_KEY) {
    return res.status(503).json({ ok: false, reason: 'missing_factor8_key' });
  }

  try {
    const upstream = await fetch(agentsUrl(), {
      headers: { 'X-API-Key': FACTOR8_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (upstream.ok) {
      return res.status(200).json({ ok: true });
    }
    const reason = upstream.status === 401 || upstream.status === 403
      ? 'factor8_key_rejected'
      : `factor8_http_${upstream.status}`;
    return res.status(503).json({ ok: false, reason });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return res.status(503).json({ ok: false, reason: timedOut ? 'factor8_timeout' : 'factor8_unreachable' });
  }
};

module.exports.agentsUrl = agentsUrl;
