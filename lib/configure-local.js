/**
 * Configure (/configure + /api/configure/*) is intentionally local-dev only.
 * Production portals use committed config.js + optional HUBSPOT_FILES_ACCESS_TOKEN_*.
 */

function isConfigureLocalAllowed() {
  return !process.env.VERCEL;
}

function requireConfigureLocal(req, res) {
  if (isConfigureLocalAllowed()) return true;
  res.status(404).json({
    error: 'Not found',
    detail: 'Configure is local-only. Run npm run dev and open http://localhost:8888/configure/',
  });
  return false;
}

module.exports = {
  isConfigureLocalAllowed,
  requireConfigureLocal,
};
