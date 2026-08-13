const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'propertyradar');

const RESERVED_SLUGS = new Set([
  'api',
  'configure',
  'demo',
  'lib',
  'node_modules',
  'reprocket-configure',
  'data',
  '.data',
  '.cursor',
  '.git',
]);

function sanitizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isSafeSlug(slug) {
  if (!slug || slug.length < 2 || slug.length > 48) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
  return true;
}

function clientDir(slug) {
  return path.join(ROOT, slug);
}

function folderExists(slug) {
  return fs.existsSync(clientDir(slug));
}

function scaffoldClientFolder({ clientSlug, providerName, supportEmail = '' }) {
  const slug = sanitizeSlug(clientSlug);
  if (!isSafeSlug(slug)) {
    throw new Error('Invalid client slug. Use lowercase letters, numbers, and hyphens.');
  }
  if (folderExists(slug)) {
    throw new Error(`Folder already exists: ${slug}/`);
  }
  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new Error('Template folder propertyradar/ is missing.');
  }

  const dest = clientDir(slug);
  fs.mkdirSync(dest, { recursive: true });

  // Copy HTML shell from propertyradar and retitle.
  const html = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8')
    .replace(/PropertyRadar/g, providerName)
    .replace(/propertyradar/g, slug)
    .replace(/src="logo\.png"/, 'src="../reprocket-icon.svg"');
  fs.writeFileSync(path.join(dest, 'index.html'), html, 'utf8');

  // Minimal brand CSS (operator can theme later).
  const styles = fs.existsSync(path.join(TEMPLATE_DIR, 'styles.css'))
    ? fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8')
    : '/* Add brand tokens here */\n';
  fs.writeFileSync(path.join(dest, 'styles.css'), styles, 'utf8');

  if (fs.existsSync(path.join(TEMPLATE_DIR, 'gradient-bg.svg'))) {
    fs.copyFileSync(
      path.join(TEMPLATE_DIR, 'gradient-bg.svg'),
      path.join(dest, 'gradient-bg.svg'),
    );
  }

  const config = `window.CLIENT_CONFIG = {
  clientSlug: ${JSON.stringify(slug)},
  providerName: ${JSON.stringify(providerName)},
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['g2', 'trustpilot'],
  reviewLinks: {
    g2: '',
    trustpilot: '',
  },
  welcomeVideoUrl: '',
  welcomeVideoPoster: '',
  interviewQuestions: [
    'Why did you choose ${providerName.replace(/'/g, "\\'")}?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: false,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 120000,
  allowedRedirectHosts: [],
  supportEmail: ${JSON.stringify(supportEmail || '')},
  hubspotPortalId: '',
  hubspotFormId: '',
  hubspotFormRegion: 'na1',
  hubspotCompleteProperty: 'rr_iscomplete',
  hubspotCompleteValue: 'Yes',
  hubspotOutcomeProperty: 'rr_outcome',
  hubspotOutcomePositiveValue: 'positive',
  hubspotOutcomeNegativeValue: 'negative',
};
`;
  fs.writeFileSync(path.join(dest, 'config.js'), config, 'utf8');

  ensureRedirects(slug);

  return {
    clientSlug: slug,
    providerName,
    portalPath: `/${slug}/`,
    folder: `${slug}/`,
  };
}

function ensureRedirects(slug) {
  const vercelPath = path.join(ROOT, 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
    if (!Array.isArray(vercel.redirects)) vercel.redirects = [];
    const source = `/${slug}`;
    const exists = vercel.redirects.some((r) => r.source === source);
    if (!exists) {
      vercel.redirects.push({
        source,
        destination: `/${slug}/`,
        permanent: true,
      });
      fs.writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`, 'utf8');
    }
  }

  const redirectsPath = path.join(ROOT, '_redirects');
  if (fs.existsSync(redirectsPath)) {
    let text = fs.readFileSync(redirectsPath, 'utf8');
    const line = `/${slug}  /${slug}/  308`;
    if (!text.includes(`/${slug}  /${slug}/`)) {
      if (!text.endsWith('\n')) text += '\n';
      text += `${line}\n`;
      fs.writeFileSync(redirectsPath, text, 'utf8');
    }
  }
}

/**
 * Patch hubspot IDs into an existing client config.js after OAuth provision.
 * Pass empty strings to clear portalId/formId.
 * Local-only: Vercel’s /var/task FS is read-only — HubSpot IDs live in KV store there.
 */
function patchClientHubSpotConfig(clientSlug, { portalId, formId, formRegion } = {}) {
  if (process.env.VERCEL) return false;
  const file = path.join(clientDir(clientSlug), 'config.js');
  if (!fs.existsSync(file)) return false;
  try {
    let src = fs.readFileSync(file, 'utf8');
    const set = (key, value) => {
      const re = new RegExp(`(${key}\\s*:\\s*)(['\`"])(.*?)\\2`);
      if (re.test(src)) {
        src = src.replace(re, `$1'${String(value).replace(/'/g, "\\'")}'`);
      } else {
        src = src.replace(
          /hubspotFormRegion:\s*'[^']*'/,
          (m) => `${m},\n  ${key}: '${String(value).replace(/'/g, "\\'")}'`,
        );
      }
    };
    if (portalId !== undefined) set('hubspotPortalId', portalId);
    if (formId !== undefined) set('hubspotFormId', formId);
    if (formRegion !== undefined) set('hubspotFormRegion', formRegion);
    fs.writeFileSync(file, src, 'utf8');
    return true;
  } catch (err) {
    console.warn('[scaffold-client] config.js patch skipped:', err.message);
    return false;
  }
}

function removeRedirects(slug) {
  const vercelPath = path.join(ROOT, 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    try {
      const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
      if (Array.isArray(vercel.redirects)) {
        const before = vercel.redirects.length;
        vercel.redirects = vercel.redirects.filter(
          (r) => r.source !== `/${slug}` && r.destination !== `/${slug}/`,
        );
        if (vercel.redirects.length !== before) {
          fs.writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`, 'utf8');
        }
      }
    } catch (_) { /* ignore */ }
  }

  const redirectsPath = path.join(ROOT, '_redirects');
  if (fs.existsSync(redirectsPath)) {
    const text = fs.readFileSync(redirectsPath, 'utf8');
    const next = text
      .split(/\r?\n/)
      .filter((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return true;
        return !(t.startsWith(`/${slug} `) || t.startsWith(`/${slug}\t`));
      })
      .join('\n');
    if (next !== text) {
      fs.writeFileSync(redirectsPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
    }
  }
}

function removeClientFolder(slug) {
  const safe = sanitizeSlug(slug);
  if (!isSafeSlug(safe)) {
    throw new Error('Invalid client slug');
  }
  const dest = clientDir(safe);
  if (!fs.existsSync(dest)) return false;
  fs.rmSync(dest, { recursive: true, force: true });
  removeRedirects(safe);
  return true;
}

module.exports = {
  sanitizeSlug,
  isSafeSlug,
  folderExists,
  scaffoldClientFolder,
  ensureRedirects,
  removeRedirects,
  removeClientFolder,
  patchClientHubSpotConfig,
  ROOT,
};
