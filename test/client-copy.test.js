const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = src.indexOf('function clientCopy(');
const body = src.slice(start, src.indexOf('\n}\n', start) + 2);

function load(config) {
  const sandbox = { CLIENT_CONFIG: config };
  vm.runInNewContext(body, sandbox);
  return sandbox.clientCopy;
}

function loadConfig(rel) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), sandbox);
  return sandbox.window.CLIENT_CONFIG;
}

test('clientCopy keeps the shared default when a client sets nothing', () => {
  const clientCopy = load({});
  assert.equal(clientCopy('pasteCardHint', { platform: 'Trustpilot' }, 'default'), 'default');
});

test('clientCopy fills placeholders and allows an empty override', () => {
  const clientCopy = load({ copy: { hint: 'Free {platform} account, {missing}', off: '' } });
  assert.equal(clientCopy('hint', { platform: 'G2' }, 'x'), 'Free G2 account, {missing}');
  assert.equal(clientCopy('off', null, 'x'), '');
});

test('EIM live and demo configs carry the same copy overrides', () => {
  const live = loadConfig('pages/clients/eimmigration/config.js');
  const demo = loadConfig('pages/clients/eimmigration/demo/config.js');
  assert.ok(live.copy.draftsReadyMessage);
  assert.deepEqual(Object.keys(live.copy.cardHints).sort(), [...live.platforms].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(demo.copy)), JSON.parse(JSON.stringify(live.copy)));
});
