const fs = require('fs/promises');
const { formidable } = require('formidable');

const MODEL = 'gpt-4o-mini-transcribe';
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = new Set(['webm', 'mp4', 'mpeg', 'mp3', 'wav', 'ogg', 'm4a', 'mpga']);

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

function extensionFor(file) {
  const name = String((file && (file.originalFilename || file.newFilename)) || '');
  const fromName = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (ALLOWED_EXT.has(fromName)) return fromName;
  const mime = String((file && file.mimetype) || '').toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  return '';
}

function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_BYTES,
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        const tooBig = err.httpCode === 413 || /maxFileSize|max file size/i.test(String(err.message || ''));
        reject(fail(tooBig ? 413 : 400, tooBig ? 'too_large' : 'bad_audio'));
        return;
      }
      resolve({ fields, files });
    });
  });
}

async function transcribeAudio({ buffer, filename }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw fail(503, 'missing_openai_key');
  if (!buffer || !buffer.length) throw fail(400, 'bad_audio');
  if (buffer.length > MAX_BYTES) throw fail(413, 'too_large');

  const body = new FormData();
  body.append('model', MODEL);
  body.append('file', new Blob([buffer]), filename || 'answer.webm');

  let upstream;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });
  } catch (_) {
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
  return String(payload && payload.text || '').trim();
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ reason: 'method_not_allowed' });
  }

  let uploadedPath = '';
  try {
    const { files } = await parseMultipart(req);
    const file = firstFile(files.audio);
    if (!file || !file.filepath) throw fail(400, 'bad_audio');
    uploadedPath = file.filepath;
    const ext = extensionFor(file);
    if (!ext) throw fail(400, 'bad_audio');
    const buffer = await fs.readFile(file.filepath);
    const text = await transcribeAudio({ buffer, filename: `answer.${ext}` });
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
module.exports.transcribeAudio = transcribeAudio;
module.exports.MODEL = MODEL;
