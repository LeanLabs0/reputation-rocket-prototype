const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const CLIENTS_DIR = path.join(PAGES_DIR, 'clients');
const HOME_DIR = path.join(PAGES_DIR, 'home');
const CONFIGURE_DIR = path.join(PAGES_DIR, 'configure');
const TEMPLATE_SLUG = 'propertyradar';

/** Public URL prefixes that must never be treated as client slugs. */
const PUBLIC_RESERVED = new Set([
  'api',
  'assets',
  'configure',
  'demo',
  'eim-demo',
  'pr-demo',
  'lib',
  'node_modules',
  'pages',
  'reprocket-configure',
  'data',
]);

function clientDir(slug) {
  return path.join(CLIENTS_DIR, String(slug || ''));
}

function templateDir() {
  return clientDir(TEMPLATE_SLUG);
}

function listClientSlugs() {
  if (!fs.existsSync(CLIENTS_DIR)) return [];
  return fs
    .readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.startsWith('.'));
}

function isClientSlug(slug) {
  if (!slug || PUBLIC_RESERVED.has(slug)) return false;
  return fs.existsSync(clientDir(slug));
}

/**
 * Map a public URL pathname to a file under the repo (or null if unmapped).
 * Keeps live URLs like /lean-labs/ while files live under pages/clients/.
 */
function resolvePublicFile(pathname) {
  let clean = decodeURIComponent(String(pathname || '/'));
  if (!clean.startsWith('/')) clean = `/${clean}`;

  if (clean === '/home.css') {
    return path.join(HOME_DIR, 'home.css');
  }

  if (clean === '/' || clean === '/index.html') {
    return path.join(HOME_DIR, 'index.html');
  }

  if (clean === '/configure' || clean === '/configure/') {
    return path.join(CONFIGURE_DIR, 'index.html');
  }
  if (clean.startsWith('/configure/')) {
    const rest = clean.slice('/configure/'.length) || 'index.html';
    const target = path.normalize(path.join(CONFIGURE_DIR, rest));
    if (!target.startsWith(CONFIGURE_DIR)) return null;
    return target;
  }

  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return path.join(HOME_DIR, 'index.html');

  const slug = parts[0];
  if (!isClientSlug(slug)) return null;

  let rest = parts.slice(1).join('/') || 'index.html';
  if (rest.endsWith('/')) rest = `${rest}index.html`;
  let target = path.normalize(path.join(clientDir(slug), rest));
  if (!target.startsWith(clientDir(slug))) return null;
  // Directory URL → index.html
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
  } catch (_) { /* ignore */ }
  return target;
}

/**
 * Rewrites so Vercel serves pages/* behind the original public URLs.
 */
function buildClientRewrites(slugs = listClientSlugs()) {
  const rewrites = [
    { source: '/', destination: '/pages/home/' },
    { source: '/home.css', destination: '/pages/home/home.css' },
    { source: '/configure', destination: '/pages/configure/' },
    { source: '/configure/', destination: '/pages/configure/' },
    { source: '/configure/:path*', destination: '/pages/configure/:path*' },
  ];

  for (const slug of slugs) {
    rewrites.push(
      { source: `/${slug}`, destination: `/pages/clients/${slug}/` },
      { source: `/${slug}/`, destination: `/pages/clients/${slug}/` },
      { source: `/${slug}/:path*`, destination: `/pages/clients/${slug}/:path*` },
    );
  }

  return rewrites;
}

function buildNetlifyRedirectLines(slugs = listClientSlugs()) {
  const lines = [
    '/  /pages/home/  200',
    '/home.css  /pages/home/home.css  200',
    '/configure  /pages/configure/  200',
    '/configure/  /pages/configure/  200',
    '/configure/*  /pages/configure/:splat  200',
  ];
  for (const slug of slugs) {
    lines.push(`/${slug}  /pages/clients/${slug}/  200`);
    lines.push(`/${slug}/  /pages/clients/${slug}/  200`);
    lines.push(`/${slug}/*  /pages/clients/${slug}/:splat  200`);
  }
  return lines;
}

module.exports = {
  ROOT,
  PAGES_DIR,
  CLIENTS_DIR,
  HOME_DIR,
  CONFIGURE_DIR,
  TEMPLATE_SLUG,
  PUBLIC_RESERVED,
  clientDir,
  templateDir,
  listClientSlugs,
  isClientSlug,
  resolvePublicFile,
  buildClientRewrites,
  buildNetlifyRedirectLines,
};
