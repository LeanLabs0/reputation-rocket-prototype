const {
  configurePassword,
  isAuthConfigured,
  createSessionToken,
  sessionCookieHeader,
} = require('../../lib/configure-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthConfigured()) {
    return res.status(500).json({
      error: 'Configure password not set',
      detail: 'Set CONFIGURE_PASSWORD in Vercel / .env.local',
    });
  }

  const password = String(req.body?.password || '').trim();
  if (!password || password !== configurePassword()) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = createSessionToken();
  res.setHeader('Set-Cookie', sessionCookieHeader(token));
  return res.status(200).json({ ok: true });
};
