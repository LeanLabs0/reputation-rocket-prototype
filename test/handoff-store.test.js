const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-handoff-'));
process.env.HANDOFF_STORE = 'file';
process.env.HANDOFF_LOCAL_PATH = path.join(dir, 'handoffs.json');
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { getHandoff, claimHandoff, saveHandoff } = require('../lib/handoff-store');

function token() {
  return crypto.randomBytes(16).toString('base64url');
}

function guestSnapshot(state) {
  return {
    currentState: state,
    sessionId: 'session-1',
    chatHistory: [{ role: 'agent', content: 'Hello' }, { role: 'user', content: 'Five stars' }],
    leadIdentity: { name: 'Jane Doe', firstName: 'Jane', email: 'jane@example.com', extra: 'nope' },
    leadFields: [
      { name: 'firstname', value: 'Jane' },
      { name: 'lastname', value: 'Doe' },
      { name: 'email', value: 'jane@example.com' },
      { name: 'company', value: 'Lean Labs' },
      { name: 'website', value: 'https://leanlabs.com' },
      { name: 'ignored', value: '' },
    ],
    ignored: 'drop me',
  };
}

describe('handoff store', { concurrency: 1 }, () => {
test('guest save stays unclaimed until the client opens the link', async () => {
  const id = token();
  const saved = await saveHandoff({
    token: id,
    clientSlug: 'lean-labs',
    role: 'guest',
    snapshot: guestSnapshot('draft'),
  });

  assert.equal(saved.claimedAt, null);
  assert.equal(saved.snapshot.currentState, 'draft');
  assert.equal(saved.snapshot.ignored, undefined);
  assert.equal(saved.snapshot.leadIdentity.email, 'jane@example.com');
  assert.equal(saved.snapshot.leadIdentity.extra, undefined);
  assert.equal(saved.snapshot.leadFields.length, 5);
  assert.equal(saved.snapshot.leadFields[4].name, 'website');

  const peeked = await getHandoff(id, 'lean-labs');
  assert.equal(peeked.claimedAt, null);
  assert.equal(peeked.snapshot.chatHistory.length, 2);
});

test('claim locks the operator out and lets the client keep saving', async () => {
  const id = token();
  await saveHandoff({
    token: id,
    clientSlug: 'eimmigration',
    role: 'guest',
    snapshot: guestSnapshot('post'),
  });

  const claimed = await claimHandoff(id, 'eimmigration');
  assert.ok(claimed.claimedAt);
  assert.equal(claimed.snapshot.currentState, 'post');

  await assert.rejects(
    () => saveHandoff({
      token: id,
      clientSlug: 'eimmigration',
      role: 'guest',
      snapshot: guestSnapshot('complete'),
    }),
    (err) => err.code === 'HANDED_OFF',
  );

  const updated = await saveHandoff({
    token: id,
    clientSlug: 'eimmigration',
    role: 'client',
    snapshot: guestSnapshot('complete'),
  });
  assert.equal(updated.snapshot.currentState, 'complete');
  assert.equal(updated.claimedAt, claimed.claimedAt);
});

test('a token is bound to one client slug', async () => {
  const id = token();
  await saveHandoff({
    token: id,
    clientSlug: 'greentec',
    role: 'guest',
    snapshot: guestSnapshot('chat'),
  });

  assert.equal(await getHandoff(id, 'fatherhood'), null);
  await assert.rejects(
    () => saveHandoff({
      token: id,
      clientSlug: 'fatherhood',
      role: 'guest',
      snapshot: guestSnapshot('chat'),
    }),
    (err) => err.code === 'SLUG_MISMATCH',
  );

  const original = await getHandoff(id, 'greentec');
  assert.equal(original.snapshot.currentState, 'chat');
});

test('expired handoffs are treated as missing', async () => {
  const id = token();
  await saveHandoff({
    token: id,
    clientSlug: 'propertyradar',
    role: 'guest',
    snapshot: guestSnapshot('draft'),
  });

  const raw = JSON.parse(fs.readFileSync(process.env.HANDOFF_LOCAL_PATH, 'utf8'));
  raw[id].expiresAt = Date.now() - 1000;
  fs.writeFileSync(process.env.HANDOFF_LOCAL_PATH, JSON.stringify(raw));

  assert.equal(await getHandoff(id, 'propertyradar'), null);
  assert.equal(await claimHandoff(id, 'propertyradar'), null);
});

test('client cannot create a handoff and bad tokens are rejected', async () => {
  const id = token();
  await assert.rejects(
    () => saveHandoff({
      token: id,
      clientSlug: 'lean-labs',
      role: 'client',
      snapshot: guestSnapshot('welcome'),
    }),
    (err) => err.code === 'NOT_FOUND',
  );

  await assert.rejects(
    () => saveHandoff({
      token: 'short',
      clientSlug: 'lean-labs',
      role: 'guest',
      snapshot: guestSnapshot('welcome'),
    }),
    (err) => err.code === 'BAD_TOKEN',
  );
});
});
