# Reputation Rocket Last-Step UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On the customer Post step, stop the full-screen “Finished?” overlay from covering drafts/Copy while a review popup is open, and add Jonathan’s login/create-account coach popup before the review window opens — without undoing Edward’s already-shipped nudge, popup window, or beforeunload warning.

**Architecture:** Extract Post-step decision helpers into a root-level UMD module (`/post-step-ux.js`) so Node tests can `require` it and the browser can load it before `app.js`. Keep the existing `#review-complete-overlay` for **tab-fallback only**. On the **popup path**, expand the open platform card with Yes / Not yet and leave per-field Copy visible. Inject the login coach modal from JS (same pattern as `ensurePostStayNudge`) so we do not duplicate markup across ten client HTML shells.

**Tech Stack:** Vanilla browser JS (`app.js`), shared `styles.css`, Node 18+ `node:test` (no Jest, no bundler), static client HTML under `pages/clients/*/`. Live reference: https://reputationrocket.ai/eimmigration/

---

## 0. Read this before touching code

You are implementing **RAL-49** for Edward on the customer-facing 5-step review flow in `LeanLabs0/reputation-rocket-prototype`. Kevin wants Tonya + Jonathan green, then Viv ASAP. Bottom-nudge contrast is optional polish **after** the two must-fixes.

### 0.1 What “step 2” and “step 3” mean (do not confuse)

Edward shipped three last-step behaviors (Slack, 2026-09-08). Jonathan’s Loom talks about **those** steps, **not** the app’s Welcome/Chat/Draft/Post/Complete numbers, and **not** SurveyRocket’s “Step 3”.

| Edward # | What it is in code today | Jonathan |
|---|---|---|
| 1 | Bottom-right `#post-stay-nudge` (“Wait, did you post yet?”) | Likes this warning modal. Tonya: easy to miss → **nice-to-have later** |
| 2 | `openReviewPlatform()` opens a **mini window** (`popup=yes` + width/height), then `presentReviewCompleteAfterOpen()` | **Confusing.** Wants an intermediary popup: create/log in first. **Continue** then opens this same review window |
| 3 | `beforeunload` via `onBeforeUnloadReviewPost` / `shouldWarnBeforeLeavingReviewPost` | **Good. Do not change the behavior.** |

Tonya’s yellow: users get lost in the **middle copy/paste**. The `#review-complete-overlay` (`role="dialog"` + `aria-modal="true"` + full-viewport backdrop at `z-index: 400`) covers the platform cards. G2/Gartner Copy buttons live **on the card** (`.btn-copy[data-action="copy-section"]`). Users drag the overlay aside to paste. Root cause (verified in current `app.js`): when `window.open` succeeds, `presentReviewCompleteAfterOpen(platform, popup)` **immediately** calls `showReviewCompleteOverlay(platform, { stealFocus: false })`.

### 0.2 Jonathan Loom (must incorporate)

- URL: https://www.loom.com/share/89ae0801b43c48d1a04cb2be4be0cbae
- Title: **Prompting Account Login Before Posting Reviews** (Jonathan Perser, ~61s, chapters `00:00 Helpful pop up idea` / `00:49 Step two confusion resolved`)
- Official Loom description (verbatim enough to implement; the share page did not expose a full caption dump at plan time):

> When someone clicks a helpful pop-up, they are reminded to create an account before posting a review. Show a new pop-up that states the user needs to create an account, or log in if they do not already have one, in order to post their review. Clicking could copy the user’s results and then display the reminder pop-up, allowing them to continue afterward. Step three is confirmed as fine.

**Implement that sequence:**

1. User clicks **Open {platform} review form**.
2. **Paste** platforms (Trustpilot, HubSpot, Google, …): copy the draft to the clipboard first (existing `copyToClipboard` / toast). **Fields** platforms (G2, Gartner): do **not** dump the whole draft; they copy per field later.
3. Show a **coach-only** modal: create or log in on that site to post. No OAuth. No G2/GPI/Trustpilot API.
4. **Continue** closes the coach and runs the **existing** `openReviewPlatform()` popup window.
5. Leave Edward’s beforeunload (step 3) and stay-nudge (step 1) in place.

### 0.3 eimmigration platforms (the live test client)

`pages/clients/eimmigration/config.js`:

- `gartner` → `PLATFORM_META.gartner.flow === 'fields'`
- `g2` → `fields`
- `trustpilot` → `paste`

`#screen-post` has `data-post-layout="rich"` on every current client (including eimmigration). `isRichPostLayout()` is true. Fields cards already render per-field Copy via `mountRichG2UnpostedCard()` + `parseG2Fields()`.

### 0.4 Out of scope (do not touch)

- Factor8 agent / `api/agent.js`
- Client review URLs in `config.js`
- Slack / email notify copy (`api/notify.js`, `test/notify-copy.test.js`)
- OAuth into G2, Gartner Peer Insights, or Trustpilot
- Changing Welcome/Chat/Draft/Video/Complete screens
- Rewriting the non-rich (legacy) card HTML beyond keeping overlay as its confirm UI

### 0.5 Keep Edward’s three shipped fixes (regression-lock with tests)

1. `#post-stay-nudge` still appears on the Post step when platforms are unconfirmed.
2. `openReviewPlatform()` still uses a **window** (`popup=yes` + width/height in the features string), not `target=_blank` as the primary path. Tab `<a target="_blank">` remains **fallback only** when `window.open` returns null.
3. `window` `beforeunload` still fires on Post while any platform is unconfirmed (`shouldWarnBeforeLeavingReviewPost`).

### 0.6 Target UX after this work

