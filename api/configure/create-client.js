const { requireAuth } = require('../../lib/configure-auth');
const { upsertClient, getClient } = require('../../lib/hubspot/store');
const { getKnownClient } = require('../../lib/known-clients');
const {
  sanitizeSlug,
  isSafeSlug,
  folderExists,
  scaffoldClientFolder,
} = require('../../lib/scaffold-client');
const { normalizePortalSettings } = require('../../lib/portal-settings');
const { readClientConfigFile, resolveHubSpotPropertyConfig } = require('../../lib/client-config-file');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const providerName = String(req.body?.providerName || '').trim();
  const supportEmail = String(req.body?.supportEmail || '').trim();
  const slug = sanitizeSlug(req.body?.clientSlug || providerName);

  if (!providerName) {
    return res.status(400).json({ error: 'providerName is required' });
  }
  if (!isSafeSlug(slug)) {
    return res.status(400).json({
      error: 'Invalid clientSlug',
      detail: 'Use 2–48 chars: lowercase letters, numbers, hyphens.',
    });
  }
  if (getKnownClient(slug) || (await getClient(slug)) || folderExists(slug)) {
    return res.status(409).json({
      error: 'Client already exists',
      detail: `Slug "${slug}" is already in use or folder exists.`,
    });
  }

  try {
    const scaffolded = scaffoldClientFolder({
      clientSlug: slug,
      providerName,
      supportEmail,
    });

    const fileConfig = readClientConfigFile(slug) || {};
    const portalSettings = normalizePortalSettings({
      ...fileConfig,
      supportEmail: supportEmail || fileConfig.supportEmail || '',
    }, { providerName });

    const saved = await upsertClient(slug, {
      providerName,
      portalPath: scaffolded.portalPath,
      supportEmail: portalSettings.supportEmail,
      portalSettings,
      folderCreatedAt: new Date().toISOString(),
      ...resolveHubSpotPropertyConfig(fileConfig),
      formRegion: 'na1',
    });

    return res.status(201).json({
      ok: true,
      client: saved,
      scaffolded,
      next: 'Click Connect HubSpot on this client to install + provision the form/properties.',
    });
  } catch (err) {
    console.error('[configure/create-client]', err);
    return res.status(500).json({ error: 'Scaffold failed', message: err.message });
  }
};
