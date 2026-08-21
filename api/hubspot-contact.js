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

    const coerced = await coerceEnumerationValues(token, properties);

    let upserted;
    try {
      upserted = await upsertContactByEmail(token, email, { ...coerced, email });
    } catch (err) {
      const aliases = await mapAliasProperties(token, coerced);
      if (!Object.keys(aliases).length) throw err;
      const coercedAliases = await coerceEnumerationValues(token, aliases);
      upserted = await upsertContactByEmail(token, email, { ...coercedAliases, email });
    }

    const aliases = await mapAliasProperties(token, coerced).catch(() => ({}));
    if (Object.keys(aliases).length) {
      const coercedAliases = await coerceEnumerationValues(token, aliases);
      await upsertContactByEmail(token, email, coercedAliases).catch(() => null);
    }

    const contactId = upserted?.id || await findContactIdByEmail(token, email);
    if (!contactId) {
      return res.status(404).json({ error: 'Contact not found', email });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      properties: { ...coerced, ...aliases },
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
  const { allowNotFound = false, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(fetchOptions.headers || {}),
    },
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) { /* not JSON */ }
  if (!res.ok && !(allowNotFound && res.status === 404)) {
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

async function getContactProperty(token, name) {
  return hubspotFetch(token, `${CONTACT_PROPERTIES_URL}/${encodeURIComponent(name)}`, {
    allowNotFound: true,
  });
}

function normalizeOptionToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function optionFamily(value) {
  const token = normalizeOptionToken(value);
  if (token.includes('pos')) return 'positive';
  if (token.includes('neg')) return 'negative';
  if (token === 'yes' || token === 'true' || token === 'y') return 'yes';
  if (token === 'no' || token === 'false' || token === 'n') return 'no';
  return token;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function matchAllowedOption(options, wanted) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length || wanted == null || wanted === '') return wanted;

  const exact = list.find((o) => String(o.value) === wanted);
  if (exact) return exact.value;

  const wantedLower = wanted.toLowerCase();
  const caseInsensitive = list.find((o) => (
    String(o.value || '').toLowerCase() === wantedLower
    || String(o.label || '').toLowerCase() === wantedLower
  ));
  if (caseInsensitive) return caseInsensitive.value;

  const wantedNorm = normalizeOptionToken(wanted);
  const compact = list.find((o) => (
    normalizeOptionToken(o.value) === wantedNorm
    || normalizeOptionToken(o.label) === wantedNorm
  ));
  if (compact) return compact.value;

  let bestValue = '';
  let bestDist = 3;
  for (const option of list) {
    for (const candidate of [option.value, option.label]) {
      const dist = levenshtein(normalizeOptionToken(candidate), wantedNorm);
      if (dist < bestDist) {
        bestDist = dist;
        bestValue = option.value;
      }
    }
  }
  if (bestValue) return bestValue;

  const family = optionFamily(wanted);
  const familyMatch = list.find((o) => (
    optionFamily(o.value) === family || optionFamily(o.label) === family
  ));
  return familyMatch ? familyMatch.value : wanted;
}

async function coerceEnumerationValues(token, properties) {
  const coerced = { ...properties };
  const names = Object.keys(coerced).filter((name) => name !== 'email');
  await Promise.all(names.map(async (name) => {
    const definition = await getContactProperty(token, name).catch(() => null);
    if (!definition || !Array.isArray(definition.options) || !definition.options.length) return;
    coerced[name] = matchAllowedOption(definition.options, String(coerced[name]));
  }));
  return coerced;
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