```
[Open G2/Gartner/Trustpilot]
        │
        ├─ paste flow: copy draft + toast
        │
        ▼
[Login coach modal]  ← Jonathan. Blocking is OK (cards not needed yet).
  Continue → openReviewPlatform() existing popup
  Not now  → close coach, do not open
        │
        ├─ popup opened (usual desktop)
        │     • DO NOT call showReviewCompleteOverlay
        │     • expand that card: field Copy stays visible
        │     • Yes, I submitted it / Not yet on the card
        │
        └─ popup blocked (mobile / popup blocker)
              • scheduleReviewCompleteOverlay() unchanged
              • on return (or 400ms fallback): existing overlay
```

### 0.7 Skills

- Implement with **@superpowers:executing-plans** (one task, one commit).
- Tests are Node `node:test` + `node:assert/strict`, same as `test/notify-copy.test.js`. There is no Jest, no jsdom, no Playwright job in this repo. Do not add a framework.
- Do not pull in React or @vercel/react-best-practices. This is a static SPA.

---

## 1. Files you will touch

| Path | Why |
|---|---|
| `post-step-ux.js` | **New.** UMD helpers. Browser global `window.RRPostStepUx`. Node `module.exports`. |
| `test/post-step-ux.test.js` | **New.** All unit tests for this feature. |
| `package.json` | `test` → `node --test test/*.test.js`. `check` also syntax-checks `post-step-ux.js`. |
| `app.js` | Wire helpers. Stop overlay on popup path. Card dock. Login coach. Open-click intercept. |
| `styles.css` | Coach modal + card confirm dock. Optional nudge polish last. |
| `pages/clients/*/index.html` and `pages/clients/*/demo/index.html` (10 files) | Add `<script src="/post-step-ux.js"></script>` **before** `/app.js`. |
| `pages/clients/{eimmigration,fatherhood,propertyradar,greentec}/styles.css` | Add `.login-coach-modal__dialog` next to `.review-complete-modal` so branded surfaces match. |
| `HANDOFF.md` | Short “Post step UX (Sep 2026)” note so the next person does not reintroduce the blocking overlay. |

Do **not** edit `pages/clients/lean-labs/styles.css` (almost empty; no modal surface list).

`local-dev-server.js` already serves repo-root files (`/app.js`, `/post-step-ux.js`). No server change.

---

## 2. Conventions the implementer must follow

- **TDD for every helper:** write the failing test → run it → write the minimum code → run all tests → commit.
- **DRY:** one helper module. One coach injector (`ensureLoginCoachModal`), same idea as `ensurePostStayNudge` at `app.js` ~2744. Do not paste coach HTML into ten client shells.
- **YAGNI:** no OAuth, no new session field if `reviewFormOpened` already means “this card was opened”, no new overlay markup, no new npm dependencies.
- Commits: one commit per task below. Do not bunch must-fix + optional nudge in one commit.

Useful local commands:

```bash
npm test
npm run check
npm run dev
# then http://localhost:8888/eimmigration/?name=Tonya+Test&email=tonya@example.com
```

Expected `npm test` after Task 1’s package.json change: both `test/notify-copy.test.js` and `test/post-step-ux.test.js` run. Existing notify tests must stay green.

---

## Task 1: Point `npm test` at every test file

**Files:** `package.json`

### Step 1. Write the change

In `package.json`, change the scripts to:

```json
"check": "node --check app.js && node --check post-step-ux.js && node --check api/agent.js && node --check api/notify.js && node --check api/upload-video.js && node --check api/hubspot-contact.js && node --check api/client-config.js && node --check api/configure/login.js && node --check api/configure/status.js && node --check api/configure/oauth-start.js && node --check api/configure/oauth-callback.js && node --check api/configure/provision.js && node --check api/configure/create-client.js && node --check api/configure/update-settings.js && node --check api/configure/delete-client.js && node --check lib/page-paths.js && node --check lib/scaffold-client.js && node --check lib/portal-settings.js && node --check lib/client-config-file.js && node --check local-dev-server.js",
"test": "node --test test/*.test.js"
```

Keep `post-step-ux.js` in `check` even before the file exists — the next task creates it. **If you prefer not to break `check` for one commit**, add `post-step-ux.js` to `check` in Task 2 Step 3 instead. Either is fine. This plan adds it in Task 2.

For this task, only change `"test"`.

### Step 2. Run tests (must still pass)

```bash
npm test
```

Expected: existing notify tests pass (`# tests 3`, all ok).

### Step 3. Commit

```bash
git add package.json
git commit -m "test: run every file under test/ with node --test"
```

---

## Task 2: `confirmUiAfterOpen` — popup uses card, blocked tab uses overlay

This is the Tonya root-cause helper. `presentReviewCompleteAfterOpen` will call it later.

### Step 1. Write the failing test

Create `test/post-step-ux.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ux = require('../post-step-ux');

test('popup + rich layout confirms on the card, not the blocking overlay', () => {
  assert.equal(
    ux.confirmUiAfterOpen({ popupOpened: true, richLayout: true }),
    'card',
  );
});

test('blocked popup / missing window keeps the return-then-overlay path', () => {
  assert.equal(
    ux.confirmUiAfterOpen({ popupOpened: false, richLayout: true }),
    'overlay',
  );
});

test('non-rich layout keeps the overlay even if a popup opened', () => {
  assert.equal(
    ux.confirmUiAfterOpen({ popupOpened: true, richLayout: false }),
    'overlay',
  );
});
```

### Step 2. Run it — must fail

```bash
node --test test/post-step-ux.test.js
```

Expected: `Cannot find module '../post-step-ux'` (or similar). That is the correct failure.

### Step 3. Minimal implementation

Create `post-step-ux.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.RRPostStepUx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function confirmUiAfterOpen({ popupOpened, richLayout } = {}) {
    if (popupOpened && richLayout) return 'card';
    return 'overlay';
  }

  return { confirmUiAfterOpen };
});
```

Add `node --check post-step-ux.js` to the `check` script in `package.json` (see Task 1).

### Step 4. Run tests — must pass

```bash
npm test
npm run check
```

