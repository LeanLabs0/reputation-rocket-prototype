const fs = require('fs');
const path = require('path');
const { clientDir, listClientSlugs } = require('./page-paths');

function readProviderName(slug) {
  try {
    const source = fs.readFileSync(path.join(clientDir(slug), 'config.js'), 'utf8');
    const match = source.match(/providerName:\s*['"]([^'"]+)['"]/);
    if (match) return match[1];
  } catch (_) { /* missing config */ }
  return slug;
}

function readLogoUrl(slug, dir) {
  const file = ['logo.svg', 'logo.png', 'logo.webp', 'logo.jpg'].find((name) => (
    fs.existsSync(path.join(dir, name))
  ));
  return file ? `/${slug}/${file}` : null;
}

function listOverdeliverPages() {
  return listClientSlugs()
    .map((slug) => {
      const dir = clientDir(slug);
      const live = fs.existsSync(path.join(dir, 'index.html'));
      const demo = fs.existsSync(path.join(dir, 'demo', 'index.html'));
      return {
        slug,
        name: readProviderName(slug),
        logoUrl: readLogoUrl(slug, dir),
        liveUrl: live ? `/${slug}/` : null,
        demoUrl: demo ? `/${slug}/demo/` : null,
      };
    })
    .filter((client) => client.liveUrl || client.demoUrl)
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { listOverdeliverPages };
