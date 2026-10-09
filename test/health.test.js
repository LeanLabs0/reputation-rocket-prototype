const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.FACTOR8_API_KEY = 'test-key';
process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test/query';
const handler = require('../api/health');
const { resetOpsAlertCooldown } = require('../lib/slack-alert');

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
  resetOpsAlertCooldown();
  process.env.FACTOR8_API_KEY = 'test-key';
  process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test/query';
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_ALERT_CHANNEL;
  delete process.env.DEEP_HEALTH_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});
afterEach(() => {
  global.fetch = realFetch;
  handler.resetHealthCache();
  resetOpsAlertCooldown();
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.DEEP_HEALTH_TOKEN;
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

function slackBodies() {
  return calls
    .filter((call) => String(call.url).includes('slack.com'))
    .map((call) => JSON.parse(call.init.body));
}

test('deep=1 runs one chat turn and is not the shallow agents check', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: 'ok' }),
    };
  });
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/health?deep=1' }, res);
  assert.equal(res.statusCode, 200);
  assertPublicBody(res.body, { ok: true, deep: true });
  const factor8 = calls.filter((call) => !String(call.url).includes('slack.com'));
  assert.equal(factor8.length, 1);
  assert.match(factor8[0].url, /\/query$/);
  assert.doesNotMatch(factor8[0].url, /\/agents/);
  assert.equal(factor8[0].init.method, 'POST');
  assert.equal(factor8[0].init.headers['X-API-Key'], 'test-key');
  const sent = JSON.parse(factor8[0].init.body);
  assert.equal(sent.prompt, handler.DEEP_PROMPT);
  assert.equal(sent.agent, 'reputation-rocket');
  assert.match(sent.session_id, /^health-deep-/);
  assert.equal(sent.config.customer_email, 'healthcheck@example.com');
  assert.equal(slackBodies().length, 0);

  const cached = mockRes();
  await handler({ method: 'GET', query: { deep: '1' } }, cached);
  assert.equal(cached.statusCode, 200);
  assert.deepEqual(cached.body, { ok: true, deep: true });
  assert.equal(calls.filter((call) => !String(call.url).includes('slack.com')).length, 1);
});

test('deep failure is non-200, alerts Slack, and keeps the detail off the public body', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return {
      ok: false,
      status: 502,
      text: async () => JSON.stringify({
        detail: 'The review assistant hit a temporary problem. Please retry.',
        customer_email: 'jane@example.com',
        prompt: 'secret review text',
      }),
    };
  });
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/health?deep=1' }, res);
  assert.equal(res.statusCode, 503);
  assertPublicBody(res.body, { ok: false, deep: true, reason: 'factor8_http_502' });
  const posts = slackBodies();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channel, 'C09BD2WUQ4B');
  assert.match(posts[0].text, /Source: deep health check/);
  assert.match(posts[0].text, /temporary problem/);
  assert.doesNotMatch(posts[0].text, /jane@example.com|secret review text|test-key|xoxb-test-token/);
});

test('the shallow probe does not post to Slack when upstream fails', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  stubFetch(async () => ({ ok: false, status: 502 }));
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/health' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(slackBodies().length, 0);
  assert.match(calls[0].url, /\/agents$/);
});

test('deep=1 does not replace the shallow cache', async () => {
  stubFetch(async (url) => {
    if (String(url).includes('/query')) {
      return { ok: false, status: 502, text: async () => '{"detail":"down"}' };
    }
    return { ok: true, status: 200 };
  });
  const deep = mockRes();
  await handler({ method: 'GET', url: '/api/health?deep=1' }, deep);
  const shallow = mockRes();
  await handler({ method: 'GET', url: '/api/health' }, shallow);
  assert.equal(deep.statusCode, 503);
  assert.equal(deep.body.deep, true);
  assert.equal(shallow.statusCode, 200);
  assert.deepEqual(shallow.body, { ok: true });
});

test('deep check requires DEEP_HEALTH_TOKEN when it is set', async () => {
  process.env.DEEP_HEALTH_TOKEN = 'deep-secret';
  stubFetch(async () => ({ ok: true, status: 200, text: async () => '{}' }));
  const denied = mockRes();
  await handler({ method: 'GET', url: '/api/health?deep=1' }, denied);
  assert.equal(denied.statusCode, 401);
  assertPublicBody(denied.body, { ok: false, reason: 'deep_unauthorized' });
  assert.equal(calls.length, 0);

  const allowed = mockRes();
  await handler({
    method: 'GET',
    url: '/api/health?deep=1',
    headers: { authorization: 'Bearer deep-secret' },
  }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.deep, true);
  assert.equal(calls.length, 1);
});

test('overlapping deep probes share one chat turn', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  stubFetch(async () => {
    await gate;
    return { ok: true, status: 200, text: async () => '{"result":"ok"}' };
  });
  const first = mockRes();
  const second = mockRes();
  const pending = Promise.all([
    handler({ method: 'GET', url: '/api/health?deep=1' }, first),
    handler({ method: 'GET', url: '/api/health?deep=1' }, second),
  ]);
  release();
  await pending;
  assert.equal(calls.length, 1);
  assert.deepEqual(first.body, { ok: true, deep: true });
  assert.deepEqual(second.body, { ok: true, deep: true });
});