Expected: notify tests + 3 new tests pass. `check` exits 0.

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js package.json
git commit -m "feat: decide card vs overlay after opening a review site"
```

---

## Task 3: `shouldShowConfirmDock` — when the card shows Yes / Not yet

### Step 1. Append failing tests to `test/post-step-ux.test.js`

```js
test('confirm dock shows only on an opened, unposted rich card', () => {
  assert.equal(
    ux.shouldShowConfirmDock({ formOpened: true, posted: false, richLayout: true }),
    true,
  );
  assert.equal(
    ux.shouldShowConfirmDock({ formOpened: false, posted: false, richLayout: true }),
    false,
  );
  assert.equal(
    ux.shouldShowConfirmDock({ formOpened: true, posted: true, richLayout: true }),
    false,
  );
  assert.equal(
    ux.shouldShowConfirmDock({ formOpened: true, posted: false, richLayout: false }),
    false,
  );
});
```

### Step 2. Run — must fail

```bash
node --test test/post-step-ux.test.js
```

Expected: `TypeError: ux.shouldShowConfirmDock is not a function`

### Step 3. Minimal implementation

Add to the factory return in `post-step-ux.js`:

```js
function shouldShowConfirmDock({ formOpened, posted, richLayout } = {}) {
  return Boolean(richLayout && formOpened && !posted);
}

return { confirmUiAfterOpen, shouldShowConfirmDock };
```

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js
git commit -m "feat: gate the on-card Yes / Not yet dock"
```

---

## Task 4: `shouldCopyDraftBeforeCoach` — paste copies, fields do not

Jonathan: clicking can copy results, then show the reminder. G2/Gartner must **not** copy a concatenated blob (users paste **per field**).

### Step 1. Failing tests

```js
test('paste flows copy the draft before the login coach', () => {
  assert.equal(ux.shouldCopyDraftBeforeCoach('paste'), true);
  assert.equal(ux.shouldCopyDraftBeforeCoach(undefined), true);
});

test('fields flows do not copy the whole draft before the login coach', () => {
  assert.equal(ux.shouldCopyDraftBeforeCoach('fields'), false);
});
```

### Step 2. Run — fail (`shouldCopyDraftBeforeCoach` missing)

### Step 3. Implement

```js
function shouldCopyDraftBeforeCoach(flow) {
  return String(flow || 'paste') !== 'fields';
}
```

Export it.

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js
git commit -m "feat: copy whole draft before coach only on paste flows"
```

---

## Task 5: `loginCoachCopy` — coach-only, per platform family

No OAuth. Copy tells the user to create or log in **on the review site**, then come back to this page to paste.

### Step 1. Failing tests

```js
test('G2 coach mentions LinkedIn or work email and forbids OAuth wording', () => {
  const copy = ux.loginCoachCopy('g2', 'G2');
  assert.match(copy.title, /G2/i);
  assert.match(copy.body, /log in|create/i);
  assert.match(copy.body, /LinkedIn|work email/i);
  assert.match(copy.continueLabel, /Continue to G2/);
  assert.equal(copy.cancelLabel, 'Not now');
  assert.doesNotMatch(copy.body, /OAuth|Sign in with G2|connect your G2/i);
});

test('Gartner coach mentions work email and does not promise we log them in', () => {
  const copy = ux.loginCoachCopy('gartner', 'Gartner');
  assert.match(copy.body, /work email|corporate email/i);
  assert.match(copy.body, /log in|create/i);
  assert.doesNotMatch(copy.body, /we will log you in|OAuth/i);
});

test('Trustpilot coach mentions email or Google', () => {
  const copy = ux.loginCoachCopy('trustpilot', 'Trustpilot');
  assert.match(copy.body, /email|Google/i);
  assert.match(copy.continueLabel, /Continue to Trustpilot/);
});

test('unknown platforms get generic create-or-log-in copy', () => {
  const copy = ux.loginCoachCopy('capterra', 'Capterra');
  assert.match(copy.body, /create an account or log in/i);
  assert.match(copy.continueLabel, /Continue to Capterra/);
});
```

### Step 2. Run — fail

### Step 3. Implement (exact copy — do not invent OAuth)

```js
const LOGIN_COACH_BY_ID = {
  g2: {
    title: 'Log in or create a G2 account first',
    body:
      'G2 will ask you to create an account or log in (usually LinkedIn or a work email) before you can post. Do that on G2, then copy each answer from this page into G2’s form.',
  },
  gartner: {
    title: 'Log in or create a Gartner account first',
    body:
      'Gartner Peer Insights will ask you to create an account or log in (usually a work email, sometimes a verification code) before you can post. Do that on Gartner, then copy each answer from this page into Gartner’s form.',
  },
  trustpilot: {
    title: 'Log in or create a Trustpilot account first',
    body:
      'Trustpilot will ask you to create an account or log in (email or Google) before you can post. Do that on Trustpilot, then paste your review.',
  },
  google: {
    title: 'Log in to Google first',
    body:
      'Google will ask you to be signed in before you can post. Log in or create a Google account on their site, then paste your review.',
  },
  hubspot: {
    title: 'Log in to HubSpot first',
    body:
      'HubSpot will ask you to be signed in (and to have the app installed) before you can post. Log in or create an account on their site, then paste your review.',
  },
};

function loginCoachCopy(platformId, platformName) {
  const id = String(platformId || '').toLowerCase();
  const name = String(platformName || id || 'this review site').trim() || 'this review site';
  const family = LOGIN_COACH_BY_ID[id];
  if (family) {
    return {
      title: family.title,
      body: family.body,
      continueLabel: `Continue to ${name}`,
      cancelLabel: 'Not now',
    };
  }
  return {
    title: `Log in or create a ${name} account first`,
    body: `${name} will ask you to create an account or log in before you can post. Do that on ${name}, then paste your review from this page.`,
    continueLabel: `Continue to ${name}`,
    cancelLabel: 'Not now',
  };
}
```

Export `loginCoachCopy`.

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js
git commit -m "feat: login-coach copy per review-platform family"
```

