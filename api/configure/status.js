const { isAuthConfigured, isAuthenticated } = require('../../lib/configure-auth');
const { oauthEnvStatus, HUBSPOT_SCOPES } = require('../../lib/hubspot/oauth');
const { listAllClients, getKnownClient } = require('../../lib/known-clients');
const { envPat } = require('../../lib/hubspot/tokens');
const { FORM_NAME } = require('../../lib/hubspot/provision');
const { folderExists } = require('../../lib/scaffold-client');
const { readClientConfigFile } = require('../../lib/client-config-file');
const { hasKvStore } = require('../../lib/hubspot/store');
const {
  AVAILABLE_PLATFORMS,
  mergePortalSettings,
} = require('../../lib/portal-settings');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const oauth = oauthEnvStatus();
    const onVercel = Boolean(process.env.VERCEL);
    const kv = hasKvStore();
    const authConfigured = isAuthConfigured();

    const missing = [
      ...(!authConfigured ? ['CONFIGURE_PASSWORD'] : []),
      ...oauth.missing,
    ];
    if (onVercel && !kv) {
      if (!String(process.env.KV_REST_API_URL || '').trim()) missing.push('KV_REST_API_URL');
      if (!String(process.env.KV_REST_API_TOKEN || '').trim()) missing.push('KV_REST_API_TOKEN');
    }

    const authed = isAuthenticated(req);
    if (!authed) {
      return res.status(200).json({
        ok: true,
        authenticated: false,
        authConfigured,
        oauthConfigured: oauth.configured,
        oauth,
        onVercel,
        missing,
        storage: {
          mode: kv ? 'kv' : 'local-file',
          persistent: kv || !onVercel,
        },
      });
    }

    const all = await listAllClients();
    const clients = all.map((known) => {
      const publicRec = known._store || null;
      const portalId = publicRec?.portalId || known.defaultPortalId || '';
      const formId = publicRec?.formId || known.defaultFormId || '';
      let fileConfig = null;
      try {
        fileConfig = readClientConfigFile(known.clientSlug);
      } catch (_) {
        fileConfig = null;
      }
      const providerName = publicRec?.providerName || known.providerName;
      const portalSettings = mergePortalSettings(
        publicRec?.portalSettings,
        fileConfig,
        providerName,
      );
      const settingsSource = publicRec?.portalSettings
        ? 'store'
        : (fileConfig ? 'config.js' : 'defaults');

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
        settingsSource,
        isBuiltIn: Boolean(getKnownClient(known.clientSlug)),
      };
    });

    return res.status(200).json({
      ok: true,
      authenticated: true,
      authConfigured: true,
      oauthConfigured: oauth.configured,
      oauth: {
        ...oauth,
        scopes: HUBSPOT_SCOPES,
        formName: FORM_NAME,
      },
      storage: {
        mode: kv ? 'kv' : 'local-file',
        persistent: kv || !onVercel,
        warning: onVercel && !kv
          ? 'KV is required on Vercel. Set KV_REST_API_URL + KV_REST_API_TOKEN (from the Vercel Upstash/Redis integration).'
          : '',
      },
      availablePlatforms: AVAILABLE_PLATFORMS,
      clients,
      canScaffold: !onVercel,
      onVercel,
      missing,
    });
  } catch (err) {
    console.error('[configure/status]', err);
    return res.status(500).json({
      ok: false,
      error: 'Configure status failed',
      detail: err.message || String(err),
    });
  }
};
