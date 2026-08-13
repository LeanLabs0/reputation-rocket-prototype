const { requireAuth } = require('../../lib/configure-auth');
const { resolveClient } = require('../../lib/known-clients');
const { upsertClient, getClient } = require('../../lib/hubspot/store');
const { normalizePortalSettings } = require('../../lib/portal-settings');
const { writePortalSettingsToConfigFile } = require('../../lib/client-config-file');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const clientSlug = String(req.body?.clientSlug || '').trim();
  const known = await resolveClient(clientSlug);
  if (!known) {
    return res.status(400).json({ error: 'Unknown clientSlug' });
  }

  const existing = await getClient(clientSlug);
  const providerName = String(req.body?.providerName || existing?.providerName || known.providerName || clientSlug).trim();
  const settings = normalizePortalSettings(req.body?.settings || req.body || {}, { providerName });

  const saved = await upsertClient(clientSlug, {
    providerName,
    portalSettings: settings,
    supportEmail: settings.supportEmail,
    portalSettingsUpdatedAt: new Date().toISOString(),
  });

  let configPatched = false;
  if (!process.env.VERCEL) {
    try {
      configPatched = writePortalSettingsToConfigFile(clientSlug, settings, {
        providerName,
        hubspotPortalId: saved.portalId || existing?.portalId || '',
        hubspotFormId: saved.formId || existing?.formId || '',
        hubspotFormRegion: saved.formRegion || existing?.formRegion || 'na1',
      });
    } catch (err) {
      console.warn('[configure/update-settings] config.js write failed:', err.message);
    }
  }

  return res.status(200).json({
    ok: true,
    clientSlug,
    settings,
    configPatched,
    client: saved,
  });
};