---

## Task 6: Lock Edward’s beforeunload + popup-window features

Do this **before** changing `app.js` open/overlay code so we cannot accidentally drop his fixes.

### Step 1. Failing tests

```js
test('beforeunload warns only on post with unconfirmed platforms', () => {
  assert.equal(
    ux.shouldWarnBeforeLeaving({
      allowUnload: false,
      state: 'post',
      platforms: ['g2', 'trustpilot'],
      posted: { g2: true },
    }),
    true,
  );
  assert.equal(
    ux.shouldWarnBeforeLeaving({
      allowUnload: false,
      state: 'post',
      platforms: ['g2'],
      posted: { g2: true },
    }),
    false,
  );
  assert.equal(
    ux.shouldWarnBeforeLeaving({
      allowUnload: true,
      state: 'post',
      platforms: ['g2'],
      posted: {},
    }),
    false,
  );
  assert.equal(
    ux.shouldWarnBeforeLeaving({
      allowUnload: false,
      state: 'draft',
      platforms: ['g2'],
      posted: {},
    }),
    false,
  );
});

test('review window features ask the browser for a popup, not a tab', () => {
  const features = ux.buildReviewWindowFeatures({
    availWidth: 1440,
    availHeight: 900,
    screenLeft: 0,
    screenTop: 0,
    outerWidth: 1440,
    outerHeight: 900,
  });
  assert.match(features, /popup=yes/);
  assert.match(features, /width=\d+/);
  assert.match(features, /height=\d+/);
  assert.doesNotMatch(features, /noopener/); // features string is for window.open, not <a rel>
});
```

### Step 2. Run — fail

### Step 3. Implement (mirror current `openReviewPlatform` math)

Copy the width/height/left/top math from `app.js` `openReviewPlatform` (today ~2381–2403) into `buildReviewWindowFeatures`. Return the same comma-joined features string: `popup=yes`, `width`, `height`, `left`, `top`, `scrollbars=yes`, `resizable=yes`.

```js
function shouldWarnBeforeLeaving({ allowUnload, state, platforms, posted } = {}) {
  if (allowUnload) return false;
  if (state !== 'post') return false;
  const list = platforms || [];
  if (!list.length) return false;
  const seen = posted || {};
  return list.some((plat) => !seen[plat]);
}

function buildReviewWindowFeatures({
  availWidth = 1280,
  availHeight = 800,
  screenLeft = 0,
  screenTop = 0,
  outerWidth,
  outerHeight,
} = {}) {
  const width = Math.min(1080, Math.max(760, Math.round(availWidth * 0.7)));
  const height = Math.min(880, Math.max(640, Math.round(availHeight * 0.8)));
  const viewportW = outerWidth || availWidth || width;
  const viewportH = outerHeight || availHeight || height;
  const left = Math.max(0, Math.round(screenLeft + (viewportW - width) / 2));
  const top = Math.max(0, Math.round(screenTop + (viewportH - height) / 2));
  return [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'scrollbars=yes',
    'resizable=yes',
  ].join(',');
}
```

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js
git commit -m "test: lock beforeunload and review-window popup features"
```

---

## Task 7: Load the helper in every client HTML shell

**Files (exact list — all ten):**

- `pages/clients/eimmigration/index.html`
- `pages/clients/eimmigration/demo/index.html`
- `pages/clients/fatherhood/index.html`
- `pages/clients/fatherhood/demo/index.html`
- `pages/clients/propertyradar/index.html`
- `pages/clients/propertyradar/demo/index.html`
- `pages/clients/greentec/index.html`
- `pages/clients/greentec/demo/index.html`
- `pages/clients/lean-labs/index.html`
- `pages/clients/lean-labs/demo/index.html`

### Step 1. Write a failing wiring test

Append to `test/post-step-ux.test.js`:

```js
const fs = require('fs');
const path = require('path');

const CLIENT_HTML = [
  'pages/clients/eimmigration/index.html',
  'pages/clients/eimmigration/demo/index.html',
  'pages/clients/fatherhood/index.html',
  'pages/clients/fatherhood/demo/index.html',
  'pages/clients/propertyradar/index.html',
  'pages/clients/propertyradar/demo/index.html',
  'pages/clients/greentec/index.html',
  'pages/clients/greentec/demo/index.html',
  'pages/clients/lean-labs/index.html',
  'pages/clients/lean-labs/demo/index.html',
];

test('every client shell loads post-step-ux.js before app.js', () => {
  for (const rel of CLIENT_HTML) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const helperAt = html.indexOf('src="/post-step-ux.js"');
    const appAt = html.indexOf('src="/app.js"');
    assert.notEqual(helperAt, -1, `${rel} missing /post-step-ux.js`);
    assert.notEqual(appAt, -1, `${rel} missing /app.js`);
    assert.ok(helperAt < appAt, `${rel} must load helper before app.js`);
  }
});
```

### Step 2. Run — fail (`eimmigration/index.html missing /post-step-ux.js`)

### Step 3. In each file, change the existing pair

From:

```html
<script src="config.js"></script>
<script src="/app.js"></script>
```

To:

```html
<script src="config.js"></script>
<script src="/post-step-ux.js"></script>
<script src="/app.js"></script>
```

`propertyradar` is the scaffold template (`lib/scaffold-client.js` copies its `index.html`). Editing it is enough for **new** clients. Existing clients must be edited by hand (this step).

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add pages/clients test/post-step-ux.test.js
git commit -m "feat: load post-step-ux helper on every client shell"
```

---

## Task 8: `app.js` uses the helpers for overlay vs card + Edward locks

**File:** `app.js`

### Step 1. Write a failing source-contract test

