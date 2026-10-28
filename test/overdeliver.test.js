const test = require('node:test');
const assert = require('node:assert/strict');
const { listOverdeliverPages } = require('../lib/overdeliver-catalog');
const { resolvePublicFile } = require('../lib/page-paths');
const login = require('../api/overdeliver/login');
const catalog = require('../api/overdeliver/catalog');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('overdeliver catalog lists every client page and demo', () => {
  const pages = listOverdeliverPages();
  const alitek = pages.find((client) => client.slug === 'alitek');
  assert.ok(alitek);
  assert.equal(alitek.name, 'Alitek');
  assert.equal(alitek.liveUrl, '/alitek/');
  assert.equal(alitek.demoUrl, '/alitek/demo/');
  assert.equal(alitek.logoUrl, '/alitek/logo.png');
  assert.equal(pages.find((client) => client.slug === 'lean-labs').logoUrl, '/lean-labs/logo.svg');
  assert.ok(pages.every((client) => client.logoUrl));
  for (const slug of ['lean-labs', 'eimmigration', 'propertyradar', 'greentec', 'fatherhood']) {
    const client = pages.find((entry) => entry.slug === slug);
    assert.ok(client, slug);
    assert.equal(client.liveUrl, `/${slug}/`);
    assert.equal(client.demoUrl, `/${slug}/demo/`);
  }
});

test('client directory files resolve on /clients', () => {
  assert.match(resolvePublicFile('/alitek/demo/'), /alitek[\\/]demo[\\/]index\.html$/);
  assert.match(resolvePublicFile('/clients/'), /client-directory[\\/]index\.html$/);
  assert.match(resolvePublicFile('/clients/clients.css'), /clients\.css$/);
});

test('the clients page password is overdeliver unless overridden', async () => {
  const previous = process.env.OVERDELIVER_PASSWORD;
  delete process.env.OVERDELIVER_PASSWORD;
  try {
    const good = mockRes();
    await login({ method: 'POST', body: { password: 'overdeliver' } }, good);
    assert.equal(good.statusCode, 200);
    assert.match(good.headers['Set-Cookie'], /rr_clients_session=/);
  } finally {
    if (previous == null) delete process.env.OVERDELIVER_PASSWORD;
    else process.env.OVERDELIVER_PASSWORD = previous;
  }
});

test('overdeliver stays locked until the password matches', async () => {
  const previous = process.env.OVERDELIVER_PASSWORD;
  process.env.OVERDELIVER_PASSWORD = 'test-overdeliver-secret';
  try {
    const bad = mockRes();
    await login({ method: 'POST', body: { password: 'nope' } }, bad);
    assert.equal(bad.statusCode, 401);

    const locked = mockRes();
    await catalog({ method: 'GET', headers: {} }, locked);
    assert.equal(locked.statusCode, 401);

    const good = mockRes();
    await login({ method: 'POST', body: { password: 'test-overdeliver-secret' } }, good);
    assert.equal(good.statusCode, 200);
    const cookie = good.headers['Set-Cookie'];

    const open = mockRes();
    await catalog({ method: 'GET', headers: { cookie } }, open);
    assert.equal(open.statusCode, 200);
    assert.ok(open.body.clients.some((client) => client.slug === 'alitek' && client.demoUrl));
  } finally {
    if (previous == null) delete process.env.OVERDELIVER_PASSWORD;
    else process.env.OVERDELIVER_PASSWORD = previous;
  }
});
