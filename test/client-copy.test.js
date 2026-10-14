const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unclosed ${name}`);
  return src.slice(start, end + 2);
}

function load(name, config) {
  const sandbox = { CLIENT_CONFIG: config };
  vm.runInNewContext(extractFunction(name), sandbox);
  return sandbox[name];
}

function loadConfig(rel) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), sandbox);
  return sandbox.window.CLIENT_CONFIG;
}

test('clientCopy keeps the shared default when a client sets nothing', () => {
  const clientCopy = load('clientCopy', {});
  assert.equal(clientCopy('pasteCardHint', { platform: 'Trustpilot' }, 'default'), 'default');
});

test('clientCopy fills its own placeholders and allows an empty override', () => {
  const clientCopy = load('clientCopy', { copy: { hint: 'Free {platform} account, {missing}', off: '' } });
  assert.equal(clientCopy('hint', { platform: 'G2' }, 'x'), 'Free G2 account, {missing}');
  assert.equal(clientCopy('off', null, 'x'), '');
});

test('clientCopy does not fill inherited names or null values', () => {
  const clientCopy = load('clientCopy', { copy: { hint: 'Hello {toString} {provider} {missing}' } });
  assert.equal(
    clientCopy('hint', { provider: 'eimmigration', missing: null }, 'x'),
    'Hello {toString} eimmigration {missing}'
  );
});

test('clientCopy survives a page with no client config', () => {
  const sandbox = {};
  vm.runInNewContext(extractFunction('clientCopy'), sandbox);
  assert.equal(sandbox.clientCopy('hint', { provider: 'G2' }, 'default'), 'default');
});

test('clientCardHint reads the matching site and ignores inherited names', () => {
  const clientCardHint = load('clientCardHint', { copy: { cardHints: { g2: 'Two minutes' } } });
  assert.equal(clientCardHint('g2', 'default'), 'Two minutes');
  assert.equal(clientCardHint('trustpilot', 'default'), 'default');
  assert.equal(clientCardHint('toString', 'default'), 'default');
  assert.equal(clientCardHint('constructor', 'default'), 'default');
});

test('EIM live and demo configs carry the same copy overrides', () => {
  const live = loadConfig('pages/clients/eimmigration/config.js');
  const demo = loadConfig('pages/clients/eimmigration/demo/config.js');
  assert.match(live.copy.draftsReadyMessage, /^Thanks so much for sharing\.\n\nWe turned /);
  assert.equal(live.copy.draftsReadyLink, 'Read the drafts.');
  assert.equal(live.copy.postFinishHint, '');
  assert.equal(live.copy.postNudgeProgress.includes('{'), false);
  assert.deepEqual(Object.keys(live.copy.cardHints).sort(), [...live.platforms].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(demo.copy)), JSON.parse(JSON.stringify(live.copy)));
});

test('EIM live and demo pages drop the removed help boxes together', () => {
  const live = fs.readFileSync(path.join(__dirname, '../pages/clients/eimmigration/index.html'), 'utf8');
  const demo = fs.readFileSync(path.join(__dirname, '../pages/clients/eimmigration/demo/index.html'), 'utf8');
  for (const html of [live, demo]) {
    assert.equal(html.includes('draft-what-next'), false);
    assert.equal(html.includes('post-why-confirm'), false);
    assert.equal(html.includes('Sessions Completed'), false);
    assert.equal(html.includes('id="stat-reviews"'), false);
    assert.equal(html.includes('id="btn-view-draft"'), false);
    assert.equal(html.includes('btn btn-tertiary btn-md'), true);
    assert.equal(html.includes('aria-hidden="true"'), true);
    assert.match(html, /id="btn-approve"[^>]*>Looks Good<svg[^>]*aria-hidden="true"/);
  }
});