```js
test('app.js calls confirmUiAfterOpen and does not overlay immediately on popup', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(src, /RRPostStepUx\.confirmUiAfterOpen/);
  assert.match(src, /shouldWarnBeforeLeaving/);
  assert.match(src, /buildReviewWindowFeatures/);
  assert.match(src, /popup=yes/);
});
```

The last assert already passes (today’s `openReviewPlatform` inlines `popup=yes`). The first three must fail until you wire the helpers.

### Step 2. Run — fail on `RRPostStepUx.confirmUiAfterOpen`

### Step 3. Minimal `app.js` edits

**A. Guard at the top of the Post-step section** (near `presentReviewCompleteAfterOpen`, ~2365). Add a tiny accessor so a missing script fails loudly:

```js
function postStepUx() {
  const ux = (typeof window !== 'undefined' && window.RRPostStepUx) || {};
  if (typeof ux.confirmUiAfterOpen !== 'function') {
    throw new Error('post-step-ux.js must load before app.js');
  }
  return ux;
}
```

**B. Replace `presentReviewCompleteAfterOpen` (today ~2365–2373) with:**

```js
function presentReviewCompleteAfterOpen(platform, popup) {
  const mode = postStepUx().confirmUiAfterOpen({
    popupOpened: Boolean(popup),
    richLayout: isRichPostLayout(),
  });
  if (mode === 'card') {
    clearPendingReviewOverlay();
    hideReviewCompleteOverlay();
    reviewFormOpened[platform] = true;
    saveSession();
    initPostScreen();
    try { popup.focus(); } catch (_) { /* ignore */ }
    return;
  }
  scheduleReviewCompleteOverlay(platform);
}
```

**C. Replace `shouldWarnBeforeLeavingReviewPost` body (today ~2701–2707) with:**

```js
function shouldWarnBeforeLeavingReviewPost() {
  return postStepUx().shouldWarnBeforeLeaving({
    allowUnload: allowPageUnload,
    state: currentState,
    platforms: PARAMS.platforms || [],
    posted: platformsPosted,
  });
}
```

**D. In `openReviewPlatform` (today ~2384–2403), replace the local `features` array with:**

```js
  const features = postStepUx().buildReviewWindowFeatures({
    availWidth: window.screen?.availWidth || window.innerWidth || 1280,
    availHeight: window.screen?.availHeight || window.innerHeight || 800,
    screenLeft: window.screenLeft ?? window.screenX ?? 0,
    screenTop: window.screenTop ?? window.screenY ?? 0,
    outerWidth: window.outerWidth || window.innerWidth,
    outerHeight: window.outerHeight || window.innerHeight,
  });
```

Do **not** remove the `window.open(url, name, features)` call or the `<a target="_blank">` fallback.

**E. `open-form` handler** (today ~2513–2525) already sets `reviewFormOpened` and calls `presentReviewCompleteAfterOpen`. After step B, `presentReviewCompleteAfterOpen` also sets `reviewFormOpened` on the card path. Leave the handler’s `reviewFormOpened[plat] = true` — it is idempotent and still needed for the overlay path.

### Step 4. `npm test && npm run check` — pass

At this point a popup on eimmigration **no longer shows the blocking overlay**. Cards stay usable. Confirm buttons are **not** on the card yet (next task). Tab-fallback still uses `scheduleReviewCompleteOverlay`.

### Step 5. Commit

```bash
git add app.js test/post-step-ux.test.js
git commit -m "fix: do not block drafts with overlay while review popup is open"
```

---

## Task 9: On-card Yes / Not yet dock (Tonya confirm without a modal)

**Files:** `app.js`, `styles.css`

### Step 1. Failing test for dock HTML helper

Add `confirmDockHtml` to the module (test first):

```js
test('confirm dock HTML has Yes / Not yet and is not a modal', () => {
  const html = ux.confirmDockHtml({ platformId: 'g2', platformName: 'G2' });
  assert.match(html, /data-action="confirm-posted"/);
  assert.match(html, /data-action="confirm-later"/);
  assert.match(html, /data-platform="g2"/);
  assert.match(html, /Yes, I submitted it/);
  assert.match(html, /Not yet/);
  assert.doesNotMatch(html, /aria-modal/);
  assert.doesNotMatch(html, /review-complete-overlay/);
});
```

### Step 2. Run — fail

### Step 3. Implement helper + mount it + CSS

**`post-step-ux.js`:**

```js
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function confirmDockHtml({ platformId, platformName } = {}) {
  const id = escapeHtml(platformId || '');
  const name = escapeHtml(platformName || 'this site');
  return `
    <div class="platform-card-confirm-dock" data-confirm-dock="${id}">
      <p class="platform-card-confirm-dock-title">Finished on ${name}?</p>
      <p class="platform-card-confirm-dock-hint">This page stays here so you can copy your answers. ${name} only updates after it publishes your review.</p>
      <div class="platform-card-confirm-dock-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="confirm-posted" data-platform="${id}">Yes, I submitted it</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="confirm-later" data-platform="${id}">Not yet</button>
      </div>
    </div>`;
}
```

(`escapeHtml` already exists in `app.js`. Putting a copy in the helper keeps the helper testable and avoids a circular load. Do not export app.js’s function.)

**`mountRichPasteUnpostedCard` and `mountRichG2UnpostedCard`:** after the actions / details, if `shouldShowConfirmDock({ formOpened: reviewFormOpened[plat], posted: false, richLayout: true })`, append `postStepUx().confirmDockHtml({ platformId: plat, platformName: meta.name })`.

Also add `class="platform-card--active"` on that card when the dock is shown (in `initPostScreen` when building the card).

**`initPostScreen` wiring** (near the existing `confirm-posted` listener ~2537):

```js
grid.querySelectorAll('[data-action="confirm-later"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    /* dock stays; user can still copy. No overlay. */
  });
});
```

Empty listener is fine. Do **not** hide Copy on Not yet. Do **not** call `hideReviewCompleteOverlay` as a substitute for missing dock.

