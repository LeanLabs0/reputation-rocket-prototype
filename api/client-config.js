const { resolveClient } = require('../lib/known-clients');
const { getClient } = require('../lib/hubspot/store');
const { readClientConfigFile } = require('../lib/client-config-file');
const { normalizePortalSettings, pickSettingsFromConfig } = require('../lib/portal-settings');

/**
 * Public runtime config for a portal (no secrets).
 * Store wins over config.js so /configure edits apply without redeploy (when KV/local store is available).
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientSlug = String(req.query?.clientSlug || '').trim();
  if (!clientSlug) {
    return res.status(400).json({ error: 'clientSlug is required' });
  }

  const known = await resolveClient(clientSlug);
  if (!known) {
    return res.status(404).json({ error: 'Unknown client' });
  }

  const stored = await getClient(clientSlug);
  const fileConfig = readClientConfigFile(clientSlug);
  const providerName = stored?.providerName || known.providerName || clientSlug;

  const fromFile = pickSettingsFromConfig(fileConfig, providerName);
  const fromStore = stored?.portalSettings
    ? normalizePortalSettings(stored.portalSettings, { providerName })
    : null;

  const settings = fromStore || fromFile || normalizePortalSettings({}, { providerName });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    clientSlug,
    providerName,
    source: fromStore ? 'store' : (fromFile ? 'config.js' : 'defaults'),
    settings,
    hubspot: {
      portalId: stored?.portalId || fileConfig?.hubspotPortalId || known.defaultPortalId || '',
      formId: stored?.formId || fileConfig?.hubspotFormId || known.defaultFormId || '',
      formRegion: stored?.formRegion || fileConfig?.hubspotFormRegion || known.defaultFormRegion || 'na1',
    },
  });
};
