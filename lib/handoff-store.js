const fs = require('fs');
const path = require('path');

const { hasKvStore, kvCommand } = require('./hubspot/store');

const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 200_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,128}$/;
const STATES = new Set(['welcome', 'chat', 'draft', 'post', 'video', 'complete', 'negative']);
const SNAPSHOT_KEYS = [
  'clientSlug',
  'sessionId',
  'machineId',
  'currentState',
  'chatHistory',
  'agentMessageCount',
  'reviewDraft',
  'drafts',
  'activeDraftPlatform',
  'currentPlatformIndex',
  'starRating',
  'agentRating',
  'platformsPosted',
  'platformPostedAt',
  'reviewFormOpened',
  'platformFieldsCopied',
  'negativeFlagData',
  'lastAgentMessage',
  'notificationsSent',
  'hubspotCompleteSent',
  'hubspotIncompleteSent',
  'uploadedVideoMeta',
  'draftLooksGood',
  'chatChoiceMode',
  'murkyMiddle',
  'ratedDirectFive',
  'directFiveImproveSkipped',
  'leadIdentity',
  'leadFields',
  'savedAt',
];

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

let kvDisabled = false;

function useKv() {
  if (kvDisabled) return false;
  if (String(process.env.HANDOFF_STORE || '').trim() === 'file') return false;
  return hasKvStore();
}

function disableKvForLocal(err) {
  if (process.env.VERCEL) throw err;
  kvDisabled = true;
  console.warn('[handoff] KV unavailable, using local file:', err.message);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('KV timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function kvGet(key) {
  return withTimeout(kvCommand('GET', [key]), 2500);
}

async function kvSet(key, value, ttlSeconds) {
  return withTimeout(kvCommand('SET', [key, value, 'EX', String(ttlSeconds)]), 2500);
}

async function kvDel(key) {
  return withTimeout(kvCommand('DEL', [key]), 2500);
}

function localPath() {
  const override = String(process.env.HANDOFF_LOCAL_PATH || '').trim();
  if (override) return override;
  return path.join(__dirname, '..', '.data', 'handoffs.json');
}

function handoffKey(token) {
  return `rr:handoff:${token}`;
}

function assertWritable() {
  if (process.env.VERCEL && !useKv()) {
    throw fail(
      'NO_STORE',
      'Handoff storage needs KV. Set KV_REST_API_URL and KV_REST_API_TOKEN.',
    );
  }
}

function assertToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) {
    throw fail('BAD_TOKEN', 'Invalid handoff token');
  }
}

function clipString(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function sanitizeSnapshot(raw, clientSlug) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('BAD_SNAPSHOT', 'snapshot must be an object');
  }

  const picked = {};
  for (const key of SNAPSHOT_KEYS) {
    if (raw[key] !== undefined) picked[key] = raw[key];
  }

  let encoded;
  try {
    encoded = JSON.stringify(picked);
  } catch (_) {
    throw fail('BAD_SNAPSHOT', 'snapshot must be JSON');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw fail('BAD_SNAPSHOT', 'snapshot too large');
  }

  const snapshot = JSON.parse(encoded);
  snapshot.clientSlug = String(clientSlug || '').trim();
  snapshot.currentState = STATES.has(snapshot.currentState) ? snapshot.currentState : 'welcome';
  snapshot.sessionId = clipString(snapshot.sessionId, 80);
  snapshot.machineId = clipString(snapshot.machineId, 120);
  snapshot.chatHistory = Array.isArray(snapshot.chatHistory)
    ? snapshot.chatHistory.slice(0, 200).map((msg) => ({
      role: msg && msg.role === 'agent' ? 'agent' : 'user',
      content: clipString(msg && msg.content, 20000),
    })).filter((msg) => msg.content)
    : [];

  const lead = snapshot.leadIdentity && typeof snapshot.leadIdentity === 'object'
    ? snapshot.leadIdentity
    : {};
  snapshot.leadIdentity = {
    name: clipString(lead.name, 200),
    firstName: clipString(lead.firstName, 120),
    email: clipString(lead.email, 200),
    visitorCompany: clipString(lead.visitorCompany, 200),
  };
  const choiceModes = new Set(['stars', 'murky', 'murky-feedback']);
  snapshot.chatChoiceMode = choiceModes.has(snapshot.chatChoiceMode) ? snapshot.chatChoiceMode : null;
  const murky = snapshot.murkyMiddle && typeof snapshot.murkyMiddle === 'object' ? snapshot.murkyMiddle : null;
  const murkyChoice = Number(murky && murky.chose);
  snapshot.murkyMiddle = murkyChoice === 5 || murkyChoice === 3
    ? {
      chose: murkyChoice,
      feedback: clipString(murky.feedback, 2000),
      supportHandled: murky.supportHandled === true || (murkyChoice === 5 && Boolean(murky.feedback)),
    }
    : null;
  snapshot.ratedDirectFive = snapshot.ratedDirectFive === true;
  snapshot.directFiveImproveSkipped = snapshot.directFiveImproveSkipped === true;
  snapshot.leadFields = Array.isArray(snapshot.leadFields)
    ? snapshot.leadFields.slice(0, 40).map((row) => ({
      name: clipString(row && row.name, 80),
      value: clipString(row && row.value, 500),
    })).filter((row) => row.name && row.value)
    : [];
  snapshot.savedAt = clipString(snapshot.savedAt, 40);

  return snapshot;
}

