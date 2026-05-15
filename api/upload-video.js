const fs = require('fs/promises');
const { formidable } = require('formidable');

const HUBSPOT_FILES_API_URL = 'https://api.hubapi.com/files/v3/files';
const HUBSPOT_HARD_MAX_BYTES = 1024 * 1024 * 1024;
const HUBSPOT_DEFAULT_SAFE_MAX_BYTES = 600 * 1024 * 1024;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fields, files } = await parseMultipartRequest(req);
    const uploaded = firstFile(files.video);
    if (!uploaded) {
      return res.status(400).json({ error: 'Missing video file in form field "video".' });
    }

    const portalId = firstValue(fields.portalId);
    const clientSlug = sanitizePathToken(firstValue(fields.clientSlug) || 'default');
    if (!portalId) {
      return res.status(400).json({
        error: 'Missing portalId',
        detail: 'Set hubspotPortalId per client in config.js and send it with the upload request.',
      });
    }

    const token = resolveHubSpotToken(clientSlug, portalId);
    if (!token) {
      return res.status(500).json({
        error: 'Missing HubSpot token',
        detail: `Set HUBSPOT_FILES_ACCESS_TOKEN_${toEnvSuffix(clientSlug)} (preferred) or HUBSPOT_FILES_ACCESS_TOKEN_${toEnvSuffix(portalId)}.`,
      });
    }

    if (!uploaded.mimetype || !uploaded.mimetype.startsWith('video/')) {
      return res.status(400).json({ error: 'Uploaded file must be a video.' });
    }
    const normalizedMimeType = normalizeVideoMimeType(uploaded.mimetype);
    if (!normalizedMimeType) {
      return res.status(415).json({
        error: 'Unsupported video format',
        detail: `Unsupported mime type: ${uploaded.mimetype}. Please use mp4 or webm.`,
      });
    }
    const safeMaxBytes = HUBSPOT_DEFAULT_SAFE_MAX_BYTES;
    if (typeof uploaded.size === 'number' && uploaded.size > safeMaxBytes) {
      return res.status(413).json({
        error: 'Video file too large',
        detail: `Please keep uploads under ${Math.round(safeMaxBytes / (1024 * 1024))}MB for reliable HubSpot ingestion.`,
        bytes: uploaded.size,
      });
    }

    const fileBuffer = await fs.readFile(uploaded.filepath);
    const ext = normalizedMimeType === 'video/mp4' ? 'mp4' : 'webm';
    const firstNameBase =
      sanitizePathToken(firstValue(fields.firstName) || firstToken(firstValue(fields.customerName)) || 'visitor')
        .replace(/-/g, '_');
    const companyBase =
      sanitizePathToken(
        firstValue(fields.visitorCompany) ||
        firstValue(fields.customerCompany) ||
        'company',
      ).replace(/-/g, '_');
    const fileName = `${firstNameBase}+${companyBase}_reprocket_testimonial.${ext}`;

    const folderPath = `/reputation-rocket/${clientSlug}`;
    const attemptA = await uploadToHubSpot({
      token,
      fileBuffer,
      mimeType: normalizedMimeType,
      fileName,
      folderPath,
      includeFolder: true,
      includeOptions: true,
    });
    let upstream = attemptA.upstream;
    let text = attemptA.text;
    let body = attemptA.body;
    let uploadAttempt = 'full';

    // HubSpot sometimes returns a generic HTML 400 for multipart shape issues.
    // Retry with a minimal payload before failing.
    if (!upstream.ok && upstream.status === 400) {
      const attemptB = await uploadToHubSpot({
        token,
        fileBuffer,
        mimeType: uploaded.mimetype,
        fileName,
        folderPath,
        includeFolder: false,
        includeOptions: false,
      });
      upstream = attemptB.upstream;
      text = attemptB.text;
      body = attemptB.body;
      uploadAttempt = 'minimal-retry';
    }

    if (!upstream.ok) {
      return res.status(502).json({
        error: 'HubSpot upload failed',
        status: upstream.status,
        detail: body.message || text || 'Unknown upload error',
        upload_attempt: uploadAttempt,
        diagnostics: {
          mime_type: uploaded.mimetype || '',
          normalized_mime_type: normalizedMimeType,
          bytes: fileBuffer.length,
          file_name: fileName,
          safe_max_bytes: safeMaxBytes,
        },
      });
    }

    return res.status(200).json({
      ok: true,
      portal_id: portalId,
      client_slug: clientSlug,
      upload_attempt: uploadAttempt,
      file: {
        id: body.id,
        name: body.name || fileName,
        url: body.url || body.defaultHostingUrl || '',
        size: body.size || fileBuffer.length,
      },
      lead: {
        customer_name: firstValue(fields.customerName) || '',
        customer_email: firstValue(fields.customerEmail) || '',
        customer_company: firstValue(fields.customerCompany) || '',
      },
      session_id: firstValue(fields.sessionId) || '',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Video upload request failed',
      message: error.message,
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipartRequest(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: HUBSPOT_HARD_MAX_BYTES + (5 * 1024 * 1024),
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function firstFile(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function firstValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value).trim();
}

function resolveHubSpotToken(clientSlug, portalId) {
  const slugSuffix = toEnvSuffix(clientSlug);
  const portalSuffix = toEnvSuffix(portalId);
  return (
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${slugSuffix}`] ||
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${portalSuffix}`] ||
    ''
  );
}

function toEnvSuffix(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sanitizeFileName(value) {
  const name = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return name || '';
}

function sanitizePathToken(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'default';
}

function firstToken(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0] || '';
}

function normalizeVideoMimeType(raw) {
  const base = String(raw || '').split(';')[0].trim().toLowerCase();
  if (base === 'video/webm' || base === 'video/mp4') return base;
  return '';
}

async function uploadToHubSpot({
  token,
  fileBuffer,
  mimeType,
  fileName,
  folderPath,
  includeFolder,
  includeOptions,
}) {
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  formData.append('fileName', fileName);
  if (includeFolder) formData.append('folderPath', folderPath);
  if (includeOptions) formData.append('options', JSON.stringify({ access: 'PRIVATE' }));

  const upstream = await fetch(HUBSPOT_FILES_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const text = await upstream.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = {};
  }
  return { upstream, text, body };
}