**`styles.css`** (after `.platform-card--rich .card-details--rich`, ~1697):

```css
.platform-card--rich.platform-card--active {
  outline: 2px solid var(--ll-purple);
  outline-offset: 2px;
}
.platform-card-confirm-dock {
  margin-top: 14px;
  padding: 14px 14px 12px;
  border: 1px solid var(--ll-purple-border);
  border-radius: var(--radius-md);
  background: var(--ll-purple-tint-light);
  text-align: left;
}
.platform-card-confirm-dock-title {
  margin: 0 0 4px;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--ll-heading);
}
.platform-card-confirm-dock-hint {
  margin: 0 0 12px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--ll-body);
}
.platform-card-confirm-dock-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

**Do not remove** the field `<details>` or `.btn-copy` rows in `mountRichG2UnpostedCard`. That is the Tonya must-fix.

### Step 4. `npm test && npm run check` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js app.js styles.css
git commit -m "feat: confirm on the open platform card instead of a blocking overlay"
```

---

## Task 10: Paste cards get a visible Copy button

Trustpilot (eimmigration) is `paste`. Today `mountRichPasteUnpostedCard` has **no** Copy — only “Open … review form”. Overlay used to be the only Copy. After Task 8 the overlay is gone on the popup path, so paste cards must expose Copy themselves.

### Step 1. Failing test

```js
test('paste unposted card HTML includes copy-all and keeps Open', () => {
  const html = ux.richPasteActionsHtml({ platformId: 'trustpilot', platformName: 'Trustpilot' });
  assert.match(html, /data-action="copy-all"/);
  assert.match(html, /data-action="post-paste"/);
  assert.match(html, /Copy review/);
  assert.match(html, /Open Trustpilot review form/);
});
```

### Step 2. Run — fail

### Step 3. Implement `richPasteActionsHtml` and use it in `mountRichPasteUnpostedCard`

```js
function richPasteActionsHtml({ platformId, platformName } = {}) {
  const id = escapeHtml(platformId || '');
  const name = escapeHtml(platformName || 'this site');
  return `
    <div class="platform-card-actions platform-card-actions--stack">
      <button type="button" class="btn btn-secondary btn-sm" data-action="copy-all" data-platform="${id}">Copy review</button>
      <button type="button" class="btn btn-primary btn-md" data-action="post-paste" data-platform="${id}">
        Open ${name} review form
      </button>
    </div>`;
}
```

In `mountRichPasteUnpostedCard`, replace the current single Open button block (~2180–2184) with this helper. Keep the snippet, stars, and foot hint. `initPostScreen` already wires `[data-action="copy-all"]` (~2550).

Fields cards already have per-field Copy — do not replace those with copy-all.

### Step 4. `npm test` — pass

### Step 5. Commit

```bash
git add post-step-ux.js test/post-step-ux.test.js app.js
git commit -m "feat: keep Copy on paste cards so overlay is not required to copy"
```

---

## Task 11: Login coach modal (Jonathan step 2)

Inject from JS. Do **not** add coach markup to the ten HTML files.

### Step 1. Failing wiring + copy tests

```js
test('app.js shows a login coach before opening the review window', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(src, /ensureLoginCoachModal/);
  assert.match(src, /showLoginCoach/);
  assert.match(src, /RRPostStepUx\.loginCoachCopy/);
  assert.match(src, /RRPostStepUx\.shouldCopyDraftBeforeCoach/);
});
```

### Step 2. Run — fail

### Step 3. Implement in `app.js` + `styles.css`

Follow `ensurePostStayNudge` / `ensureVideoCaptureModal`. Place new functions **above** `handlePastePost`.

```js
let loginCoachPendingPlatform = null;

function ensureLoginCoachModal() {
  let el = document.getElementById('login-coach-modal');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'login-coach-modal';
  el.className = 'login-coach-modal';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <button type="button" class="login-coach-modal__backdrop" data-login-coach-dismiss aria-label="Close"></button>
    <div class="login-coach-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="login-coach-title" aria-describedby="login-coach-body">
      <h3 id="login-coach-title" class="login-coach-modal__title"></h3>
      <p id="login-coach-body" class="login-coach-modal__body"></p>
      <div class="login-coach-modal__actions">
        <button type="button" id="btn-login-coach-continue" class="btn btn-primary btn-md"></button>
        <button type="button" id="btn-login-coach-cancel" class="btn btn-secondary btn-sm"></button>
      </div>
    </div>`;
  el.querySelector('[data-login-coach-dismiss]').addEventListener('click', hideLoginCoach);
  el.querySelector('#btn-login-coach-cancel').addEventListener('click', hideLoginCoach);
  el.querySelector('#btn-login-coach-continue').addEventListener('click', continueLoginCoach);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) hideLoginCoach();
  });
  document.body.appendChild(el);
  return el;
}

function hideLoginCoach() {
  loginCoachPendingPlatform = null;
  const el = document.getElementById('login-coach-modal');
  if (!el) return;
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
}

function showLoginCoach(platform) {
  const meta = PLATFORM_META[platform] || { name: platform };
  const copy = postStepUx().loginCoachCopy(platform, meta.name);
  const el = ensureLoginCoachModal();
  loginCoachPendingPlatform = platform;
  el.querySelector('#login-coach-title').textContent = copy.title;
  el.querySelector('#login-coach-body').textContent = copy.body;
  el.querySelector('#btn-login-coach-continue').textContent = copy.continueLabel;
  el.querySelector('#btn-login-coach-cancel').textContent = copy.cancelLabel;
  el.hidden = false;
  el.setAttribute('aria-hidden', 'false');
  el.querySelector('#btn-login-coach-continue')?.focus();
}

