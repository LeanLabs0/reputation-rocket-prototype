const { requireAuth } = require('../../lib/configure-auth');
const { getKnownClient, resolveClient } = require('../../lib/known-clients');
const { deleteClient, getClient } = require('../../lib/hubspot/store');
const { resolveHubSpotAccessToken } = require('../../lib/hubspot/tokens');
const { deprovisionPortal, FORM_NAME } = require('../../lib/hubspot/provision');
const { requireConfigureLocal } = require('../../lib/configure-local');
const {
  sanitizeSlug,
  isSafeSlug,
  folderExists,
  removeClientFolder,
  patchClientHubSpotConfig,
} = require('../../lib/scaffold-client');

module.exports = async function handler(req, res) {
  if (!requireConfigureLocal(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const slug = sanitizeSlug(req.body?.clientSlug || '');
  if (!isSafeSlug(slug)) {
    return res.status(400).json({ error: 'Invalid clientSlug' });
  }

  const known = await resolveClient(slug);
  const existing = await getClient(slug);
  const isBuiltIn = Boolean(getKnownClient(slug));
  const hadFolder = folderExists(slug);

  if (!known && !existing && !hadFolder) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const result = {
    clientSlug: slug,
    isBuiltIn,
    hubspot: null,
    storeDeleted: false,
    folderDeleted: false,
    configCleared: false,
    warnings: [],
  };

  // 1) HubSpot: archive form + delete rr_* properties (needs OAuth or PAT)
  const portalId = existing?.portalId || known?.defaultPortalId || '';
  const formId = existing?.formId || known?.defaultFormId || '';
  try {
    const accessToken = await resolveHubSpotAccessToken(slug, portalId);
    if (!accessToken) {
      result.warnings.push(
        'No HubSpot token — skipped form/property removal. Connect HubSpot first, or delete those manually in HubSpot.',
      );
    } else {
      try {
        result.hubspot = await deprovisionPortal(accessToken, { formId });
      } catch (err) {
        result.hubspot = err.partial || null;
        result.warnings.push(`HubSpot cleanup partial: ${err.message}`);
      }
    }
  } catch (err) {
    result.warnings.push(`HubSpot token resolve failed: ${err.message}`);
  }

  // 2) Clear HubSpot IDs from local config.js when folder remains (built-in)
  if (!process.env.VERCEL && hadFolder && isBuiltIn) {
    try {
      result.configCleared = patchClientHubSpotConfig(slug, {
        portalId: '',
        formId: '',
        formRegion: 'na1',
      });
    } catch (err) {
      result.warnings.push(`config.js clear failed: ${err.message}`);
    }
  }

  // 3) Remove configure store entry (OAuth tokens, settings, form ids)
  try {
    result.storeDeleted = await deleteClient(slug);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to remove configure store entry',
      message: err.message,
      result,
    });
  }

  // 4) Delete local folder for non-built-in clients only
  if (!isBuiltIn && !process.env.VERCEL && hadFolder) {
    try {
      result.folderDeleted = removeClientFolder(slug);
    } catch (err) {
      result.warnings.push(`Folder delete failed: ${err.message}`);
    }
  } else if (!isBuiltIn && process.env.VERCEL && hadFolder) {
    result.warnings.push(
      `Store + HubSpot cleaned. Delete the /${slug}/ folder from git locally — Vercel cannot remove it.`,
    );
  }

  const hubspotOk = Boolean(result.hubspot)
    && !result.warnings.some((w) => w.startsWith('HubSpot cleanup partial'));

  return res.status(200).json({
    ok: true,
    ...result,
    formName: FORM_NAME,
    summary: [
      hubspotOk ? 'HubSpot form archived + rr_* properties deleted' : 'HubSpot cleanup skipped or partial',
      result.storeDeleted ? 'configure store cleared' : 'no store entry',
      result.folderDeleted ? `folder /${slug}/ removed` : (isBuiltIn ? 'built-in folder kept' : 'folder kept'),
    ].join(' · '),
  });
};
