const { isAuthenticated, clearSessionCookieHeader } = require('../../lib/overdeliver-auth');
const { listOverdeliverPages } = require('../../lib/overdeliver-catalog');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(200).json({ clients: listOverdeliverPages() });
};
