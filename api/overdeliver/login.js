const {
  isAuthConfigured,
  passwordsMatch,
  overdeliverPassword,
  createSessionToken,
  sessionCookieHeader,
} = require('../../lib/overdeliver-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Clients password not set' });
  }

  const password = String(req.body?.password || '');
  if (!passwordsMatch(password.trim(), overdeliverPassword())) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken()));
  return res.status(200).json({ ok: true });
};
