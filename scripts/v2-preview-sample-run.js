#!/usr/bin/env node
/*
 * Sample run for the V2 previews: clicks through both brands in a headless
 * browser, checks nothing calls the server API, checks the drafts carry the
 * sample customer's picks and saves screenshots to docs/v2-preview/.
 *
 *   NODE_PATH="$(npm root -g)" node scripts/v2-preview-sample-run.js
 *   BASE_URL=https://stage.reputationrocket.ai NODE_PATH="$(npm root -g)" node scripts/v2-preview-sample-run.js
 *
 * Not under test/ on purpose: `node --test` would pick it up.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/v2-preview');
const PORT = process.env.PORT || '8899';
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const LAUNCH_ARGS = process.env.CHROMIUM_ARGS ? process.env.CHROMIUM_ARGS.split(' ') : [];

const BRANDS = {
  eimmigration: { expect: ['immigration case management', 'nonprofit', 'spreadsheets'], openDrafts: '.chat-draft-inline__link' },
  'lean-labs': { expect: ['AEO website for HubSpot', 'industrial company', 'another agency'], openDrafts: '#btn-view-draft' },
};

function startServer() {
  if (process.env.BASE_URL) return null;
  const child = spawn(process.execPath, ['local-dev-server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/pages/previews/v2/`);
      if (res.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${BASE} did not start`);
}

function guard(page, log) {
  const allowed = new Set([new URL(BASE).host, 'fonts.googleapis.com', 'fonts.gstatic.com']);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol === 'data:') return;
    log.push({ url: req.url(), method: req.method(), type: req.resourceType(), host: u.host });
    if (u.pathname.startsWith('/api/')) log.apiHits = (log.apiHits || 0) + 1;
    if (!allowed.has(u.host)) log.offHost = (log.offHost || []).concat(u.host);
  });
}

async function visible(page, sel) {
  const el = await page.$(sel);
  return el ? el.isVisible() : false;
}

// Answers every step with the sample customer, the way a reviewer would by clicking.
async function playChat(page, brand) {
  await page.click('#btn-start');
  for (let guardCount = 0; guardCount < 60; guardCount += 1) {
    await page.waitForTimeout(150);
    if (await visible(page, '#chat-draft-inline') || await visible(page, '#chat-draft-prompt.visible')) return;
    if (await visible(page, '#chat-choice-bar .v2-sample-btn')) { await page.click('#chat-choice-bar .v2-sample-btn'); continue; }
    if (await visible(page, '#chat-choice-bar .rating-choice[data-rating="5"]')) { await page.click('#chat-choice-bar .rating-choice[data-rating="5"]'); continue; }
    if (await visible(page, '.v2-text-tools .v2-sample-btn')) {
      await page.click('.v2-text-tools .v2-sample-btn');
      await page.click('#chat-send');
      continue;
    }
    if (await visible(page, '.v2-text-tools .btn')) { await page.click('.v2-text-tools .btn'); continue; }
  }
  throw new Error(`${brand}: chat never reached the drafts`);
}

// Screens fade in over 0.4s; let them settle, and keep the chat in view.
async function shot(page, name, full, focus) {
  await page.waitForTimeout(700);
  if (focus) await page.$eval(focus, (n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80, fullPage: Boolean(full) });
}

async function runBrand(browser, slug, viewport, tag) {
  const cfg = BRANDS[slug];
  const context = await browser.newContext({ viewport, deviceScaleFactor: tag === 'phone' ? 2 : 1 });
  const page = await context.newPage();
  const log = [];
  guard(page, log);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/pages/previews/v2/${slug}/?fast=1&seed=7`, { waitUntil: 'networkidle' });
  if (tag === 'desktop') await shot(page, `${slug}-${tag}-01-welcome`);
  await page.click('#btn-start');
  await page.waitForSelector('#chat-choice-bar .v2-chip');
  await shot(page, `${slug}-${tag}-02-services`, false, '#chat-choice-bar');
  // finish the chat from here (the first step is on screen already)
  await page.goto(`${BASE}/pages/previews/v2/${slug}/?fast=1&seed=7`, { waitUntil: 'networkidle' });
  await playChat(page, slug);
  await shot(page, `${slug}-${tag}-03-drafts-ready`, false, slug === 'eimmigration' ? '#chat-draft-inline' : '#chat-draft-prompt');
  await page.click(cfg.openDrafts);
  await page.waitForSelector('#screen-draft.active');
  const draftText = await page.$eval('#draft-textarea', (t) => t.value);
  await shot(page, `${slug}-${tag}-04-draft`);

  await page.click('#btn-approve-all');
  await page.waitForSelector('#screen-compare.active');
  const totals = await page.$$eval('.v2-score-total', (n) => n.map((x) => x.textContent));
  const v2Text = await page.$eval('.v2-draft-text', (n) => n.textContent);
  await shot(page, `${slug}-${tag}-05-compare`, true);

  const allDrafts = await page.evaluate(() => document.querySelector('.v2-draft-text').textContent);
  await context.close();

  assert.equal(log.apiHits || 0, 0, `${slug}: called the server API`);
  assert.deepEqual(log.offHost || [], [], `${slug}: loaded from other hosts`);
  assert.ok(log.every((r) => r.method === 'GET'), `${slug}: sent a non-GET request`);
  assert.ok(!log.some((r) => ['fetch', 'xhr', 'websocket', 'eventsource', 'ping'].includes(r.type)), `${slug}: made a data request`);
  assert.deepEqual(errors, [], `${slug}: page errors ${errors.join('; ')}`);
  assert.equal(totals[0], '0 of 3', `${slug}: V1 score`);
  assert.equal(totals[totals.length - 1], '3 of 3', `${slug}: V2 score`);
  cfg.expect.forEach((phrase) => assert.ok(v2Text.toLowerCase().includes(phrase.toLowerCase()), `${slug}: compare draft is missing "${phrase}"`));
  return { slug, tag, requests: log.length, draftWords: draftText.split(/\s+/).length, totals, sample: allDrafts.slice(0, 80) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = startServer();
  try {
    await waitForServer();
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    const results = [];
    for (const [tag, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      for (const slug of Object.keys(BRANDS)) results.push(await runBrand(browser, slug, viewport, tag));
    }
    const hub = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await hub.goto(`${BASE}/pages/previews/v2/`, { waitUntil: 'networkidle' });
    await shot(hub, 'hub-desktop', true);
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
    console.log('V2 preview sample run passed');
  } finally {
    if (server) server.kill();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
