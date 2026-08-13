const crypto = require('crypto');
const { requireAuth } = require('../../lib/configure-auth');
const { appConfig, buildInstallUrl, isOAuthConfigured } = require('../../lib/hubspot/oauth');
const { resolveClient } = require('../../lib/known-clients');
const { upsertClient } = require('../../lib/hubspot/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  if (!isOAuthConfigured()) {
    return res.status(500).json({
      error: 'HubSpot app not configured',
      detail: 'Set HUBSPOT_APP_CLIENT_ID, HUBSPOT_APP_CLIENT_SECRET, and HUBSPOT_APP_REDIRECT_URI.',
    });
  }

  const clientSlug = String(req.body?.clientSlug || '').trim();
  if (!(await resolveClient(clientSlug))) {
    return res.status(400).json({ error: 'Unknown clientSlug' });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `${clientSlug}.${nonce}`;
  await upsertClient(clientSlug, { oauthState: state, oauthStartedAt: new Date().toISOString() });

  const installUrl = buildInstallUrl({ clientSlug, state });
  return res.status(200).json({
    ok: true,
    installUrl,
    state,
    redirectUri: appConfig().redirectUri,
  });
};
