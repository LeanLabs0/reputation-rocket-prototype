const { sendOpsAlert, alertDetailFromBody, slugFromReferer, safeSlug } = require('../lib/slack-alert');

const DEFAULT_FACTOR8_API_URL = 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query';
const UPSTREAM_TIMEOUT_MS = 55000;

function factor8ApiUrl() {
  return process.env.FACTOR8_API_URL || DEFAULT_FACTOR8_API_URL;
}

function factor8ApiKey() {
  return String(process.env.FACTOR8_API_KEY || '').trim();
}

function alertFields(req, body, status, detail) {
  const config = (body && body.config) || {};
  return {
    source: 'chat request',
    clientSlug: safeSlug(body && body.client_slug) || slugFromReferer(req),
    clientName: config.client_name,
    agent: body && body.agent,
    sessionId: body && body.session_id,
    status,
    detail,
  };
}

function upstreamPayload(body) {
  const payload = { ...(body || {}) };
  delete payload.client_slug;
  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  if (!factor8ApiKey()) {
    await sendOpsAlert(alertFields(req, body, 'config', 'Missing FACTOR8_API_KEY'));
    return res.status(500).json({ error: 'Missing FACTOR8_API_KEY' });
  }

  if (!body.prompt || !body.agent || !body.session_id || !body.config) {
    return res.status(400).json({ error: 'Invalid agent request' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': factor8ApiKey(),
  };

  const stickyMachineId = req.headers['fly-force-instance-id'];
  if (stickyMachineId) {
    headers['fly-force-instance-id'] = stickyMachineId;
  }

  const payload = upstreamPayload(body);

  try {
    console.log('[agent] forwarding turn', {
      session_id: body.session_id,
      agent: body.agent,
      prompt_preview: String(body.prompt).slice(0, 80),
      client_name: body.config.client_name,
      client_slug: safeSlug(body.client_slug) || slugFromReferer(req),
      platforms: body.config.platforms,
      sticky: Boolean(stickyMachineId),
    });

    let upstream = await fetch(factor8ApiUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (upstream.status === 404 && stickyMachineId) {
      delete headers['fly-force-instance-id'];
      upstream = await fetch(factor8ApiUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      console.warn('[agent] upstream error', {
        status: upstream.status,
        statusText: upstream.statusText,
        body: text.slice(0, 500),
      });
    }
    if (upstream.status >= 500) {
      await sendOpsAlert(alertFields(req, body, upstream.status, alertDetailFromBody(text)));
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    const timedOut = Boolean(error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
    await sendOpsAlert(alertFields(
      req,
      body,
      timedOut ? 'timeout' : 'network',
      timedOut ? 'Agent request timed out' : 'Agent request failed',
    ));
    return res.status(502).json({
      error: 'Agent request failed',
      message: error.message,
    });
  }
};

module.exports.UPSTREAM_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS;
