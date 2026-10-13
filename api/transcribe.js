const fs = require('fs/promises');
const { formidable } = require('formidable');

// gpt-4o-transcribe is the accurate Whisper-class model. Override with
// OPENAI_TRANSCRIBE_MODEL (e.g. gpt-4o-mini-transcribe or whisper-1).
const DEFAULT_MODEL = 'gpt-4o-transcribe';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
// Vercel rejects request bodies over 4.5 MB before the function runs, so stay under it.
// The browser records Opus at 32 kbps, so 4 MB is roughly 15 minutes of speech.
const MAX_BYTES = 4 * 1024 * 1024;
// Spelling hints for the product and review sites. The browser also sends the
// client name and the question, and that context is placed first so it wins.
const VOCAB_PROMPT = 'A customer answering review interview questions. '
  + 'Words that may come up: Reputation Rocket, Greentec, eImmigration, PropertyRadar, '
  + 'HubSpot, G2, Gartner, Capterra, Trustpilot, Google reviews.';
// The browser sends the client name and the question on screen. Cap it so a long
// agent turn can't crowd out the vocab hints or blow past Whisper's prompt window.
const MAX_CONTEXT_CHARS = 600;
const MAX_PROMPT_CHARS = 900;
const MAX_TRANSCRIPT_CHARS = 8000;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const UPSTREAM_TIMEOUT_MS = 55000;

function transcribePrompt(context) {
  const extra = String(context || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
  const combined = extra ? `${extra} ${VOCAB_PROMPT}` : VOCAB_PROMPT;
  return combined.slice(0, MAX_PROMPT_CHARS);
}

function transcribeModel() {
  const raw = String(process.env.OPENAI_TRANSCRIBE_MODEL || '').trim();
  if (raw && MODEL_NAME.test(raw)) return raw;
  return DEFAULT_MODEL;
}

function transcribeUrl() {
  const raw = String(process.env.OPENAI_BASE_URL || '').trim();
  if (!raw) return `${DEFAULT_BASE_URL}/audio/transcriptions`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw fail(503, 'rejected');
  }
  // The API key is sent to this host. Only https, with no embedded password,
  // so a typo cannot leak the key in cleartext or into a URL userinfo field.
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw fail(503, 'rejected');
  }
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '');
  return `${parsed.origin}${path}/audio/transcriptions`;
}

function fail(status, reason) {
  const err = new Error(reason);
  err.status = status;
  err.reason = reason;
  return err;
}

function firstFile(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function readContextField(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return first;
  return '';
}

/**
 * File type comes from the bytes, not the name the browser sent.
 * Returns an allowed extension, or '' when the payload is not audio.
 */
function sniffAudioExt(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'webm';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buffer.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) return 'mp3';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && (buffer[3] === 0xBA || buffer[3] === 0xB3)) {
    return 'mpeg';
  }
  return '';
}

function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_BYTES,
    maxFiles: 1,
    maxFields: 4,
    maxFieldsSize: 8 * 1024,
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        const tooBig = err.httpCode === 413 || /maxFileSize|maxTotalFileSize|maxFieldsSize|max file size/i.test(String(err.message || ''));
        reject(fail(tooBig ? 413 : 400, tooBig ? 'too_large' : 'bad_audio'));
        return;
      }
      resolve({ fields, files });
    });
  });
}

async function transcribeAudio({ buffer, context }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw fail(503, 'missing_openai_key');
  if (!buffer || !buffer.length) throw fail(400, 'bad_audio');
  if (buffer.length > MAX_BYTES) throw fail(413, 'too_large');
  const ext = sniffAudioExt(buffer);
  if (!ext) throw fail(400, 'bad_audio');

  const body = new FormData();
  body.append('model', transcribeModel());
  body.append('language', 'en');
  body.append('prompt', transcribePrompt(context));
  body.append('response_format', 'json');
  body.append('file', new Blob([buffer]), `answer.${ext}`);

  const url = transcribeUrl();
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && err.reason) throw err;
    throw fail(503, 'unreachable');
  }

  if (!upstream.ok) {
    try { await upstream.arrayBuffer(); } catch (_) { /* discard upstream body */ }
    const rejected = upstream.status === 401 || upstream.status === 403;
    throw fail(503, rejected ? 'rejected' : 'transcribe_failed');
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (_) {
    throw fail(503, 'transcribe_failed');
  }
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  return text.trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ reason: 'method_not_allowed' });
  }

  let uploadedPath = '';
  try {
    const { fields, files } = await parseMultipart(req);
    const file = firstFile(files.audio);
    if (!file || !file.filepath) throw fail(400, 'bad_audio');
    uploadedPath = file.filepath;
    if (typeof file.size === 'number' && file.size > MAX_BYTES) throw fail(413, 'too_large');
    const buffer = await fs.readFile(file.filepath);
    const text = await transcribeAudio({
      buffer,
      context: readContextField(fields && fields.context),
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ text });
  } catch (err) {
    const status = err && err.status ? err.status : 503;
    const reason = err && err.reason ? err.reason : 'transcribe_failed';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ reason });
  } finally {
    if (uploadedPath) fs.unlink(uploadedPath).catch(() => {});
  }
}

module.exports = handler;
module.exports.config = {
  api: { bodyParser: false },
  maxDuration: 60,
};
module.exports.transcribeAudio = transcribeAudio;
module.exports.MODEL = DEFAULT_MODEL;
module.exports.MAX_BYTES = MAX_BYTES;
module.exports.MAX_CONTEXT_CHARS = MAX_CONTEXT_CHARS;
module.exports.MAX_TRANSCRIPT_CHARS = MAX_TRANSCRIPT_CHARS;
module.exports.transcribeModel = transcribeModel;
module.exports.transcribeUrl = transcribeUrl;
module.exports.transcribePrompt = transcribePrompt;
module.exports.sniffAudioExt = sniffAudioExt;
module.exports.readContextField = readContextField;
