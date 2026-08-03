const CONTACTS_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';

function toEnvSuffix(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveHubSpotToken(clientSlug, portalId) {
  const slugSuffix = toEnvSuffix(clientSlug);
  const portalSuffix = toEnvSuffix(portalId);
  return (
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${slugSuffix}`] ||
    process.env[`HUBSPOT_FILES_ACCESS_TOKEN_${portalSuffix}`] ||
    ''
  ).trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSafePropertyName(name) {
  return /^[a-z0-9_-]+$/i.test(String(name || '').trim());
}

function collectProperties(body) {
  const out = {};

  if (body.properties && typeof body.properties === 'object' && !Array.isArray(body.properties)) {
    for (const [key, rawValue] of Object.entries(body.properties)) {
      const name = String(key || '').trim();
      const value = String(rawValue ?? '').trim();
      if (!isSafePropertyName(name) || !value) continue;
      out[name] = value;
    }
  }

  const legacyProperty = String(body.property || '').trim();
  const legacyValue = String(body.value ?? '').trim();
  if (legacyProperty && legacyValue && isSafePropertyName(legacyProperty)) {
    out[legacyProperty] = legacyValue;
  }

  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const clientSlug = String(body.client_slug || '').trim();
  const portalId = String(body.portal_id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  const properties = collectProperties(body);
  if (!Object.keys(properties).length) {
    return res.status(400).json({ error: 'Missing properties to update' });
  }

  if (!clientSlug || !portalId) {
    return res.status(400).json({ error: 'Missing client_slug or portal_id' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const token = resolveHubSpotToken(clientSlug, portalId);
  if (!token) {
    const suffix = toEnvSuffix(clientSlug);
    return res.status(500).json({
      error: 'HubSpot token not configured',
      detail: `Set HUBSPOT_FILES_ACCESS_TOKEN_${suffix} (same private app as video upload; add crm.objects.contacts.read + crm.objects.contacts.write scopes).`,
    });
  }

  try {
    const contactId = await findContactIdByEmail(token, email);
    if (!contactId) {
      return res.status(404).json({ error: 'Contact not found', email });
    }

    await patchContactProperties(token, contactId, properties);

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      properties,
    });
  } catch (err) {
    console.error('[hubspot-contact]', err);
    return res.status(502).json({
      error: 'HubSpot update failed',
      message: err.message,
    });
  }
};

async function hubspotFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) { /* not JSON */ }
  if (!res.ok) {
    const msg = payload.message || payload.error || text || res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return payload;
}

async function findContactIdByEmail(token, email) {
  const payload = await hubspotFetch(token, CONTACTS_SEARCH_URL, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email,
        }],
      }],
      properties: ['email'],
      limit: 1,
    }),
  });
  return payload.results?.[0]?.id || null;
}

async function patchContactProperties(token, contactId, properties) {
  return hubspotFetch(token, `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}
