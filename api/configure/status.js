const { isAuthConfigured, isAuthenticated } = require('../../lib/configure-auth');
const { isOAuthConfigured, appConfig, HUBSPOT_SCOPES } = require('../../lib/hubspot/oauth');
const { listAllClients, getKnownClient } = require('../../lib/known-clients');
const { envPat } = require('../../lib/hubspot/tokens');
const { FORM_NAME } = require('../../lib/hubspot/provision');
const { folderExists } = require('../../lib/scaffold-client');
const { readClientConfigFile } = require('../../lib/client-config-file');
const {
  AVAILABLE_PLATFORMS,
  normalizePortalSettings,
  pickSettingsFromConfig,
} = require('../../lib/portal-settings');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authed = isAuthenticated(req);
  if (!authed) {
    return res.status(200).json({
      authenticated: false,
      authConfigured: isAuthConfigured(),
      oauthConfigured: isOAuthConfigured(),
    });
  }

  const all = await listAllClients();
  const clients = all.map((known) => {
    const publicRec = known._store || null;
    const portalId = publicRec?.portalId || known.defaultPortalId || '';
    const formId = publicRec?.formId || known.defaultFormId || '';
    const fileConfig = readClientConfigFile(known.clientSlug);
    const providerName = publicRec?.providerName || known.providerName;
    const fromStore = publicRec?.portalSettings
      ? normalizePortalSettings(publicRec.portalSettings, { providerName })
      : null;
    const fromFile = pickSettingsFromConfig(fileConfig, providerName);
    const portalSettings = fromStore || fromFile || normalizePortalSettings({}, { providerName });

    return {
      clientSlug: known.clientSlug,
      providerName,
      portalPath: known.portalPath,
      portalId,
      formId,
      formRegion: publicRec?.formRegion || known.defaultFormRegion || 'na1',
      formName: publicRec?.formName || FORM_NAME,
      connected: Boolean(publicRec?.hasRefreshToken),
      hasEnvPat: Boolean(envPat(known.clientSlug, portalId)),
      folderExists: folderExists(known.clientSlug),
      provisionedAt: publicRec?.provisionedAt || null,
      properties: publicRec?.properties || null,
      hubspotCompleteProperty: publicRec?.hubspotCompleteProperty || 'rr_iscomplete',
      hubspotOutcomeProperty: publicRec?.hubspotOutcomeProperty || 'rr_outcome',
      slackNotes: publicRec?.slackNotes || '',
      updatedAt: publicRec?.updatedAt || null,
      portalSettings,
      settingsSource: fromStore ? 'store' : (fromFile ? 'config.js' : 'defaults'),
      isBuiltIn: Boolean(getKnownClient(known.clientSlug)),
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
    availablePlatforms: AVAILABLE_PLATFORMS,
    clients,
    canScaffold: !process.env.VERCEL, // filesystem writes only work locally
  });
};
