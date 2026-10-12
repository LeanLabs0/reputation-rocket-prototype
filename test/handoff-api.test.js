const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.HANDOFF_STORE = 'file';
process.env.HANDOFF_LOCAL_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-handoff-api-')), 'handoffs.json');
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const handler = require('../api/handoff');

function token() {
  return crypto.randomBytes(16).toString('base64url');
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('handoff API claims on open and then rejects the operator', async () => {
  const id = token();
  const snapshot = {
    currentState: 'draft',
    sessionId: 'session-1',
    clientSlug: 'lean-labs',
    chatHistory: [{ role: 'agent', content: 'Draft ready' }],
  };

  const created = mockRes();
  await handler({
    method: 'PUT',
    query: {},
    body: { token: id, clientSlug: 'lean-labs', role: 'guest', snapshot },
  }, created);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.claimed, false);

  const peek = mockRes();
  await handler({
    method: 'GET',
    query: { token: id, clientSlug: 'lean-labs' },
  }, peek);
  assert.equal(peek.statusCode, 200);
  assert.equal(peek.body.claimed, false);
  assert.equal(peek.body.currentState, 'draft');
  assert.equal(peek.body.snapshot, undefined);

  const opened = mockRes();
  await handler({
    method: 'GET',
    query: { token: id, clientSlug: 'lean-labs', claim: '1' },
  }, opened);
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.body.snapshot.currentState, 'draft');
  assert.equal(opened.body.snapshot.chatHistory[0].content, 'Draft ready');

  const blocked = mockRes();
  await handler({
    method: 'PUT',
    query: {},
    body: {
      token: id,
      clientSlug: 'lean-labs',
      role: 'guest',
      snapshot: { ...snapshot, currentState: 'complete' },
    },
  }, blocked);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.claimed, true);

  const continued = mockRes();
  await handler({
    method: 'PUT',
    query: {},
    body: {
      token: id,
      clientSlug: 'lean-labs',
      role: 'client',
      snapshot: { ...snapshot, currentState: 'post' },
    },
  }, continued);
  assert.equal(continued.statusCode, 200);
  assert.equal(continued.body.claimed, true);

  const again = mockRes();
  await handler({
    method: 'GET',
    query: { token: id, clientSlug: 'lean-labs', claim: '1' },
  }, again);
  assert.equal(again.body.snapshot.currentState, 'post');
});
