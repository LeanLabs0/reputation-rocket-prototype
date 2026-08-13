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
    welcomeVideoUrl: String(src.welcomeVideoUrl || '').trim(),
    welcomeVideoPoster: String(src.welcomeVideoPoster || '').trim(),
    interviewQuestions: normalizeQuestions(src.interviewQuestions, providerName),
    videoCaptureEnabled: Boolean(src.videoCaptureEnabled),
    thankYouUrl: String(src.thankYouUrl || '').trim(),
    thankYouRedirectDelayMs,
    allowedRedirectHosts: normalizeHosts(src.allowedRedirectHosts),
    supportEmail: String(src.supportEmail || '').trim(),
  };
}

function pickSettingsFromConfig(config, providerName) {
  if (!config || typeof config !== 'object') return null;
  return normalizePortalSettings(config, {
    providerName: providerName || config.providerName || 'our team',
  });
}

module.exports = {
  AVAILABLE_PLATFORMS,
  PLATFORM_IDS,
  emptySettings,
  normalizePortalSettings,
  pickSettingsFromConfig,
};
