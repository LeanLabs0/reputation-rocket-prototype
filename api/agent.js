const FACTOR8_API_URL = process.env.FACTOR8_API_URL || 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query';
const FACTOR8_API_KEY = process.env.FACTOR8_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!FACTOR8_API_KEY) {
    return res.status(500).json({ error: 'Missing FACTOR8_API_KEY' });
  }

  const body = req.body || {};
  if (!body.prompt || !body.agent || !body.session_id || !body.config) {
    return res.status(400).json({ error: 'Invalid agent request' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': FACTOR8_API_KEY,
  };

  const stickyMachineId = req.headers['fly-force-instance-id'];
  if (stickyMachineId) {
    headers['fly-force-instance-id'] = stickyMachineId;
  }

  try {
    console.log('[agent] forwarding turn', {
      session_id: body.session_id,
      agent: body.agent,
      prompt_preview: String(body.prompt).slice(0, 80),
      client_name: body.config.client_name,
      platforms: body.config.platforms,
      sticky: Boolean(stickyMachineId),
    });

    let upstream = await fetch(FACTOR8_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (upstream.status === 404 && stickyMachineId) {
      delete headers['fly-force-instance-id'];
      upstream = await fetch(FACTOR8_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: 'Agent request failed',
      message: error.message,
    });
  }
};
