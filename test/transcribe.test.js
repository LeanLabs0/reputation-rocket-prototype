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
  delete process.env.OPENAI_TRANSCRIBE_MODEL;
  delete process.env.OPENAI_BASE_URL;
});

function wavBuffer() {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(0, 40);
  return header;
}

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
    buffer: wavBuffer(),
    filename: 'answer.webm',
  });
  assert.equal(text, 'Five stars');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(calls[0].init.body.get('model'), 'gpt-4o-transcribe');
  assert.equal(calls[0].init.body.get('language'), 'en');
  assert.match(calls[0].init.body.get('prompt'), /Reputation Rocket/);
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal);
  assert.equal(calls[0].init.body.get('file').name, 'answer.wav');
  assert.equal(handler.MODEL, 'gpt-4o-transcribe');
});

test('the question context is added to the prompt, capped in length', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ text: 'ok' }) }));
  await handler.transcribeAudio({
    buffer: wavBuffer(),
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
    () => handler.transcribeAudio({ buffer: wavBuffer(), filename: 'answer.webm' }),
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
    () => handler.transcribeAudio({ buffer: wavBuffer(), filename: 'answer.webm' }),
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
    await handler.transcribeAudio({ buffer: wavBuffer(), filename: 'answer.webm' });
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

test('a non-audio upload is refused before OpenAI is called', async () => {
  stubFetch(async () => { throw new Error('should not fetch'); });
  await assert.rejects(
    () => handler.transcribeAudio({ buffer: Buffer.from('<html>not audio</html>'), filename: 'answer.webm' }),
    (err) => err.reason === 'bad_audio' && err.status === 400,
  );
  assert.equal(calls.length, 0);
});

test('audio type is taken from the bytes, not the file name', () => {
  assert.equal(handler.sniffAudioExt(wavBuffer()), 'wav');
  const webm = Buffer.alloc(16);
  webm[0] = 0x1A;
  webm[1] = 0x45;
  webm[2] = 0xDF;
  webm[3] = 0xA3;
  assert.equal(handler.sniffAudioExt(webm), 'webm');
  const mp4 = Buffer.alloc(16);
  mp4.write('ftyp', 4);
  assert.equal(handler.sniffAudioExt(mp4), 'mp4');
  assert.equal(handler.sniffAudioExt(Buffer.from('answer.webm is not audio')), '');
});

test('an http base URL is refused and the key is not sent', async () => {
  process.env.OPENAI_BASE_URL = 'http://example.test/v1';
  stubFetch(async () => { throw new Error('should not fetch'); });
  await assert.rejects(
    () => handler.transcribeAudio({ buffer: wavBuffer() }),
    (err) => err.reason === 'rejected' && err.status === 503,
  );
  assert.equal(calls.length, 0);
});

test('a model override with unexpected characters falls back to the default', async () => {
  process.env.OPENAI_TRANSCRIBE_MODEL = 'whisper-1\r\nX-Injected: yes';
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ text: 'hi' }) }));
  await handler.transcribeAudio({ buffer: wavBuffer() });
  assert.equal(calls[0].init.body.get('model'), 'gpt-4o-transcribe');
});

test('the question context is accepted as a string or a list and stays free of control characters', () => {
  assert.equal(handler.readContextField(['about Greentec']), 'about Greentec');
  assert.equal(handler.readContextField('about Greentec'), 'about Greentec');
  assert.equal(handler.readContextField(null), '');
  const prompt = handler.transcribePrompt('Greentec\u0000\nquestion');
  assert.match(prompt, /^Greentec question/);
  assert.equal(prompt.includes('\u0000'), false);
});

test('a transcript that is not plain text is dropped', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ text: { leak: 'nope' } }) }));
  const text = await handler.transcribeAudio({ buffer: wavBuffer() });
  assert.equal(text, '');
});
