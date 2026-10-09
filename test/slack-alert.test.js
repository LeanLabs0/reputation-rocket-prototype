const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  sendOpsAlert,
  scrubAlertText,
  alertDetailFromBody,
  slugFromReferer,
  dedupeKey,
  resetOpsAlertCooldown,
  DEFAULT_ALERT_CHANNEL,
  COOLDOWN_MS,
} = require('../lib/slack-alert');

const realFetch = global.fetch;

beforeEach(() => {
  resetOpsAlertCooldown();
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
  delete process.env.SLACK_ALERT_CHANNEL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.VERCEL_ENV;
});

test('cooldown is 15 minutes', () => {
  assert.equal(COOLDOWN_MS, 15 * 60 * 1000);
});

test('default channel is #ai-support', () => {
  assert.equal(DEFAULT_ALERT_CHANNEL, 'C09BD2WUQ4B');
});

test('scrub removes emails, tokens, and webhook urls', () => {
  const cleaned = scrubAlertText(
    'jane@example.com xoxb-secret-token Bearer abc.def https://hooks.slack.com/services/T/B/secret',
  );
  assert.doesNotMatch(cleaned, /jane@example.com/);
  assert.doesNotMatch(cleaned, /xoxb-secret/);
  assert.doesNotMatch(cleaned, /abc\.def/);
  assert.doesNotMatch(cleaned, /hooks\.slack\.com/);
  assert.match(cleaned, /\[redacted-email\]/);
  assert.match(cleaned, /\[redacted-token\]/);
  assert.match(cleaned, /\[redacted-webhook\]/);
});

test('upstream detail prefers the detail string and drops echoed customer fields', () => {
  const detail = alertDetailFromBody(JSON.stringify({
    detail: 'The review assistant hit a temporary problem. Please retry.',
    prompt: 'This review text must not leak',
    customer_email: 'jane@example.com',
    customer_name: 'Jane Doe',
  }));
  assert.equal(detail, 'The review assistant hit a temporary problem. Please retry.');
  assert.doesNotMatch(detail, /Jane|review text|jane@example.com/);
});

test('referer slug ignores the query string', () => {
  const slug = slugFromReferer({
    headers: {
      referer: 'https://reputationrocket.ai/eimmigration/?email=jane@example.com&name=Jane%20Doe',
    },
  });
  assert.equal(slug, 'eimmigration');
});

test('dedupe key ignores session and client and changes with the detail', () => {
  assert.equal(dedupeKey(502, 'Same detail'), dedupeKey(502, 'Same detail'));
  assert.notEqual(dedupeKey(502, 'Same detail'), dedupeKey(502, 'Other detail'));
  assert.notEqual(dedupeKey(502, 'Same detail'), dedupeKey(504, 'Same detail'));
});

test('unset bot token does not call Slack', async () => {
  delete process.env.SLACK_BOT_TOKEN;
  let called = false;
  global.fetch = async () => { called = true; return { ok: true }; };
  const result = await sendOpsAlert({ status: 502, detail: 'down' });
  assert.equal(result.skipped, 'unconfigured');
  assert.equal(called, false);
});

test('alert posts to #ai-support and omits secrets and customer fields', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const result = await sendOpsAlert({
    source: 'chat request',
    clientSlug: 'lean-labs',
    clientName: 'Lean Labs',
    agent: 'reputation-rocket',
    sessionId: 'sess-123',
    status: 502,
    detail: 'The review assistant hit a temporary problem. Please retry.',
    customer_email: 'jane@example.com',
    customer_name: 'Jane Doe',
    prompt: 'secret review text',
  });

  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer xoxb-test-token');
  const posted = JSON.parse(calls[0].init.body);
  assert.equal(posted.channel, 'C09BD2WUQ4B');
  assert.equal(posted.unfurl_links, false);
  assert.match(posted.text, /Reputation Rocket chat is failing/);
  assert.match(posted.text, /Source: chat request/);
  assert.match(posted.text, /Environment: production/);
  assert.match(posted.text, /Client: lean-labs \(Lean Labs\)/);
  assert.match(posted.text, /Agent: reputation-rocket/);
  assert.match(posted.text, /Session: sess-123/);
  assert.match(posted.text, /Upstream: HTTP 502/);
  assert.match(posted.text, /temporary problem/);
  assert.doesNotMatch(posted.text, /jane@example.com|Jane Doe|secret review text|xoxb-test-token/i);
});

test('a repeated error inside the window does not post again', async () => {
  let slackPosts = 0;
  global.fetch = async () => {
    slackPosts += 1;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const input = { status: 502, detail: 'down' };
  assert.equal((await sendOpsAlert(input)).sent, true);
  assert.equal((await sendOpsAlert(input)).skipped, 'cooldown');
  assert.equal(slackPosts, 1);
});

test('KV NX blocks a second instance and a failed KV call still alerts', async () => {
  process.env.KV_REST_API_URL = 'https://kv.example';
  process.env.KV_REST_API_TOKEN = 'kv-token';
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('kv.example')) {
      const command = JSON.parse(init.body);
      assert.equal(command[0], 'SET');
      assert.equal(command[3], 'NX');
      assert.equal(command[4], 'EX');
      assert.equal(command[5], '900');
      return { ok: true, status: 200, json: async () => ({ result: null }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const blocked = await sendOpsAlert({ status: 502, detail: 'shared outage' });
  assert.equal(blocked.skipped, 'cooldown');
  assert.equal(calls.some((call) => call.url.includes('slack.com')), false);

  resetOpsAlertCooldown();
  global.fetch = async (url) => {
    calls.push({ url: String(url) });
    if (String(url).includes('kv.example')) {
      return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const failedOpen = await sendOpsAlert({ status: 502, detail: 'shared outage' });
  assert.equal(failedOpen.sent, true);
});

test('SLACK_ALERT_CHANNEL overrides #ai-support', async () => {
  process.env.SLACK_ALERT_CHANNEL = 'C0OVERRIDE';
  let posted;
  global.fetch = async (url, init) => {
    posted = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await sendOpsAlert({ status: 500, detail: 'Missing FACTOR8_API_KEY' });
  assert.equal(posted.channel, 'C0OVERRIDE');
});
