const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_KEY = 'rr:hubspot:installs';
const LOCAL_PATH = path.join(__dirname, '..', '..', '.data', 'hubspot-installs.json');

function encryptionKey() {
  const raw = (process.env.HUBSPOT_TOKEN_ENCRYPTION_KEY || process.env.CONFIGURE_PASSWORD || 'dev-only-insecure-key').trim();
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function readRawStore() {
  if (hasUpstash()) {
    const res = await upstash('GET', [STORE_KEY]);
    if (!res.result) return { clients: {} };
    try {
      return JSON.parse(res.result);
    } catch (_) {
      return { clients: {} };
    }
  }

  ensureLocalDir();
  if (!fs.existsSync(LOCAL_PATH)) return { clients: {} };
  try {
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch (_) {
    return { clients: {} };
  }
}

async function writeRawStore(data) {
  const payload = JSON.stringify(data, null, 2);
  if (hasUpstash()) {
    await upstash('SET', [STORE_KEY, payload]);
    return;
  }
  ensureLocalDir();
  fs.writeFileSync(LOCAL_PATH, payload, 'utf8');
}

function ensureLocalDir() {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hasUpstash() {
  return Boolean(
    String(process.env.UPSTASH_REDIS_REST_URL || '').trim() &&
    String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim(),
  );
}

async function upstash(command, args) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash ${command} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function assertWritableStore() {
  if (process.env.VERCEL && !hasUpstash()) {
    throw new Error(
      'Configure storage is not persistent on Vercel without Upstash. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
    );
  }
}

async function listClients() {
  const store = await readRawStore();
  return store.clients || {};
}

async function getClient(clientSlug) {
  const clients = await listClients();
  return clients[clientSlug] || null;
}

async function upsertClient(clientSlug, patch) {
  assertWritableStore();
  const store = await readRawStore();
  if (!store.clients) store.clients = {};
  const prev = store.clients[clientSlug] || { clientSlug };
  const next = {
    ...prev,
    ...patch,
    clientSlug,
    updatedAt: new Date().toISOString(),
  };
  if (patch.refreshToken) {
    next.refreshTokenEnc = encrypt(patch.refreshToken);
    delete next.refreshToken;
  }
  store.clients[clientSlug] = next;
  await writeRawStore(store);
  return publicClient(next);
}

async function getRefreshToken(clientSlug) {
  const client = await getClient(clientSlug);
  if (!client?.refreshTokenEnc) return '';
  return decrypt(client.refreshTokenEnc);
}

async function deleteClient(clientSlug) {
  assertWritableStore();
  const store = await readRawStore();
  if (!store.clients || !store.clients[clientSlug]) {
    return false;
  }
  delete store.clients[clientSlug];
  await writeRawStore(store);
  return true;
}

function publicClient(record) {
  if (!record) return null;
  const {
    refreshTokenEnc,
    accessTokenEnc,
    ...safe
  } = record;
  return {
    ...safe,
    connected: Boolean(refreshTokenEnc || record.portalId),
    hasRefreshToken: Boolean(refreshTokenEnc),
  };
}

module.exports = {
  listClients,
  getClient,
  upsertClient,
  deleteClient,
  getRefreshToken,
  publicClient,
  encrypt,
  decrypt,
};
