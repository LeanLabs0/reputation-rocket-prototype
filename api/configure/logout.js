const { clearSessionCookieHeader } = require('../../lib/configure-auth');
const { requireConfigureLocal } = require('../../lib/configure-local');

module.exports = async function handler(req, res) {
  if (!requireConfigureLocal(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.status(200).json({ ok: true });
};
