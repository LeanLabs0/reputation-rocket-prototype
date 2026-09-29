const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

function assertPublicBody(body, expected) {
  assert.deepEqual(body, expected);
  assert.equal('error' in body, false);
  assert.equal('message' in body, false);
  const dumped = JSON.stringify(body);
  assert.doesNotMatch(dumped, /test-key|ECONNREFUSED|secret|FACTOR8_API_KEY/i);
}

const realFetch = global.fetch;
let calls;
beforeEach(() => {
  calls = [];
  handler.resetHealthCache();
  process.env.FACTOR8_API_KEY = 'test-key';
  process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test/query';
});
afterEach(() => {
  global.fetch = realFetch;
  handler.resetHealthCache();
});

function stubFetch(impl) {
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
}

test('agents URL is derived from the query URL', () => {
  assert.equal(handler.agentsUrl(), 'https://factor8.example/api/v1/brand-slug/test/agents');
});

test('agents URL ignores query strings and trailing slashes', () => {
  assert.equal(
    handler.agentsUrl('https://factor8.example/api/v1/brand-slug/test/query/?token=nope'),
    'https://factor8.example/api/v1/brand-slug/test/agents',
  );
});

test('agents URL is null when it cannot be derived from /query', () => {
  assert.equal(handler.agentsUrl('https://factor8.example/api/v1/brand-slug/test'), null);
  assert.equal(handler.agentsUrl('not-a-url'), null);
});

test('healthy path returns ok and sends the key, never runs the agent', async () => {
  stubFetch(async () => ({ ok: true, status: 200 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assertPublicBody(res.body, { ok: true });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/agents$/);
  assert.doesNotMatch(calls[0].url, /\/query/);
  assert.equal(calls[0].init.headers['X-API-Key'], 'test-key');
  assert.equal(calls[0].init.method, 'GET');
});

test('rejected key is reported as a short code', async () => {
  stubFetch(async () => ({ ok: false, status: 401 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, reason: 'factor8_key_rejected' });
});

test('forbidden key is the same short rejected code', async () => {
  stubFetch(async () => ({ ok: false, status: 403 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assertPublicBody(res.body, { ok: false, reason: 'factor8_key_rejected' });
});

test('other upstream errors carry only the status code', async () => {
  stubFetch(async () => ({
    ok: false,
    status: 502,
    arrayBuffer: async () => new TextEncoder().encode('upstream secret body'),
  }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, reason: 'factor8_http_502' });
});

test('network failure is unreachable, with no raw error', async () => {
  stubFetch(async () => { throw new Error('ECONNREFUSED secret'); });
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, reason: 'factor8_unreachable' });
});

test('timeout is reported as a short code', async () => {
  stubFetch(async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  });
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assertPublicBody(res.body, { ok: false, reason: 'factor8_timeout' });
});

test('missing key is a short code and never fetches', async () => {
  delete process.env.FACTOR8_API_KEY;
  stubFetch(async () => ({ ok: true, status: 200 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, reason: 'missing_factor8_key' });
  assert.equal(calls.length, 0);
});

test('underivable Factor8 URL fails closed and never fetches', async () => {
  process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test';
  stubFetch(async () => ({ ok: true, status: 200 }));
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, reason: 'bad_factor8_url' });
  assert.equal(calls.length, 0);
});

test('only GET is allowed', async () => {
  stubFetch(async () => ({ ok: true, status: 200 }));
  const res = mockRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assertPublicBody(res.body, { ok: false, reason: 'method_not_allowed' });
  assert.equal(calls.length, 0);
});

test('repeated probes reuse a short cache and do not hammer Factor8', async () => {
  stubFetch(async () => ({ ok: true, status: 200 }));
  const first = mockRes();
  const second = mockRes();
  await handler({ method: 'GET' }, first);
  await handler({ method: 'GET' }, second);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, { ok: true });
  assert.equal(calls.length, 1);
});

test('overlapping probes share one Factor8 request', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  stubFetch(async () => {
    await gate;
    return { ok: true, status: 200 };
  });
  const first = mockRes();
  const second = mockRes();
  const pending = Promise.all([
    handler({ method: 'GET' }, first),
    handler({ method: 'GET' }, second),
  ]);
  release();
  await pending;
  assert.equal(calls.length, 1);
  assert.deepEqual(first.body, { ok: true });
  assert.deepEqual(second.body, { ok: true });
});

test('local dev server exposes /api/health', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'local-dev-server.js'), 'utf8');
  assert.match(src, /['"]\/api\/health['"]/);
  assert.match(src, /healthHandler|api\/health/);
});