async function beginOpenReview(platform) {
  const meta = PLATFORM_META[platform] || { name: platform, flow: 'paste' };
  if (postStepUx().shouldCopyDraftBeforeCoach(meta.flow)) {
    const text = drafts[platform] || reviewDraft || '';
    const ok = await copyToClipboard(text);
    if (ok) showToast();
  }
  showLoginCoach(platform);
}

function continueLoginCoach() {
  const platform = loginCoachPendingPlatform;
  hideLoginCoach();
  if (!platform) return;
  openReviewAndPresentConfirm(platform);
}

function openReviewAndPresentConfirm(platform) {
  const link = PARAMS.reviewLinks[platform];
  const popup = link ? openReviewPlatform(link, platform) : null;
  reviewFormOpened[platform] = true;
  saveSession();
  initPostScreen();
  presentReviewCompleteAfterOpen(platform, popup);
}
```

**Rewrite click handlers** in `initPostScreen`:

- `[data-action="post-paste"]` → `beginOpenReview(btn.dataset.platform)` (not `handlePastePost`).
- `[data-action="open-form"]` → `beginOpenReview(btn.dataset.platform)` (not the inline open + overlay).

**`handlePastePost`:** keep the function for now but stop using it from the grid. Either delete the unused `skipOverlay` path or make `handlePastePost` call `beginOpenReview` so nothing bypasses the coach. Preferred (YAGNI, one path):

```js
async function handlePastePost(platform) {
  await beginOpenReview(platform);
}
```

Do **not** open the review window inside `beginOpenReview`. Window opens only in `continueLoginCoach` → `openReviewAndPresentConfirm`.

**`styles.css`:** clone the overlay/modal rules (`.review-complete-overlay` ~2000–2042) as `.login-coach-modal` / `__backdrop` / `__dialog`. Set `.login-coach-modal` to `z-index: 2000` so it sits above `#post-stay-nudge` (`z-index: 1900`). Title/body/actions match `.review-complete-*` spacing.

**Client brand surfaces** — in these four files, add `.login-coach-modal__dialog` to the existing group that already lists `.review-complete-modal`:

- `pages/clients/eimmigration/styles.css` (~99)
- `pages/clients/fatherhood/styles.css` (~135)
- `pages/clients/propertyradar/styles.css` (~105)
- `pages/clients/greentec/styles.css` (~123)

### Step 4. `npm test && npm run check` — pass

### Step 5. Commit

```bash
git add app.js styles.css pages/clients test/post-step-ux.test.js
git commit -m "feat: login/create-account coach before opening the review window"
```

---

## Task 12: Hide overlay leftover + keep tab-fallback (regression)

### Step 1. Failing tests

```js
test('tab fallback still schedules the existing overlay helpers', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(src, /function scheduleReviewCompleteOverlay/);
  assert.match(src, /function showReviewCompleteOverlay/);
  assert.match(src, /REVIEW_OVERLAY_FALLBACK_MS/);
  assert.match(src, /REVIEW_OVERLAY_BOUNCE_MS/);
});

test('popup path must not call showReviewCompleteOverlay immediately', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const fn = src.match(/function presentReviewCompleteAfterOpen\([\s\S]*?\n\}/);
  assert.ok(fn, 'presentReviewCompleteAfterOpen missing');
  assert.match(fn[0], /confirmUiAfterOpen/);
  assert.match(fn[0], /scheduleReviewCompleteOverlay/);
  assert.doesNotMatch(
    fn[0],
    /if \(popup\) \{[\s\S]*showReviewCompleteOverlay/,
  );
});
```

### Step 2. Run — should already pass after Task 8. If the second test fails, you still have the old `if (popup) showReviewCompleteOverlay` body. Fix that before continuing.

### Step 3. Manual code read (no extra product code if tests pass)

Open `presentReviewCompleteAfterOpen` and confirm:

- `mode === 'card'` → no `showReviewCompleteOverlay`
- else → `scheduleReviewCompleteOverlay` only (not `showReviewCompleteOverlay` immediately)

`flushPendingReviewOverlay` may still call `showReviewCompleteOverlay` — that is the tab-return / 400ms fallback. **Keep it.**

### Step 4. `npm test` — pass

### Step 5. Commit only if you had to fix wiring

```bash
git add app.js test/post-step-ux.test.js
git commit -m "test: lock tab-fallback overlay and popup non-blocking path"
```

If nothing changed, skip the commit.

---

## Task 13: Docs — HANDOFF note so the overlay is not put back

**File:** `HANDOFF.md`

### Step 1. No failing test. Add a short section after “Customer-facing app” / Screen 4 (or at the top of Known Limitations).

Exact text to add:

```markdown
## Post step UX (Sep 2026) — do not regress

On Post (`#screen-post`, rich layout):

1. **Stay nudge** (`#post-stay-nudge`) — bottom-right reminder that reviews are not posted until the visitor uses the review sites. Keep it.
2. **Login coach** (`#login-coach-modal`) — after Open, before `openReviewPlatform()`. Coach-only (create/log in on G2 / Gartner / Trustpilot). Continue opens the existing mini-window. No OAuth.
3. **Popup path** — do **not** call `showReviewCompleteOverlay` while the review window is open. Confirm on the platform card (`Yes, I submitted it` / `Not yet`). Keep G2/Gartner per-field Copy on the card.
4. **Tab fallback** — if `window.open` is blocked, `scheduleReviewCompleteOverlay` still waits for return (300ms bounce + 400ms fallback).
5. **beforeunload** — still warns on Post while any platform is unconfirmed.

Helpers live in `/post-step-ux.js` (`window.RRPostStepUx`). Tests: `test/post-step-ux.test.js`.
```

### Step 2. No test. Skim that the five bullets match the code you shipped.

### Step 3. Commit

```bash
git add HANDOFF.md
git commit -m "docs: record last-step overlay and login-coach rules"
```

---

## Task 14 (optional polish, after musts): strengthen `#post-stay-nudge`

