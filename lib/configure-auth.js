const crypto = require('crypto');

const COOKIE_NAME = 'rr_configure_session';
const MAX_AGE_SEC = 60 * 60 * 12; // 12 hours

function configurePassword() {
  return (process.env.CONFIGURE_PASSWORD || '').trim();
}

function isAuthConfigured() {
  return Boolean(configurePassword());
}

function signingSecret() {
  return configurePassword() || 'dev-only';
}

function sign(value) {
  return crypto.createHmac('sha256', signingSecret()).update(value).digest('base64url');
}

function createSessionToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `ok.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [flag, expStr, sig] = parts;
  const payload = `${flag}.${expStr}`;
  if (sig !== sign(payload)) return false;
  if (flag !== 'ok') return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || '';
}

function isAuthenticated(req) {
  if (!isAuthConfigured()) return false;
  return verifySessionToken(getSessionFromRequest(req));
}

function sessionCookieHeader(token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

function clearSessionCookieHeader() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: 'Unauthorized', detail: 'Log in at /configure first.' });
  return false;
}

module.exports = {
  COOKIE_NAME,
  configurePassword,
  isAuthConfigured,
  createSessionToken,
  verifySessionToken,
  isAuthenticated,
  sessionCookieHeader,
  clearSessionCookieHeader,
  requireAuth,
  getSessionFromRequest,
};
