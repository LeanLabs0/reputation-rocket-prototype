const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/transcribe');

function mockRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const realFetch = global.fetch;
let calls;

beforeEach(() => {
  calls = [];
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.OPENAI_API_KEY;
});

function stubFetch(impl) {
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
}

test('transcription uses gpt-4o-transcribe and returns only the text', async () => {
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: ' Five stars ' }),
  }));
  const text = await handler.transcribeAudio({
    buffer: Buffer.from('audio'),
    filename: 'answer.webm',
  });
  assert.equal(text, 'Five stars');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(calls[0].init.body.get('model'), 'gpt-4o-transcribe');
  assert.equal(calls[0].init.body.get('language'), 'en');
  assert.match(calls[0].init.body.get('prompt'), /Reputation Rocket/);
  assert.equal(handler.MODEL, 'gpt-4o-transcribe');
});

test('the question context is added to the prompt, capped in length', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ text: 'ok' }) }));
  await handler.transcribeAudio({
    buffer: Buffer.from('audio'),
    filename: 'answer.webm',
    context: 'A customer is answering a review interview about Greentec. ' + 'x'.repeat(5000),
  });
  const prompt = calls[0].init.body.get('prompt');
  assert.match(prompt, /Reputation Rocket/);
  assert.match(prompt, /about Greentec/);
  assert.doesNotMatch(prompt, /Lean Labs/);
  assert.ok(prompt.length < 1000);
});

test('a missing key never calls OpenAI', async () => {
  delete process.env.OPENAI_API_KEY;
  stubFetch(async () => { throw new Error('should not fetch'); });
  await assert.rejects(
    () => handler.transcribeAudio({ buffer: Buffer.from('audio'), filename: 'answer.webm' }),
    (err) => err.reason === 'missing_openai_key' && err.status === 503,
  );
  assert.equal(calls.length, 0);
});

test('a rejected key is a short reason and the key is not returned', async () => {
  stubFetch(async () => ({
    ok: false,
    status: 401,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  await assert.rejects(
    () => handler.transcribeAudio({ buffer: Buffer.from('audio'), filename: 'answer.webm' }),
    (err) => err.reason === 'rejected' && !String(err.message).includes('test-openai-key'),
  );
});

test('only POST is allowed', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { reason: 'method_not_allowed' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('model and base URL can be overridden by env', async () => {
  process.env.OPENAI_TRANSCRIBE_MODEL = 'whisper-1';
  process.env.OPENAI_BASE_URL = 'https://example.test/v1/';
  try {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ text: 'hi' }) }));
    await handler.transcribeAudio({ buffer: Buffer.from('audio'), filename: 'answer.webm' });
    assert.equal(calls[0].url, 'https://example.test/v1/audio/transcriptions');
    assert.equal(calls[0].init.body.get('model'), 'whisper-1');
  } finally {
    delete process.env.OPENAI_TRANSCRIBE_MODEL;
    delete process.env.OPENAI_BASE_URL;
  }
});

test('uploads stay under the Vercel 4.5 MB body limit', async () => {
  assert.ok(handler.MAX_BYTES < 4.5 * 1024 * 1024);
  stubFetch(async () => { throw new Error('should not fetch'); });
  await assert.rejects(
    () => handler.transcribeAudio({ buffer: Buffer.alloc(handler.MAX_BYTES + 1), filename: 'answer.webm' }),
    (err) => err.reason === 'too_large' && err.status === 413,
  );
});
