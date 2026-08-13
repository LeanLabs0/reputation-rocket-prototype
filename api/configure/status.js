const { isAuthConfigured, isAuthenticated } = require('../../lib/configure-auth');
const { isOAuthConfigured, appConfig, HUBSPOT_SCOPES } = require('../../lib/hubspot/oauth');
const { listClients, publicClient } = require('../../lib/hubspot/store');
const { KNOWN_CLIENTS } = require('../../lib/known-clients');
const { envPat } = require('../../lib/hubspot/tokens');
const { FORM_NAME } = require('../../lib/hubspot/provision');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Allow unauthenticated bootstrap so the UI knows if password/OAuth are set.
  const authed = isAuthenticated(req);
  if (!authed) {
    return res.status(200).json({
      authenticated: false,
      authConfigured: isAuthConfigured(),
      oauthConfigured: isOAuthConfigured(),
    });
  }

  const stored = await listClients();
  const clients = KNOWN_CLIENTS.map((known) => {
    const record = stored[known.clientSlug];
    const publicRec = publicClient(record);
    const portalId = publicRec?.portalId || known.defaultPortalId || '';
    const formId = publicRec?.formId || known.defaultFormId || '';
    return {
      ...known,
      portalId,
      formId,
      formRegion: publicRec?.formRegion || known.defaultFormRegion || 'na1',
      formName: publicRec?.formName || FORM_NAME,
      connected: Boolean(publicRec?.hasRefreshToken),
      hasEnvPat: Boolean(envPat(known.clientSlug, portalId)),
      provisionedAt: publicRec?.provisionedAt || null,
      properties: publicRec?.properties || null,
      hubspotCompleteProperty: publicRec?.hubspotCompleteProperty || 'rr_iscomplete',
      hubspotOutcomeProperty: publicRec?.hubspotOutcomeProperty || 'rr_outcome',
      slackNotes: publicRec?.slackNotes || '',
      updatedAt: publicRec?.updatedAt || null,
    };
  });

  const { clientId, redirectUri } = appConfig();
  return res.status(200).json({
    authenticated: true,
    authConfigured: true,
    oauthConfigured: isOAuthConfigured(),
    oauth: {
      clientIdConfigured: Boolean(clientId),
      redirectUri,
      scopes: HUBSPOT_SCOPES,
      formName: FORM_NAME,
    },
    storage: {
      mode: process.env.UPSTASH_REDIS_REST_URL ? 'upstash' : 'local-file',
    },
    clients,
  });
};
