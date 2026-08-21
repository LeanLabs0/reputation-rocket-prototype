const { requireAuth } = require('../../lib/configure-auth');
const { resolveClient } = require('../../lib/known-clients');
const { upsertClient, getClient } = require('../../lib/hubspot/store');
const { resolveHubSpotAccessToken } = require('../../lib/hubspot/tokens');
const { provisionPortal } = require('../../lib/hubspot/provision');
const { patchClientHubSpotConfig } = require('../../lib/scaffold-client');
const { readClientConfigFile, resolveHubSpotPropertyConfig } = require('../../lib/client-config-file');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const clientSlug = String(req.body?.clientSlug || '').trim();
  if (!(await resolveClient(clientSlug))) {
    return res.status(400).json({ error: 'Unknown clientSlug' });
  }

  try {
    const accessToken = await resolveHubSpotAccessToken(clientSlug, '');
    if (!accessToken) {
      return res.status(400).json({
        error: 'No HubSpot token',
        detail: 'Connect HubSpot via OAuth first (or set HUBSPOT_FILES_ACCESS_TOKEN_*).',
      });
    }

    const provisioned = await provisionPortal(accessToken);
    const existing = await getClient(clientSlug);
    const hubspotValues = resolveHubSpotPropertyConfig(
      existing,
      readClientConfigFile(clientSlug),
    );
    const saved = await upsertClient(clientSlug, {
      formId: provisioned.form?.id || '',
      formName: provisioned.form?.name || '',
      formRegion: 'na1',
      portalId: existing?.portalId || '',
      properties: provisioned.properties,
      provisionedAt: new Date().toISOString(),
      ...hubspotValues,
    });

    const patched = patchClientHubSpotConfig(clientSlug, {
      portalId: saved.portalId || existing?.portalId || '',
      formId: provisioned.form?.id || '',
      formRegion: 'na1',
      ...hubspotValues,
    });

    return res.status(200).json({ ok: true, provisioned, client: saved, configPatched: patched });
  } catch (err) {
    console.error('[configure/provision]', err);
    return res.status(502).json({ error: 'Provision failed', message: err.message });
  }
};
