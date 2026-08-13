const HUBSPOT_SCOPES = [
  'oauth',
  'files',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.write',
  'forms',
].join(' ');

const LOCAL_REDIRECT = 'http://localhost:8888/api/configure/oauth-callback';

function trimEnv(name) {
  return String(process.env[name] || '').trim();
}

function defaultRedirectUri() {
  const explicit = trimEnv('HUBSPOT_APP_REDIRECT_URI');
  if (explicit) return explicit;

  // Prefer the stable production domain env when present (set this on Vercel).
  const prodHost = trimEnv('VERCEL_PROJECT_PRODUCTION_URL') || trimEnv('CONFIGURE_PUBLIC_HOST');
  if (prodHost) {
    const host = prodHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${host}/api/configure/oauth-callback`;
  }

  if (!process.env.VERCEL) return LOCAL_REDIRECT;
  return '';
}

function appConfig() {
  return {
    clientId: trimEnv('HUBSPOT_APP_CLIENT_ID'),
    clientSecret: trimEnv('HUBSPOT_APP_CLIENT_SECRET'),
    redirectUri: defaultRedirectUri(),
  };
}

function oauthEnvStatus() {
  const { clientId, clientSecret, redirectUri } = appConfig();
  const missing = [];
  if (!clientId) missing.push('HUBSPOT_APP_CLIENT_ID');
  if (!clientSecret) missing.push('HUBSPOT_APP_CLIENT_SECRET');
  if (!redirectUri) missing.push('HUBSPOT_APP_REDIRECT_URI');
  return {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    redirectUriConfigured: Boolean(redirectUri),
    redirectUri: redirectUri || '',
    missing,
    configured: missing.length === 0,
  };
}

function isOAuthConfigured() {
  return oauthEnvStatus().configured;
}

function buildInstallUrl({ clientSlug, state }) {
  const { clientId, redirectUri } = appConfig();
  if (!clientId || !redirectUri) {
    throw new Error('HubSpot app is not configured (HUBSPOT_APP_CLIENT_ID / HUBSPOT_APP_REDIRECT_URI).');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: HUBSPOT_SCOPES,
    state: state || clientSlug,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = appConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  return tokenRequest(body);
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = appConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return tokenRequest(body);
}

async function tokenRequest(body) {
  const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) { /* not JSON */ }
  if (!res.ok) {
    throw new Error(payload.message || payload.error || text || `Token exchange failed (${res.status})`);
  }
  return payload;
}

async function getTokenInfo(accessToken) {
  const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.message || `Token info failed (${res.status})`);
  }
  return payload;
}

module.exports = {
  HUBSPOT_SCOPES,
  LOCAL_REDIRECT,
  appConfig,
  oauthEnvStatus,
  isOAuthConfigured,
  buildInstallUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getTokenInfo,
};
