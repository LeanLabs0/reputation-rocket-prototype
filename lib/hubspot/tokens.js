const { getClient, getRefreshToken, upsertClient } = require('./store');
const { refreshAccessToken, isOAuthConfigured } = require('./oauth');

function toEnvSuffix(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function envPat(clientSlug, portalId) {
  const slugSuffix = toEnvSuffix(clientSlug);
  const portalSuffix = toEnvSuffix(portalId);
  return (
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${slugSuffix}`] ||
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${portalSuffix}`] ||
    ''
  ).trim();
}

/**
 * Resolve a usable HubSpot access token for runtime APIs.
 * Prefer OAuth refresh token from the configure store; fall back to env PAT.
 */
async function resolveHubSpotAccessToken(clientSlug, portalId) {
  if (isOAuthConfigured()) {
    try {
      const refreshToken = await getRefreshToken(clientSlug);
      if (refreshToken) {
        const tokens = await refreshAccessToken(refreshToken);
        if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
          await upsertClient(clientSlug, { refreshToken: tokens.refresh_token });
        }
        if (tokens.access_token) {
          await upsertClient(clientSlug, {
            accessTokenExpiresAt: Date.now() + (Number(tokens.expires_in || 1800) * 1000),
            lastTokenRefreshAt: new Date().toISOString(),
          });
          return tokens.access_token;
        }
      }

      // Also try lookup by portalId if slug miss
      if (portalId) {
        const clients = await require('./store').listClients();
        const match = Object.values(clients).find(
          (c) => String(c.portalId || '') === String(portalId),
        );
        if (match?.clientSlug && match.clientSlug !== clientSlug) {
          return resolveHubSpotAccessToken(match.clientSlug, portalId);
        }
      }
    } catch (err) {
      console.warn('[hubspot-tokens] OAuth token resolve failed, trying env PAT:', err.message);
    }
  }

  return envPat(clientSlug, portalId);
}

async function resolvePortalConfig(clientSlug) {
  const record = await getClient(clientSlug);
  if (!record) return null;
  return {
    portalId: record.portalId || '',
    formId: record.formId || '',
    formRegion: record.formRegion || 'na1',
    hubspotCompleteProperty: record.hubspotCompleteProperty || 'rr_iscomplete',
    hubspotCompleteValue: record.hubspotCompleteValue || 'Yes',
    hubspotOutcomeProperty: record.hubspotOutcomeProperty || 'rr_outcome',
    hubspotOutcomePositiveValue: record.hubspotOutcomePositiveValue || 'positive',
    hubspotOutcomeNegativeValue: record.hubspotOutcomeNegativeValue || 'negative',
    provisionedAt: record.provisionedAt || null,
  };
}

module.exports = {
  toEnvSuffix,
  envPat,
  resolveHubSpotAccessToken,
  resolvePortalConfig,
};
