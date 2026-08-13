const HUBSPOT_SCOPES = [
  'oauth',
  'files',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.write',
  'forms',
].join(' ');

const LOCAL_REDIRECT = 'http://localhost:8888/api/configure/oauth-callback';
const DEFAULT_PROD_HOST = 'reputationrocket.ai';

function trimEnv(name) {
  return String(process.env[name] || '').trim();
}

function isLocalhostUri(uri) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(uri || ''));
}

function productionRedirectUri() {
  const prodHost =
    trimEnv('VERCEL_PROJECT_PRODUCTION_URL') ||
    trimEnv('CONFIGURE_PUBLIC_HOST') ||
    DEFAULT_PROD_HOST;
  const host = prodHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/api/configure/oauth-callback`;
}

function defaultRedirectUri() {
  const explicit = trimEnv('HUBSPOT_APP_REDIRECT_URI');
  const onVercel = Boolean(process.env.VERCEL);

  // HubSpot redirects to whatever redirect_uri we put in the authorize URL.
  // Never send localhost from a Vercel deployment — even if Production env was
  // copied from .env.local by mistake.
  if (onVercel) {
    if (explicit && !isLocalhostUri(explicit)) return explicit;
    return productionRedirectUri();
  }

  if (explicit) return explicit;
  return LOCAL_REDIRECT;
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
  const onVercel = Boolean(process.env.VERCEL);
  const rawRedirect = trimEnv('HUBSPOT_APP_REDIRECT_URI');
  const missing = [];
  if (!clientId) missing.push('HUBSPOT_APP_CLIENT_ID');
  if (!clientSecret) missing.push('HUBSPOT_APP_CLIENT_SECRET');
  if (!redirectUri) missing.push('HUBSPOT_APP_REDIRECT_URI');

  let redirectWarning = '';
  if (onVercel && isLocalhostUri(rawRedirect)) {
    redirectWarning =
      'HUBSPOT_APP_REDIRECT_URI is set to localhost on Vercel; production override is in use. Set it to https://reputationrocket.ai/api/configure/oauth-callback.';
  }

  return {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    redirectUriConfigured: Boolean(redirectUri),
    redirectUri: redirectUri || '',
    redirectEnv: rawRedirect || '',
    redirectWarning,
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
