const AVAILABLE_PLATFORMS = [
  { id: 'hubspot', label: 'HubSpot' },
  { id: 'g2', label: 'G2' },
  { id: 'trustpilot', label: 'Trustpilot' },
  { id: 'google', label: 'Google Business' },
  { id: 'capterra', label: 'Capterra' },
  { id: 'gartner', label: 'Gartner' },
  { id: 'clutch', label: 'Clutch' },
];

const PLATFORM_IDS = new Set(AVAILABLE_PLATFORMS.map((p) => p.id));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptySettings(providerName = 'our team') {
  return {
    platforms: ['g2', 'trustpilot'],
    reviewLinks: { g2: '', trustpilot: '' },
    welcomeVideoUrl: '',
    welcomeVideoPoster: '',
    interviewQuestions: [
      `Why did you choose ${providerName}?`,
      'What were you hoping to achieve?',
      'How did we deliver on your expectations?',
    ],
    videoCaptureEnabled: false,
    thankYouUrl: '',
    thankYouRedirectDelayMs: 120000,
    allowedRedirectHosts: [],
    supportEmail: '',
    notifyEmails: [],
    slackChannel: '',
    slackThreadPositive: '',
    slackThreadNegative: '',
  };
}

function normalizePlatforms(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const raw of list) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id || !PLATFORM_IDS.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function normalizeHosts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((h) => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .filter((h, i, arr) => arr.indexOf(h) === i);
}

function normalizeQuestions(value, providerName) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list
    .map((q) => String(q == null ? '' : q).trim())
    .filter(Boolean)
    .slice(0, 12);
  if (cleaned.length) return cleaned;
  return emptySettings(providerName).interviewQuestions;
}

/**
 * Accept https URLs or site-local asset paths (e.g. /assets/video/foo.mp4).
 * Encodes spaces in path segments for local paths.
 */
function normalizeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
    return raw;
  }
  const path = raw.startsWith('/') ? raw : `/${raw.replace(/^\.\//, '')}`;
  return path
    .split('/')
    .map((seg, i) => {
      if (i === 0) return seg;
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch (_) {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
}

function normalizeNotifyEmails(value) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[\n,]+/) : []);
  return [...new Set(
    list
      .map((item) => String(item || '').trim())
      .filter((email) => EMAIL_RE.test(email)),
  )];
}

function normalizeSlackField(value) {
  return String(value || '').trim();
}

/**
 * Normalize portal experience settings from store, API body, or config.js.
 */
function normalizePortalSettings(input = {}, { providerName = 'our team' } = {}) {
  const base = emptySettings(providerName);
  const src = input && typeof input === 'object' ? input : {};
  const platforms = normalizePlatforms(src.platforms != null ? src.platforms : base.platforms);
  const linkSrc = src.reviewLinks && typeof src.reviewLinks === 'object' ? src.reviewLinks : {};
  const reviewLinks = {};
  for (const id of platforms) {
    reviewLinks[id] = String(linkSrc[id] || '').trim();
  }

  const delayRaw = Number(src.thankYouRedirectDelayMs);
  const thankYouRedirectDelayMs = Number.isFinite(delayRaw) && delayRaw >= 0
    ? Math.round(delayRaw)
    : base.thankYouRedirectDelayMs;

  return {
    platforms,
    reviewLinks,
    welcomeVideoUrl: normalizeMediaUrl(src.welcomeVideoUrl),
    welcomeVideoPoster: normalizeMediaUrl(src.welcomeVideoPoster),
    interviewQuestions: normalizeQuestions(src.interviewQuestions, providerName),
    videoCaptureEnabled: Boolean(src.videoCaptureEnabled),
    thankYouUrl: String(src.thankYouUrl || '').trim(),
    thankYouRedirectDelayMs,
    allowedRedirectHosts: normalizeHosts(src.allowedRedirectHosts),
    supportEmail: String(src.supportEmail || '').trim(),
    notifyEmails: normalizeNotifyEmails(src.notifyEmails),
    slackChannel: normalizeSlackField(src.slackChannel),
    slackThreadPositive: normalizeSlackField(src.slackThreadPositive),
    slackThreadNegative: normalizeSlackField(src.slackThreadNegative),
  };
}

function pickSettingsFromConfig(config, providerName) {
  if (!config || typeof config !== 'object') return null;
  return normalizePortalSettings(config, {
    providerName: providerName || config.providerName || 'our team',
  });
}

/**
 * Store wins when a key was saved there. Missing notify/Slack keys fall back to config.js
 * so older store records do not wipe routing that still lives in the file.
 */
function mergePortalSettings(rawStore, fileConfig, providerName) {
  const file = pickSettingsFromConfig(fileConfig, providerName) || emptySettings(providerName);
  if (!rawStore || typeof rawStore !== 'object') return file;
  const store = normalizePortalSettings(rawStore, { providerName });
  const has = (key) => Object.prototype.hasOwnProperty.call(rawStore, key);
  return {
    ...file,
    ...store,
    slackChannel: has('slackChannel') ? store.slackChannel : file.slackChannel,
    slackThreadPositive: has('slackThreadPositive') ? store.slackThreadPositive : file.slackThreadPositive,
    slackThreadNegative: has('slackThreadNegative') ? store.slackThreadNegative : file.slackThreadNegative,
    notifyEmails: has('notifyEmails') ? store.notifyEmails : file.notifyEmails,
  };
}

module.exports = {
  AVAILABLE_PLATFORMS,
  PLATFORM_IDS,
  emptySettings,
  normalizeMediaUrl,
  normalizeNotifyEmails,
  normalizePortalSettings,
  pickSettingsFromConfig,
  mergePortalSettings,
};
