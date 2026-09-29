const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.FACTOR8_API_KEY = 'test-key';
process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test/query';
const handler = require('../api/health');

function mockRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const realFetch = global.fetch;
let calls;
beforeEach(() => { calls = []; });
afterEach(() => { global.fetch = realFetch; });

function stubFetch(impl) {
  global.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
}

test('agents URL is derived from the query URL', () => {
  assert.equal(handler.agentsUrl(), 'https://factor8.example/api/v1/brand-slug/test/agents');
});

test('healthy path returns ok and sends the key, never runs the agent', async () => {
  stubFetch(async () => ({ ok: true, status: 200 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/agents$/);
  assert.equal(calls[0].init.headers['X-API-Key'], 'test-key');
  assert.equal(calls[0].init.method, undefined);
});

test('rejected key is reported as a short code', async () => {
  stubFetch(async () => ({ ok: false, status: 401 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, reason: 'factor8_key_rejected' });
});

test('other upstream errors carry only the status code', async () => {
  stubFetch(async () => ({ ok: false, status: 502 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.deepEqual(res.body, { ok: false, reason: 'factor8_http_502' });
});

test('network failure is unreachable, with no raw error', async () => {
  stubFetch(async () => { throw new Error('ECONNREFUSED secret'); });
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.deepEqual(res.body, { ok: false, reason: 'factor8_unreachable' });
});

test('only GET is allowed', async () => {
  const res = mockRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});
