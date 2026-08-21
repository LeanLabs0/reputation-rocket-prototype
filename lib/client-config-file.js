const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalizePortalSettings } = require('./portal-settings');
const { ROOT, clientDir } = require('./page-paths');

const DEFAULT_HUBSPOT_PROPERTY_CONFIG = {
  hubspotCompleteProperty: 'rr_iscomplete',
  hubspotCompleteValue: 'Yes',
  hubspotIncompleteValue: 'No',
  hubspotOutcomeProperty: 'rr_outcome',
  hubspotOutcomePositiveValue: 'positive',
  hubspotOutcomeNegativeValue: 'negative',
};

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function resolveHubSpotPropertyConfig(...sources) {
  const merged = Object.assign({}, ...sources.filter((s) => s && typeof s === 'object'));
  return {
    hubspotCompleteProperty: firstNonEmpty(merged.hubspotCompleteProperty, DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotCompleteProperty),
    hubspotCompleteValue: firstNonEmpty(merged.hubspotCompleteValue, DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotCompleteValue),
    hubspotIncompleteValue: firstNonEmpty(
      merged.hubspotIncompleteValue,
      merged.hubspotCompleteIncompleteValue,
      DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotIncompleteValue,
    ),
    hubspotOutcomeProperty: firstNonEmpty(merged.hubspotOutcomeProperty, DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotOutcomeProperty),
    hubspotOutcomePositiveValue: firstNonEmpty(merged.hubspotOutcomePositiveValue, DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotOutcomePositiveValue),
    hubspotOutcomeNegativeValue: firstNonEmpty(merged.hubspotOutcomeNegativeValue, DEFAULT_HUBSPOT_PROPERTY_CONFIG.hubspotOutcomeNegativeValue),
  };
}

function configPath(clientSlug) {
  return path.join(clientDir(clientSlug), 'config.js');
}

function readClientConfigFile(clientSlug) {
  const file = configPath(clientSlug);
  if (!fs.existsSync(file)) return null;
  try {
    const src = fs.readFileSync(file, 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(src, sandbox, { timeout: 1000 });
    return sandbox.window.CLIENT_CONFIG || null;
  } catch (err) {
    console.warn('[client-config-file] parse failed for', clientSlug, err.message);
    return null;
  }
}

function jsString(value) {
  return JSON.stringify(value);
}

/**
 * Rewrite config.js keeping identity/HubSpot/endpoints; updating portal experience fields.
 */
function writePortalSettingsToConfigFile(clientSlug, settings, extras = {}) {
  // Vercel deploys are read-only; portal settings persist via KV store instead.
  if (process.env.VERCEL) return false;
  const file = configPath(clientSlug);
  if (!fs.existsSync(file)) return false;

  const existing = readClientConfigFile(clientSlug) || {};
  const providerName = extras.providerName || existing.providerName || clientSlug;
  const normalized = normalizePortalSettings(settings, { providerName });

  const next = {
    clientSlug: existing.clientSlug || clientSlug,
    providerName,
    agentEndpoint: existing.agentEndpoint || '/api/agent',
    notificationEndpoint: existing.notificationEndpoint || '/api/notify',
    ...normalized,
    hubspotPortalId: extras.hubspotPortalId != null
      ? extras.hubspotPortalId
      : (existing.hubspotPortalId || ''),
    hubspotFormId: extras.hubspotFormId != null
      ? extras.hubspotFormId
      : (existing.hubspotFormId || ''),
    hubspotFormRegion: extras.hubspotFormRegion
      || existing.hubspotFormRegion
      || 'na1',
    ...resolveHubSpotPropertyConfig(existing, extras),
  };

  if (existing.platformLogos) next.platformLogos = existing.platformLogos;
  if (existing.postScreenLayout) next.postScreenLayout = existing.postScreenLayout;
  if (existing.videoUploadEndpoint) next.videoUploadEndpoint = existing.videoUploadEndpoint;
  if (existing.hubspotContactEndpoint) next.hubspotContactEndpoint = existing.hubspotContactEndpoint;

  fs.writeFileSync(file, `window.CLIENT_CONFIG = ${serializeConfig(next)};\n`, 'utf8');
  return true;
}

function serializeConfig(obj) {
  const indent = (n) => '  '.repeat(n);
  const lines = ['{'];
  const keys = Object.keys(obj);

  keys.forEach((key, idx) => {
    const comma = idx < keys.length - 1 ? ',' : '';
    const value = obj[key];

    if (key === 'reviewLinks' && value && typeof value === 'object') {
      const linkKeys = Object.keys(value);
      lines.push(`${indent(1)}reviewLinks: {`);
      linkKeys.forEach((lk, li) => {
        const lc = li < linkKeys.length - 1 ? ',' : '';
        lines.push(`${indent(2)}${lk}: ${jsString(value[lk])}${lc}`);
      });
      lines.push(`${indent(1)}}${comma}`);
      return;
    }

    if (key === 'interviewQuestions' && Array.isArray(value)) {
      lines.push(`${indent(1)}interviewQuestions: [`);
      value.forEach((q, qi) => {
        const qc = qi < value.length - 1 ? ',' : '';
        lines.push(`${indent(2)}${jsString(q)}${qc}`);
      });
      lines.push(`${indent(1)}]${comma}`);
      return;
    }

    if (key === 'platforms' || key === 'allowedRedirectHosts' || key === 'notifyEmails') {
      lines.push(`${indent(1)}${key}: ${JSON.stringify(value)}${comma}`);
      return;
    }

    if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${indent(1)}${key}: ${value}${comma}`);
      return;
    }

    if (value && typeof value === 'object') {
      lines.push(`${indent(1)}${key}: ${JSON.stringify(value)}${comma}`);
      return;
    }

    lines.push(`${indent(1)}${key}: ${jsString(value == null ? '' : value)}${comma}`);
  });

  lines.push('}');
  return lines.join('\n');
}

module.exports = {
  ROOT,
  configPath,
  readClientConfigFile,
  writePortalSettingsToConfigFile,
  DEFAULT_HUBSPOT_PROPERTY_CONFIG,
  resolveHubSpotPropertyConfig,
};
