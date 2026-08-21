const { exchangeCodeForTokens, getTokenInfo } = require('../../lib/hubspot/oauth');
const { getClient, upsertClient } = require('../../lib/hubspot/store');
const { provisionPortal } = require('../../lib/hubspot/provision');
const { patchClientHubSpotConfig } = require('../../lib/scaffold-client');
const { readClientConfigFile, resolveHubSpotPropertyConfig } = require('../../lib/client-config-file');

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return Object.fromEntries(url.searchParams.entries());
  } catch (_) {
    return {};
  }
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  if (typeof res.end === 'function') {
    // Local node res or Vercel ServerResponse-like
    try {
      return res.end();
    } catch (_) { /* fall through */ }
  }
  if (typeof res.send === 'function') return res.send('');
  return res.status(302).json({ redirect: location });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = getQuery(req);
  const code = String(q.code || '');
  const state = String(q.state || '');
  const error = String(q.error || '');

  const clientSlug = String(state.split('.')[0] || '').trim();
  const fail = (msg) => redirect(res, `/configure/?error=${encodeURIComponent(msg)}`);

  if (error) return fail(`HubSpot OAuth error: ${error}`);
  if (!code || !clientSlug) return fail('Missing OAuth code or state.');

  try {
    const record = await getClient(clientSlug);
    if (!record?.oauthState || record.oauthState !== state) {
      return fail('Invalid OAuth state. Start Connect HubSpot again.');
    }

    const tokens = await exchangeCodeForTokens(code);
    const info = await getTokenInfo(tokens.access_token);
    const portalId = String(info.hub_id || info.hubId || '');

    await upsertClient(clientSlug, {
      refreshToken: tokens.refresh_token,
      portalId,
      oauthState: null,
      connectedAt: new Date().toISOString(),
      scopes: info.scopes || [],
    });

    // Portal ID is enough for embeds; OAuth refresh token replaces private-app PATs.
    // config.js writes are local-only (no-op on Vercel); store/KV is source of truth in prod.
    patchClientHubSpotConfig(clientSlug, {
      portalId,
      formRegion: 'na1',
    });

    try {
      const provisioned = await provisionPortal(tokens.access_token);
      const hubspotValues = resolveHubSpotPropertyConfig(
        record,
        readClientConfigFile(clientSlug),
      );
      await upsertClient(clientSlug, {
        formId: provisioned.form?.id || '',
        formName: provisioned.form?.name || '',
        formRegion: 'na1',
        properties: provisioned.properties,
        provisionedAt: new Date().toISOString(),
        ...hubspotValues,
      });
      patchClientHubSpotConfig(clientSlug, {
        portalId,
        formId: provisioned.form?.id || '',
        formRegion: 'na1',
        ...hubspotValues,
      });
    } catch (provisionErr) {
      console.error('[oauth-callback] provision failed:', provisionErr);
      if (provisionErr.partial?.properties) {
        try {
          await upsertClient(clientSlug, { properties: provisionErr.partial.properties });
        } catch (_) { /* best-effort */ }
      }
      return redirect(
        res,
        `/configure/?client=${encodeURIComponent(clientSlug)}&connected=${encodeURIComponent(clientSlug)}&warn=${encodeURIComponent(provisionErr.message)}`,
      );
    }

    return redirect(
      res,
      `/configure/?client=${encodeURIComponent(clientSlug)}&connected=${encodeURIComponent(clientSlug)}`,
    );
  } catch (err) {
    console.error('[oauth-callback]', err);
    return fail(err.message || 'OAuth callback failed');
  }
};
