const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/agent');
const { resetOpsAlertCooldown } = require('../lib/slack-alert');

const realFetch = global.fetch;

function mockRes() {
  const res = { statusCode: 0, body: null, raw: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (payload) => { res.raw = payload; return res; };
  return res;
}

function validBody(extra) {
  return {
    prompt: 'secret review text from Jane Doe jane@example.com',
    agent: 'reputation-rocket',
    session_id: 'sess-abc',
    client_slug: 'lean-labs',
    config: {
      client_name: 'Lean Labs',
      customer_name: 'Jane Doe',
      customer_email: 'jane@example.com',
      platforms: ['hubspot'],
      review_links: { hubspot: 'https://example.com/review' },
    },
    ...extra,
  };
}

let calls;
beforeEach(() => {
  calls = [];
  resetOpsAlertCooldown();
  process.env.FACTOR8_API_KEY = 'test-key';
  process.env.FACTOR8_API_URL = 'https://factor8.example/api/v1/brand-slug/test/query';
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  process.env.VERCEL_ENV = 'production';
  delete process.env.SLACK_ALERT_CHANNEL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

afterEach(() => {
  global.fetch = realFetch;
  resetOpsAlertCooldown();
  delete process.env.SLACK_BOT_TOKEN;
});

function stubFetch(impl) {
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init);
  };
}

function slackPosts() {
  return calls.filter((call) => call.url.includes('slack.com')).map((call) => JSON.parse(call.init.body));
}

function factor8Calls() {
  return calls.filter((call) => call.url.includes('factor8.example'));
}

function upstream(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => 'application/json' },
    text: async () => body,
  };
}

test('the browser sends the portal slug on both agent calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const matches = src.match(/session_id: sessionId,\n\s+client_slug: PARAMS\.clientSlug/g) || [];
  assert.equal(matches.length, 2);
});

test('upstream 502 alerts once and does not forward the slug or leak PII', async () => {
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return upstream(502, JSON.stringify({
      detail: 'The review assistant hit a temporary problem. Please retry.',
      prompt: 'secret review text from Jane Doe jane@example.com',
      customer_email: 'jane@example.com',
    }));
  });

  const res = mockRes();
  await handler({
    method: 'POST',
    headers: {},
    body: validBody(),
  }, res);

  assert.equal(res.statusCode, 502);
  assert.match(res.raw, /temporary problem/);
  const sent = JSON.parse(factor8Calls()[0].init.body);
  assert.equal(sent.client_slug, undefined);
  assert.equal(sent.config.customer_email, 'jane@example.com');
  assert.equal(factor8Calls()[0].init.headers['X-API-Key'], 'test-key');

  const posts = slackPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channel, 'C09BD2WUQ4B');
  assert.match(posts[0].text, /Client: lean-labs \(Lean Labs\)/);
  assert.match(posts[0].text, /Session: sess-abc/);
  assert.match(posts[0].text, /Upstream: HTTP 502/);
  assert.match(posts[0].text, /temporary problem/);
  assert.match(posts[0].text, /Environment: production/);
  assert.doesNotMatch(posts[0].text, /jane@example.com|Jane Doe|secret review text|test-key|xoxb-test-token/i);

  const again = mockRes();
  await handler({ method: 'POST', headers: {}, body: validBody() }, again);
  assert.equal(slackPosts().length, 1);
});

test('upstream 4xx is passed through and does not alert', async () => {
  stubFetch(async () => upstream(400, '{"detail":"bad request"}'));
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(slackPosts().length, 0);
});

test('a network failure alerts on the Agent request failed path', async () => {
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error('ECONNREFUSED secret jane@example.com');
  });
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'Agent request failed');
  assert.match(res.body.message, /ECONNREFUSED/);
  const posts = slackPosts();
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /Upstream: network/);
  assert.match(posts[0].text, /Agent request failed/);
  assert.doesNotMatch(posts[0].text, /ECONNREFUSED|jane@example.com|secret review text/);
});

test('a timeout alerts without the review text', async () => {
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  });
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 502);
  assert.match(slackPosts()[0].text, /Upstream: timeout/);
  assert.match(slackPosts()[0].text, /Agent request timed out/);
  assert.doesNotMatch(slackPosts()[0].text, /secret review text/);
});

test('missing FACTOR8_API_KEY alerts and does not call Factor8', async () => {
  delete process.env.FACTOR8_API_KEY;
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    throw new Error('should not fetch Factor8');
  });
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: {
      referer: 'https://reputationrocket.ai/propertyradar/?email=jane@example.com',
    },
    body: validBody(),
  }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Missing FACTOR8_API_KEY');
  assert.equal(factor8Calls().length, 0);
  assert.match(slackPosts()[0].text, /Missing FACTOR8_API_KEY/);
  assert.match(slackPosts()[0].text, /lean-labs/);
  assert.doesNotMatch(slackPosts()[0].text, /jane@example.com|test-key/);
});

test('slug falls back to the referer path and drops the query', async () => {
  stubFetch(async (url) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return upstream(502, '{"detail":"down"}');
  });
  const body = validBody();
  delete body.client_slug;
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: { referer: 'https://reputationrocket.ai/greentec/demo/?email=jane@example.com&name=Jane' },
    body,
  }, res);
  assert.match(slackPosts()[0].text, /Client: greentec \(Lean Labs\)/);
  assert.doesNotMatch(slackPosts()[0].text, /jane@example.com|Jane/);
});

test('sticky 404 retries once and alerts only the final 5xx', async () => {
  let factor8Hits = 0;
  stubFetch(async (url, init) => {
    if (String(url).includes('slack.com')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    factor8Hits += 1;
    if (factor8Hits === 1) {
      assert.equal(init.headers['fly-force-instance-id'], 'machine-9');
      return upstream(404, '{"detail":"machine gone"}');
    }
    assert.equal(init.headers['fly-force-instance-id'], undefined);
    return upstream(502, '{"detail":"down after retry"}');
  });
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: { 'fly-force-instance-id': 'machine-9' },
    body: validBody(),
  }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(factor8Calls().length, 2);
  assert.equal(slackPosts().length, 1);
  assert.match(slackPosts()[0].text, /down after retry/);
  assert.doesNotMatch(slackPosts()[0].text, /machine gone/);
});

test('an invalid request and a missing token do not break the response', async () => {
  delete process.env.SLACK_BOT_TOKEN;
  stubFetch(async () => upstream(200, '{}'));
  const invalid = mockRes();
  await handler({ method: 'POST', headers: {}, body: { prompt: 'only prompt' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 0);

  const res = mockRes();
  stubFetch(async () => {
    throw new Error('socket hang up');
  });
  await handler({ method: 'POST', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'Agent request failed');
  assert.equal(calls.some((call) => call.url.includes('slack.com')), false);
});
