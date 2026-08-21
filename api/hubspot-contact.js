const { resolveHubSpotAccessToken, toEnvSuffix } = require('../lib/hubspot/tokens');
const {
  COMPLETE_PROPERTY,
  OUTCOME_PROPERTY,
  ensureContactProperty,
} = require('../lib/hubspot/provision');

const CONTACTS_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
const CONTACTS_UPSERT_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert';
const CONTACT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSafePropertyName(name) {
  return /^[a-z][a-z0-9_]*$/i.test(String(name || '').trim());
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

  const token = await resolveHubSpotAccessToken(clientSlug, portalId);
  if (!token) {
    const suffix = toEnvSuffix(clientSlug);
    return res.status(500).json({
      error: 'HubSpot token not configured',
      detail: `Connect HubSpot at /configure for ${clientSlug}, or set HUBSPOT_FILES_ACCESS_TOKEN_${suffix}.`,
    });
  }

  try {
    await assertTokenPortal(token, portalId);

    await Promise.all([
      ensureContactProperty(token, COMPLETE_PROPERTY).catch(() => null),
      ensureContactProperty(token, OUTCOME_PROPERTY).catch(() => null),
    ]);

    let upserted;
    try {
      upserted = await upsertContactByEmail(token, email, { ...properties, email });
    } catch (err) {
      const aliases = await mapAliasProperties(token, properties);
      if (!Object.keys(aliases).length) throw err;
      upserted = await upsertContactByEmail(token, email, { ...aliases, email });
    }

    const aliases = await mapAliasProperties(token, properties).catch(() => ({}));
    if (Object.keys(aliases).length) {
      await upsertContactByEmail(token, email, aliases).catch(() => null);
    }

    const contactId = upserted?.id || await findContactIdByEmail(token, email);
    if (!contactId) {
      return res.status(404).json({ error: 'Contact not found', email });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      properties: { ...properties, ...aliases },
    });
  } catch (err) {
    console.error('[hubspot-contact]', err);
    return res.status(502).json({
      error: 'HubSpot update failed',
      message: err.message,
      detail: err.message,
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
  if (!res.ok && !(options.allowNotFound && res.status === 404)) {
    const msg = payload.message || payload.error || text || res.statusText;
    const err = new Error(`${res.status}: ${msg}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function listContactProperties(token) {
  const all = [];
  let after = '';
  for (let i = 0; i < 8; i++) {
    const url = `${CONTACT_PROPERTIES_URL}?archived=false${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const payload = await hubspotFetch(token, url);
    all.push(...(Array.isArray(payload.results) ? payload.results : []));
    after = payload.paging?.next?.after || '';
    if (!after) break;
  }
  return all;
}

async function mapAliasProperties(token, properties) {
  const aliases = {};
  const hasComplete = Object.prototype.hasOwnProperty.call(properties, 'rr_iscomplete');
  const hasOutcome = Object.prototype.hasOwnProperty.call(properties, 'rr_outcome');
  if (!hasComplete && !hasOutcome) return aliases;

  let listed = [];
  try {
    listed = await listContactProperties(token);
  } catch (_) {
    return aliases;
  }

  if (hasComplete) {
    const alias = findMatchingProperty(
      listed,
      ['ll_reprocket_is_complete', 'll_reprocket_iscomplete', 'rr_is_complete'],
      ['reprocket', 'complete'],
    );
    if (alias && alias !== 'rr_iscomplete') aliases[alias] = properties.rr_iscomplete;
  }
  if (hasOutcome) {
    const alias = findMatchingProperty(
      listed,
      ['ll_reprocket_outcome', 'rr_outcomes'],
      ['reprocket', 'outcome'],
    );
    if (alias && alias !== 'rr_outcome') aliases[alias] = properties.rr_outcome;
  }
  return aliases;
}

function findMatchingProperty(list, aliases, needles) {
  const byName = new Map(list.map((p) => [String(p.name || '').toLowerCase(), p]));
  for (const raw of aliases) {
    const key = String(raw || '').trim().toLowerCase();
    if (key && byName.has(key)) return byName.get(key).name;
  }
  const found = list.find((p) => {
    const blob = `${p.name || ''} ${p.label || ''}`.toLowerCase();
    const compact = blob.replace(/[^a-z0-9]+/g, '');
    return needles.every((n) => blob.includes(n) || compact.includes(n.replace(/[^a-z0-9]+/g, '')));
  });
  return found?.name || '';
}

async function assertTokenPortal(token, expectedPortalId) {
  let info = null;
  try {
    info = await hubspotFetch(token, 'https://api.hubapi.com/integrations/v1/me');
  } catch (_) {
    try {
      info = await hubspotFetch(token, 'https://api.hubapi.com/account-info/v3/details');
    } catch (_) {
      return;
    }
  }
  const actual = String(info.portalId || info.portal_id || '').trim();
  if (actual && actual !== String(expectedPortalId)) {
    throw new Error(`HubSpot token is for portal ${actual}, expected ${expectedPortalId}. Reconnect HubSpot for this client at /configure.`);
  }
}

async function upsertContactByEmail(token, email, properties) {
  const payload = await hubspotFetch(token, CONTACTS_UPSERT_URL, {
    method: 'POST',
    body: JSON.stringify({
      inputs: [{
        idProperty: 'email',
        id: email,
        properties,
      }],
    }),
  });
  if (payload.numErrors) {
    const msg = payload.errors?.[0]?.message || 'HubSpot upsert reported errors';
    throw new Error(msg);
  }
  return payload.results?.[0] || null;
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