Tonya: bottom popup is unassuming / easy to miss. **Only do this after Tasks 1–13 are green.** Do not block Tonya/Jonathan sign-off on this.

### Step 1. No new product logic. CSS only in `styles.css` `.post-stay-nudge` (~2446):

- Width `min(400px, calc(100vw - 32px))` (was 360px)
- Title `font-size: 1.0625rem` (was `0.9375rem`)
- Border `2px solid var(--ll-brand-border)` (was 1px)
- Accent bar already `background: red` — keep it
- Entrance: `transform: translateY(24px) scale(0.98)` → `.is-visible` `translateY(0) scale(1)`; honor `prefers-reduced-motion` (already disables transition)

Do **not** change copy, `role="dialog"`, or dismiss/sessionStorage behavior.

### Step 2. Commit

```bash
git add styles.css
git commit -m "polish: make the post-stay nudge easier to notice"
```

---

## Task 15: Manual test on eimmigration (required before you call it done)

Repo has no browser runner. You must click this yourself (or with the computer-use browser).

```bash
npm run dev
```

Open:

```
http://localhost:8888/eimmigration/?name=Tonya+Test&email=tonya@example.com
```

You cannot reach Post without drafts. Fastest path:

1. Walk Welcome → Chat. Give short positive answers until drafts appear (or restore a session in DevTools if you already have one).
2. Approve drafts → Post.

If the agent is down, you may seed sessionStorage (DevTools console on `/eimmigration/`) **only for local QA**, then refresh:

```js
// Inspect getSessionStorageKey() in app.js if this key is wrong.
// Typical: rr_session_eimmigration
const key = 'rr_session_eimmigration';
const cur = JSON.parse(sessionStorage.getItem(key) || '{}');
sessionStorage.setItem(key, JSON.stringify({
  ...cur,
  currentState: 'post',
  drafts: {
    g2: '[FIELD: What do you like best?]\nFast filings.\n\n[FIELD: What do you dislike?]\nNothing major.\n\n[FIELD: What problems is it solving?]\nCase tracking.\n\n[FIELD: Recommendations:]\nYes.',
    gartner: '[FIELD: Overall]\nStrong for our team.',
    trustpilot: 'eimmigration made our process clearer.',
  },
  platformsPosted: {},
  reviewFormOpened: {},
}));
location.reload();
```

Only do that locally. Do not commit this snippet into `app.js`.

### Checklist (must all pass)

**Jonathan**

- [ ] Click Open on G2: login coach appears **before** a review window. Copy mentions create/log in + LinkedIn/work email. No OAuth button.
- [ ] Continue opens a **mini window** (Reputation Rocket stays visible). Coach closes.
- [ ] Not now / backdrop / Escape: no window opens.
- [ ] Trustpilot Open: clipboard gets the draft (toast) **then** coach; Continue opens Trustpilot window.
- [ ] Gartner coach mentions work email; Continue opens Gartner window.
- [ ] Close the RR tab while still on Post with unconfirmed platforms: browser leave warning still appears (Edward step 3).

**Tonya**

- [ ] While the G2 window is open, the **card** still shows per-field Copy. No full-screen dimming overlay over the cards.
- [ ] You can copy field 1, paste in the popup, copy field 2, without dragging a modal aside.
- [ ] Yes, I submitted it on the card marks the platform and updates progress.
- [ ] Not yet leaves Copy visible.
- [ ] Trustpilot card has Copy review after Open (and ideally before).
- [ ] Bottom nudge still appears (visibility polish only if you did Task 14).

**Tab fallback**

- [ ] In DevTools, stub `window.open` to return `null` (or use a popup blocker). Open Trustpilot: no coach-continue window. After you stay on / return to the tab, the **existing** “Finished on …?” overlay still appears. Confirm still works.

**Do not undo**

- [ ] Nudge still dismisses for the session (`rr-post-stay-nudge:eimmigration`).
- [ ] `openReviewPlatform` still uses `popup=yes` (watch the window, not a new Chrome tab, on desktop).

Live comparison (current production, **before** your deploy): https://reputationrocket.ai/eimmigration/ — overlay still covers cards. Your local build must not.

---

## 3. What “done” means

- `npm test` and `npm run check` pass.
- Popup path: **no** `#review-complete-overlay` while the review window is open; G2/Gartner Copy stays clickable; paste cards have Copy.
- Open → login coach → Continue → existing popup window.
- Tab-fallback overlay + beforeunload + stay-nudge still work.
- Optional nudge CSS is a separate commit, after the musts.
- HANDOFF records the five rules.

## 4. Suggested Slack update after implement (not part of this plan PR)

In `#eimmigration` thread `1788563520.039309`, Edward/Ralph can say: overlay no longer covers drafts on the popup path; login/create-account coach runs before the review window; step 3 leave-warning unchanged. Ask Tonya + Jonathan for green, then Viv.

---

## 5. Sources (this plan)

- Linear [RAL-49](https://linear.app/ralph-os/issue/RAL-49/eimmigration-tonyajonathan-fix-reputation-rocket-last-step-overlay) — Ralph: “Lets run this for Edward. Make sure to read the feedback video transcript!”
- Slack `#eimmigration` parent `1788563520.039309` — Kevin last-step thread; Edward’s three fixes (`1788863315.019549`); Kevin wants Tonya + Jonathan then Viv (`1788910501.490039`); Tonya yellow (`1788960138.336519`); Jonathan yellow + Loom (`1788961062.918689`)
- Loom oembed + video metadata for `89ae0801b43c48d1a04cb2be4be0cbae` (full caption dump was not available from the public share page at plan time; description + chapters + Slack were used)
- Code verified on `main` @ `519874ca` (`presentReviewCompleteAfterOpen`, `showReviewCompleteOverlay`, `openReviewPlatform`, `ensurePostStayNudge`, `shouldWarnBeforeLeavingReviewPost`, `mountRichG2UnpostedCard`)
