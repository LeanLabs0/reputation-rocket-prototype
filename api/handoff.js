const { getHandoff, claimHandoff, saveHandoff } = require('../lib/handoff-store');

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }
  return {};
}

function statusFor(err) {
  if (err.code === 'HANDED_OFF') return 409;
  if (err.code === 'NOT_FOUND' || err.code === 'SLUG_MISMATCH') return 404;
  if (err.code === 'BAD_TOKEN' || err.code === 'BAD_SNAPSHOT') return 400;
  if (err.code === 'NO_STORE') return 503;
  return 500;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const token = String(req.query?.token || '').trim();
      const clientSlug = String(req.query?.clientSlug || '').trim();
      const claim = String(req.query?.claim || '') === '1';
      if (!token || !clientSlug) {
        return res.status(400).json({ error: 'token and clientSlug are required' });
      }

      const record = claim
        ? await claimHandoff(token, clientSlug)
        : await getHandoff(token, clientSlug);
      if (!record) return res.status(404).json({ error: 'Handoff not found' });

      if (claim) {
        return res.status(200).json({
          ok: true,
          claimed: true,
          expiresAt: record.expiresAt,
          snapshot: record.snapshot,
        });
      }

      return res.status(200).json({
        ok: true,
        claimed: Boolean(record.claimedAt),
        expiresAt: record.expiresAt,
        currentState: record.snapshot?.currentState || 'welcome',
      });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let body;
      try {
        body = readBody(req);
      } catch (_) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }

      const token = String(body.token || '').trim();
      const clientSlug = String(body.clientSlug || '').trim();
      const role = body.role === 'guest' || body.role === 'client' ? body.role : '';
      if (!token || !clientSlug || !role) {
        return res.status(400).json({ error: 'token, clientSlug, and role are required' });
      }

      const record = await saveHandoff({
        token,
        clientSlug,
        role,
        snapshot: body.snapshot,
      });
      return res.status(200).json({
        ok: true,
        claimed: Boolean(record.claimedAt),
        expiresAt: record.expiresAt,
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = statusFor(err);
    if (status === 500) console.error('[handoff]', err);
    return res.status(status).json({
      error: status === 409 ? 'handed_off' : (err.message || 'Handoff request failed'),
      claimed: status === 409 ? true : undefined,
    });
  }
};
