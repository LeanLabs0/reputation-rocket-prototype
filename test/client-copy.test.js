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

test('EIM live and demo welcome pages carry the Step 1 notes together', () => {
  const live = fs.readFileSync(path.join(__dirname, '../pages/clients/eimmigration/index.html'), 'utf8');
  const demo = fs.readFileSync(path.join(__dirname, '../pages/clients/eimmigration/demo/index.html'), 'utf8');
  const welcome = (html) => html.slice(html.indexOf('id="screen-welcome"'), html.indexOf('id="screen-chat"'));
  for (const html of [live, demo]) {
    const step1 = welcome(html);
    assert.match(step1, /<p>Please answer a couple of questions about how it's going with our software and team\.<\/p>/);
    assert.match(step1, /publish them on Gartner, G2, and Trustpilot\.<\/p>/);
    assert.match(step1, /<strong>Heads up:<\/strong> The hardest part is logging into the review sites\. We'll walk you through every step\. Once you publish your reviews, we'll send your reward\.<\/p>/);
    assert.match(step1, /id="btn-start"[^>]*>Get Started<svg/);
    assert.equal(step1.includes('welcome-video-host'), false);
    assert.equal(step1.includes('welcome-note'), false);
    assert.equal(step1.includes('Takes about 3 minutes'), false);
    assert.match(step1, /class="progress-shell progress-shell--below-welcome"/);
    const ctaAt = step1.indexOf('class="welcome-cta"');
    const shellAt = step1.indexOf('class="progress-shell progress-shell--below-welcome"');
    assert.equal(ctaAt > -1 && shellAt > ctaAt, true);
  }
  assert.equal(welcome(demo), welcome(live));
  for (const html of [live, demo]) {
    const homeAt = html.indexOf('id="progress-shell-home"');
    const screenAt = html.indexOf('id="screen-welcome"');
    assert.equal(homeAt > -1 && homeAt < screenAt, true);
    assert.equal(html.split('class="progress-shell ').length, 2);
  }
});

test('other client welcome pages keep the top step bar and the video', () => {
  const html = fs.readFileSync(path.join(__dirname, '../pages/clients/lean-labs/index.html'), 'utf8');
  const welcome = html.slice(html.indexOf('id="screen-welcome"'), html.indexOf('id="screen-chat"'));
  assert.equal(html.includes('id="progress-shell-home"'), false);
  assert.equal(welcome.includes('progress-shell'), false);
  assert.equal(welcome.includes('welcome-video-host'), true);
  assert.match(welcome, /id="btn-start"[^>]*>Begin<svg/);
  const shellAt = html.indexOf('class="progress-shell"');
  const screenAt = html.indexOf('id="screen-welcome"');
  assert.equal(shellAt > -1 && shellAt < screenAt, true);
});

test('EIM live and demo configs drop the welcome video and park the step bar', () => {
  for (const rel of ['pages/clients/eimmigration/config.js', 'pages/clients/eimmigration/demo/config.js']) {
    const cfg = loadConfig(rel);
    assert.equal(cfg.progressBelowWelcome, true);
    assert.equal('welcomeVideoUrl' in cfg, false);
    assert.equal('welcomeVideoPoster' in cfg, false);
  }
});

function loadProgressShell(config, { marker = false, shellAfter = 'page' } = {}) {
  const moves = [];
  const classes = {};
  const TEXT = 3;
  const ELEMENT = 1;
  const COMMENT = 8;

  function link(parent, children) {
    parent.childNodes = children;
    children.forEach((node, i) => {
      node.parentNode = parent;
      node.previousSibling = children[i - 1] || null;
      node.nextSibling = children[i + 1] || null;
    });
  }

  function after(anchor, node) {
    const parent = anchor.parentNode;
    const kids = parent.childNodes.filter((child) => child !== node);
    const at = kids.indexOf(anchor);
    kids.splice(at + 1, 0, node);
    link(parent, kids);
    moves.push(anchor.label);
  }

  const page = { label: 'page' };
  const welcome = { label: 'welcome' };
  const shell = {
    label: 'shell',
    nodeType: ELEMENT,
    classList: { toggle: (name, on) => { classes[name] = on; } },
  };
  shell.before = (node) => {
    const kids = page.childNodes.filter((child) => child !== node);
    const at = kids.indexOf(shell);
    kids.splice(at, 0, node);
    link(page, kids);
    moves.push('marked ' + node.label);
  };
  const cta = { label: 'cta', nodeType: ELEMENT, after(node) { after(cta, node); } };
  const home = {
    label: 'home',
    nodeType: ELEMENT,
    id: 'progress-shell-home',
    after(node) { after(home, node); },
  };
  const gap = { label: 'gap', nodeType: TEXT, textContent: '\n    ' };

  if (shellAfter === 'cta') link(welcome, [cta, gap, shell]);
  else link(welcome, [cta]);
  link(page, marker ? [home] : []);
  if (shellAfter !== 'cta') link(page, page.childNodes.concat([shell]));

  const sandbox = {
    CLIENT_CONFIG: config,
    progressShellHome: null,
    $: (sel) => ({ '.progress-shell': shell, '#screen-welcome .welcome-cta': cta })[sel] || null,
    document: {
      getElementById: (id) => (marker && id === 'progress-shell-home' ? home : null),
      createComment(label) {
        const comment = { label, nodeType: COMMENT, textContent: label };
        comment.after = (node) => after(comment, node);
        return comment;
      },
    },
  };

  vm.runInNewContext(
    extractFunction('isProgressBelowWelcome')
      + extractFunction('isParkedAfter')
      + extractFunction('placeProgressShell'),
    sandbox
  );
  return { place: sandbox.placeProgressShell, moves, classes, shell, home, page, welcome };
}

test('placeProgressShell keeps a bar that already sits under the welcome button', () => {
  const { place, moves, classes, shell, welcome } = loadProgressShell(
    { progressBelowWelcome: true },
    { marker: true, shellAfter: 'cta' }
  );
  place('welcome');
  assert.deepEqual(moves, []);
  assert.equal(classes['progress-shell--below-welcome'], true);
  assert.equal(shell.parentNode, welcome);
  place('chat');
  assert.deepEqual(moves, ['home']);
  assert.equal(classes['progress-shell--below-welcome'], false);
  assert.equal(shell.previousSibling.label, 'home');
  place('welcome');
  assert.deepEqual(moves, ['home', 'cta']);
  assert.equal(shell.parentNode, welcome);
  assert.equal(classes['progress-shell--below-welcome'], true);
});

test('placeProgressShell marks home once when the page has no marker', () => {
  const { place, moves, classes, shell } = loadProgressShell({ progressBelowWelcome: true });
  place('welcome');
  assert.deepEqual(moves, ['marked  progress-shell home ', 'cta']);
  assert.equal(classes['progress-shell--below-welcome'], true);
  assert.equal(shell.previousSibling.label, 'cta');
  place('chat');
  assert.equal(moves.at(-1), ' progress-shell home ');
  assert.equal(classes['progress-shell--below-welcome'], false);
  place('welcome');
  assert.equal(moves.filter((move) => String(move).startsWith('marked')).length, 1);
});

test('placeProgressShell leaves the step bar alone for other clients', () => {
  const { place, moves, classes, shell, page } = loadProgressShell({});
  place('welcome');
  place('chat');
  assert.deepEqual(moves, []);
  assert.deepEqual(classes, {});
  assert.equal(shell.parentNode, page);
});

test('guestBarAnchor prefers the home spot over the step bar itself', () => {
  const home = { id: 'home' };
  const marker = { id: 'marker' };
  const shell = { id: 'shell' };
  const source = extractFunction('guestBarAnchor');
  const withHome = { progressShellHome: home, document: { getElementById() { return marker; }, querySelector() { return shell; } } };
  vm.runInNewContext(source, withHome);
  assert.equal(withHome.guestBarAnchor(), home);
  const withMarker = { progressShellHome: null, document: { getElementById(id) { return id === 'progress-shell-home' ? marker : null; }, querySelector() { return shell; } } };
  vm.runInNewContext(source, withMarker);
  assert.equal(withMarker.guestBarAnchor(), marker);
  const withShell = { progressShellHome: null, document: { getElementById() { return null; }, querySelector() { return shell; } } };
  vm.runInNewContext(source, withShell);
  assert.equal(withShell.guestBarAnchor(), shell);
});

test('portal save keeps the step-bar flag and does not add it to other clients', () => {
  const { preserveOptInClientConfig } = require('../lib/client-config-file');
  const kept = preserveOptInClientConfig(
    { progressBelowWelcome: true, ratingButtons: true, murkyMiddle: true },
    { platforms: ['g2'] }
  );
  assert.equal(kept.progressBelowWelcome, true);
  assert.equal(kept.ratingButtons, true);
  assert.equal(kept.murkyMiddle, true);
  assert.deepEqual(kept.platforms, ['g2']);

  const plain = preserveOptInClientConfig({ providerName: 'Acme', progressBelowWelcome: false }, { platforms: ['g2'] });
  assert.equal('progressBelowWelcome' in plain, false);
  assert.equal('ratingButtons' in plain, false);
});
