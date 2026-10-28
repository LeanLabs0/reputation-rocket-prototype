const crypto = require('crypto');

const COOKIE_NAME = 'rr_clients_session';
const MAX_AGE_SEC = 60 * 60 * 12;
const DEFAULT_PASSWORD = 'overdeliver';

function overdeliverPassword() {
  return (process.env.OVERDELIVER_PASSWORD || DEFAULT_PASSWORD).trim() || DEFAULT_PASSWORD;
}

function isAuthConfigured() {
  return Boolean(overdeliverPassword());
}

function sign(value) {
  return crypto.createHmac('sha256', overdeliverPassword() || 'dev-only').update(value).digest('base64url');
}

function passwordsMatch(input, expected) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(expected || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `ok.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !isAuthConfigured()) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [flag, expStr, sig] = parts;
  const payload = `${flag}.${expStr}`;
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  if (flag !== 'ok') return false;
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
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

function isAuthenticated(req) {
  if (!isAuthConfigured()) return false;
  return verifySessionToken(parseCookies(req)[COOKIE_NAME] || '');
}

function sessionCookieHeader(token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

function clearSessionCookieHeader() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

module.exports = {
  COOKIE_NAME,
  overdeliverPassword,
  isAuthConfigured,
  passwordsMatch,
  createSessionToken,
  verifySessionToken,
  isAuthenticated,
  sessionCookieHeader,
  clearSessionCookieHeader,
};