function isExpired(record, now) {
  return !record || !record.expiresAt || record.expiresAt <= now;
}

function readLocalMap() {
  try {
    if (!fs.existsSync(localPath())) return {};
    const parsed = JSON.parse(fs.readFileSync(localPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeLocalMap(map) {
  const file = localPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const live = {};
  for (const [token, record] of Object.entries(map)) {
    if (!isExpired(record, now)) live[token] = record;
  }
  fs.writeFileSync(file, JSON.stringify(live), 'utf8');
}

async function readRecord(token) {
  assertToken(token);
  if (useKv()) {
    try {
      const res = await kvGet(handoffKey(token));
      if (!res || res.result == null || res.result === '') return null;
      try {
        const record = JSON.parse(res.result);
        if (isExpired(record, Date.now())) {
          await kvDel(handoffKey(token));
          return null;
        }
        return record;
      } catch (_) {
        return null;
      }
    } catch (err) {
      disableKvForLocal(err);
    }
  }

  const record = readLocalMap()[token] || null;
  if (isExpired(record, Date.now())) return null;
  return record;
}

async function writeRecord(record) {
  assertWritable();
  assertToken(record.token);
  if (useKv()) {
    try {
      const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
      await kvSet(handoffKey(record.token), JSON.stringify(record), ttlSeconds);
      return;
    } catch (err) {
      disableKvForLocal(err);
    }
  }
  const map = readLocalMap();
  map[record.token] = record;
  writeLocalMap(map);
}

function slugMismatch(record, clientSlug) {
  return record && record.clientSlug !== clientSlug;
}

let opChain = Promise.resolve();

function enqueue(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(() => {}, () => {});
  return run;
}

async function getHandoffUnlocked(token, clientSlug) {
  const slug = String(clientSlug || '').trim();
  if (!slug) throw fail('BAD_SNAPSHOT', 'clientSlug is required');
  const record = await readRecord(token);
  if (!record || slugMismatch(record, slug)) return null;
  return record;
}

async function getHandoff(token, clientSlug) {
  return enqueue(() => getHandoffUnlocked(token, clientSlug));
}

async function claimHandoff(token, clientSlug) {
  return enqueue(async () => {
    const record = await getHandoffUnlocked(token, clientSlug);
    if (!record) return null;
    if (!record.claimedAt) {
      record.claimedAt = new Date().toISOString();
      record.updatedAt = record.claimedAt;
      await writeRecord(record);
    }
    return record;
  });
}

async function saveHandoff({ token, clientSlug, role, snapshot }) {
  return enqueue(() => saveHandoffUnlocked({ token, clientSlug, role, snapshot }));
}

async function saveHandoffUnlocked({ token, clientSlug, role, snapshot }) {
  const slug = String(clientSlug || '').trim();
  if (!slug) throw fail('BAD_SNAPSHOT', 'clientSlug is required');
  if (role !== 'guest' && role !== 'client') throw fail('BAD_SNAPSHOT', 'role must be guest or client');

  assertToken(token);
  const existing = await readRecord(token);
  if (slugMismatch(existing, slug)) throw fail('SLUG_MISMATCH', 'Handoff not found');
  if (!existing && role === 'client') throw fail('NOT_FOUND', 'Handoff not found');
  if (existing && existing.claimedAt && role === 'guest') {
    throw fail('HANDED_OFF', 'Handoff already claimed');
  }

  const now = Date.now();
  const clean = sanitizeSnapshot(snapshot, slug);
  const record = {
    token,
    clientSlug: slug,
    snapshot: clean,
    claimedAt: existing ? existing.claimedAt || null : null,
    createdAt: existing ? existing.createdAt : new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: existing ? existing.expiresAt : now + TTL_MS,
  };
  if (role === 'client') {
    record.claimedAt = record.claimedAt || record.updatedAt;
  }
  await writeRecord(record);
  return record;
}

module.exports = {
  TTL_MS,
  MAX_SNAPSHOT_BYTES,
  getHandoff,
  claimHandoff,
  saveHandoff,
  sanitizeSnapshot,
};
