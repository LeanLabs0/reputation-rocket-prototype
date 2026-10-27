const CLIENT_CONFIG = window.CLIENT_CONFIG || {};

function applyCurrentYearTokens() {
  const year = String(new Date().getFullYear());
  $$('[data-current-year]').forEach((el) => { el.textContent = year; });
}

const CONFIG = {
  API_URL: CLIENT_CONFIG.agentEndpoint || '/api/agent',
  NOTIFY_URL: CLIENT_CONFIG.notificationEndpoint || '/api/notify',
  VIDEO_UPLOAD_URL: CLIENT_CONFIG.videoUploadEndpoint || '/api/upload-video',
  HUBSPOT_CONTACT_URL: CLIENT_CONFIG.hubspotContactEndpoint || '/api/hubspot-contact',
  AGENT: 'reputation-rocket',
  TIMEOUT_MS: 60000,
};

const REGENERATE_DRAFT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-regenerate-icon" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';

function setRegenerateButtonLabel(btn, label) {
  if (!btn) return;
  btn.innerHTML = `${REGENERATE_DRAFT_ICON_SVG}<span class="btn-regenerate-label">${label}</span>`;
}

// ── URL Params (+ optional /configure store overlay) ─────────
/** Accept https URLs or local site paths; encode spaces in asset paths. */
function normalizeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
    return raw;
  }
  const path = raw.startsWith('/') ? raw : `/${raw.replace(/^\.\//, '')}`;
  return path
    .split('/')
    .map((seg, i) => {
      if (i === 0) return seg;
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch (_) {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
}

/** Case-insensitive query param lookup. First matching alias with a value wins. */
function getQueryParam(searchParams, ...aliases) {
  const wanted = aliases.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return '';
  for (const [key, raw] of searchParams.entries()) {
    if (!wanted.includes(String(key).toLowerCase())) continue;
    const value = String(raw || '').trim();
    if (value) return value;
  }
  return '';
}

function buildParamsFromConfig(config) {
  const p = new URLSearchParams(window.location.search);
  const firstNameFromUrl = getQueryParam(p, 'firstname', 'first_name');
  const lastNameFromUrl = getQueryParam(p, 'lastname', 'last_name');
  const name =
    getQueryParam(p, 'name') ||
    [firstNameFromUrl, lastNameFromUrl].filter(Boolean).join(' ');
  const cfg = config || {};

  const providerName = (
    (cfg.providerName || cfg.brandName || cfg.company || '').trim() ||
    'our team'
  );

  // Visitor HubSpot `company` in the URL is the reviewer's org, never the
  // portal brand shown in .company-name / welcome copy.
  const customerCompany =
    (cfg.defaultCustomerCompany || cfg.customerCompany || '').trim() ||
    providerName;
  const visitorCompany = getQueryParam(p, 'company', 'companyname', 'company_name');

  const platformsFromUrl = (p.get('platforms') || '').split(',').map(s => s.trim()).filter(Boolean);
  const platforms = platformsFromUrl.length
    ? platformsFromUrl
    : Array.isArray(cfg.platforms) ? cfg.platforms : [];

  const reviewLinks = { ...(cfg.reviewLinks || {}) };
  platforms.forEach(plat => {
    const link = p.get(`review_${plat}`);
    if (link) reviewLinks[plat] = link;
  });

  const defaultInterviewQuestions = [
    `Why did you choose ${providerName}?`,
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ];
  const interviewQuestions = (
    Array.isArray(cfg.interviewQuestions) && cfg.interviewQuestions.length
      ? cfg.interviewQuestions
      : defaultInterviewQuestions
  ).map((q) => String(q == null ? '' : q).trim()).filter(Boolean);

  return {
    clientSlug: cfg.clientSlug || window.location.pathname.split('/').filter(Boolean)[0] || 'default',
    name,
    firstName: firstNameFromUrl || name.split(' ')[0] || 'there',
    providerName,
    customerCompany,
    company: customerCompany,
    visitorCompany,
    email: getQueryParam(p, 'email'),
    platforms,
    reviewLinks,
    videoUrl: p.get('video_url') || cfg.videoUrl || '',
    welcomeVideoUrl: p.has('no-video')
      ? ''
      : normalizeMediaUrl(p.get('welcome_video_url') || cfg.welcomeVideoUrl || ''),
    welcomeVideoPoster: normalizeMediaUrl(p.get('welcome_video_poster') || cfg.welcomeVideoPoster || ''),
    interviewQuestions,
    thankYouUrl: (p.get('thank_you_url') || cfg.thankYouUrl || '').trim(),
    thankYouRedirectDelayMs: (() => {
      const fromUrl = p.get('thank_you_redirect_delay_ms');
      if (fromUrl != null && fromUrl !== '') {
        const n = Number(fromUrl);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      const fromConfig = Number(cfg.thankYouRedirectDelayMs);
      return Number.isFinite(fromConfig) && fromConfig >= 0 ? fromConfig : 5000;
    })(),
    allowedRedirectHosts: cfg.allowedRedirectHosts || [],
    supportEmail: (cfg.supportEmail || '').trim(),
  };
}

let PARAMS = buildParamsFromConfig(CLIENT_CONFIG);

async function hydratePortalSettingsFromStore() {
  try {
    const slug = PARAMS.clientSlug;
    if (!slug) return;
    const res = await fetch(`/api/client-config?clientSlug=${encodeURIComponent(slug)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.settings) return;

    Object.assign(CLIENT_CONFIG, data.settings);
    // Store wins for HubSpot IDs (OAuth on Vercel cannot rewrite config.js).
    if (data.hubspot?.portalId) {
      CLIENT_CONFIG.hubspotPortalId = data.hubspot.portalId;
    }
    if (data.hubspot?.formId) {
      CLIENT_CONFIG.hubspotFormId = data.hubspot.formId;
    }
    if (data.hubspot?.formRegion) {
      CLIENT_CONFIG.hubspotFormRegion = data.hubspot.formRegion;
    }
    PARAMS = buildParamsFromConfig(CLIENT_CONFIG);
  } catch (_) {
    /* keep local config.js values */
  }
}

// ── State ───────────────────────────────────────────────────
let currentState = 'welcome';
let sessionId = '';
let machineId = '';
let chatHistory = [];      
let agentMessageCount = 0;
let reviewDraft = '';
let drafts = {};        
let activeDraftPlatform = '';
let currentPlatformIndex = 0;
let starRating = 5;
/**
 * Decimal rating computed by the agent (e.g. 4.2). Null until the agent reports
 * one. Used for negative/positive routing (4.1 cutoff) and Slack reporting so we
 * never lose precision by treating it as an integer.
 */
let agentRating = null;
let platformsPosted = {};
/** ISO timestamps when each platform was marked posted (rich post UI). */
let platformPostedAt = {};
/** Platforms where user has clicked "Open … review form" (fields flow / G2); unlocks inline confirm. */
let reviewFormOpened = {};
/** Guided post flow: per-platform list of field indexes the visitor already copied. */
let platformFieldsCopied = {};
/** Platform waiting to show the review-complete overlay when user returns. */
let pendingReviewOverlayPlatform = null;
/** True only after we observed the app lose visibility or window focus. */
let reviewOverlayAwaitingReturn = false;
let reviewOverlayFallbackTimer = null;
let pendingReviewOverlayScheduledAt = 0;
/** Ignore the blur/focus bounce from opening a tab so the overlay does not flash immediately. */
const REVIEW_OVERLAY_BOUNCE_MS = 300;
/** If the opener never leaves (blocked tab, missing URL), still offer confirm. */
const REVIEW_OVERLAY_FALLBACK_MS = 400;
let negativeFlagData = null;
/**
 * Which tap-to-answer button set the chat is showing:
 * 'stars' (the 1 to 5 rating question; hides the text box)
 * | 'murky' (the 4-star choice; hides the text box)
 * | 'murky-feedback' (support question at the end of the 4 -> 5 review flow; text box stays)
 * | null.
 */
let chatChoiceMode = null;
/** 4-star "murky middle" outcome for this session: { chose: 5 | 3, feedback, supportHandled } or null. */
let murkyMiddle = null;
/** Tapped 5 on the star buttons (not via the 4-star choice). */
let ratedDirectFive = false;
/** Direct-5 path already auto-answered the closing improvements question. */
let directFiveImproveSkipped = false;
/** V3 interview progress: { step, answers, partial, pending, done, writerSessionId } or null. */
let interviewState = null;
/** What the V3 interview shows: 'choices' (under the question), 'text' (the text box) or 'none'. */
let interviewInputMode = 'none';
/** The V3 open question waiting for an answer: { step, isFollowUp, placeholder } or null. */
let interviewTextStep = null;
let isWaitingForAgent = false;
let lastAgentMessage = '';
let notificationsSent = {};
let hubspotCompleteSent = false;
let hubspotIncompleteSent = false;
let uploadedVideoMeta = null;
/** Per-platform: user tapped "Looks good" for that draft (required before Approve all). */
let draftLooksGood = {};
/** HubSpot form rows for this visit, kept with the handoff snapshot. */
let leadFields = [];
/** Live-call handoff. `guest` is the operator; `client` is the resume link. */
let handoffToken = '';
let handoffRole = '';
let handoffLocked = false;
let handoffSaveTimer = null;
let handoffPollTimer = null;
let handoffWriteChain = Promise.resolve();
let videoRecorder = null;
let videoStream = null;
let videoRecordingStream = null;
let videoFrameRafId = null;
let videoFrameSourceEl = null;
let videoChunks = [];
let videoRecordedBlob = null;
let videoRecordedMime = '';
let videoElapsedSec = 0;
let videoTimerId = null;
let videoIsUploading = false;
let videoInputDeviceId = '';
let audioInputDeviceId = '';
const VIDEO_CAPTURE_SETTINGS = {
  maxSeconds: 15 * 60,
  maxUploadMB: 600,
  videoBitsPerSecond: 4_500_000,
  audioBitsPerSecond: 160_000,
  width: 1920,
  height: 1080,
  // Recordings are normalized to this 16:9 frame. If the camera feed isn't 16:9
  // it's centered (object-fit: contain) and the rest is filled with this color.
  frameRate: 30,
  backgroundFill: '#000000',
};
VIDEO_CAPTURE_SETTINGS.maxUploadBytes = VIDEO_CAPTURE_SETTINGS.maxUploadMB * 1024 * 1024;

// ── Fetch with sticky routing ───────────────────────────────
async function fetchWithStickyRetry(body, signal) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (machineId) {
    headers['fly-force-instance-id'] = machineId;
  }

  let res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 404 && machineId) {
    machineId = '';
    const retryHeaders = {
      'Content-Type': 'application/json',
    };
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: retryHeaders,
      body: JSON.stringify(body),
      signal,
    });
  }

  return res;
}

function getSessionStorageKey() {
  const slug = String(PARAMS.clientSlug || CLIENT_CONFIG.clientSlug || 'default').trim() || 'default';
  return `rr_session_${slug}`;
}

// ── DOM refs ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await hydratePortalSettingsFromStore();

  try {
  applyCurrentYearTokens();
  applyVideoStepVisibility();
  placeProgressShell(currentState);

  try {
    sessionStorage.removeItem('rr_session');
  } catch (_) { }

  // Populate dynamic text
  $$('.company-name').forEach(el => { el.textContent = PARAMS.providerName; });
  $$('.provider-name').forEach(el => { el.textContent = PARAMS.providerName; });
  $$('.first-name').forEach(el => { el.textContent = PARAMS.firstName; });
  renderVideoScreenQuestions();
  applyDocumentTitle();

  // Optional welcome video. The element is injected only when a client provides a URL.
  // It starts with a centered play-button overlay; clicking it reveals the native
  // controls and starts playback.
  const welcomeVideoHost = $('#welcome-video-host');
  if (PARAMS.welcomeVideoUrl && welcomeVideoHost) {
    const wrap = document.createElement('div');
    wrap.className = 'welcome-video-wrap';

    const vid = document.createElement('video');
    vid.id = 'welcome-video';
    vid.className = 'welcome-video';
    vid.playsInline = true;
    vid.preload = PARAMS.welcomeVideoPoster ? 'none' : 'metadata';
    if (PARAMS.welcomeVideoPoster) {
      vid.poster = PARAMS.welcomeVideoPoster;
    }

    const src = document.createElement('source');
    src.id = 'welcome-video-source';
    src.src = PARAMS.welcomeVideoUrl;
    src.type = 'video/mp4';
    vid.appendChild(src);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'welcome-video-play';
    playBtn.setAttribute('aria-label', 'Play video');
    playBtn.innerHTML =
      '<span class="welcome-video-play-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="18" viewBox="0 0 16 18" fill="none"><path d="M8.78626e-08 2.00059C-0.000104208 1.64868 0.0926453 1.30298 0.268884 0.998383C0.445122 0.693786 0.69861 0.441083 1.00375 0.265789C1.30889 0.090495 1.65488 -0.00118309 2.00679 1.15272e-05C2.3587 0.00120614 2.70406 0.0952313 3.008 0.272593L15.005 7.27059C15.3078 7.44627 15.5591 7.69834 15.7339 8.0016C15.9088 8.30486 16.0009 8.64869 16.0012 8.99873C16.0015 9.34877 15.91 9.69276 15.7357 9.99633C15.5614 10.2999 15.3105 10.5524 15.008 10.7286L3.008 17.7286C2.70406 17.906 2.3587 18 2.00679 18.0012C1.65488 18.0024 1.30889 17.9107 1.00375 17.7354C0.69861 17.5601 0.445122 17.3074 0.268884 17.0028C0.0926453 16.6982 -0.000104208 16.3525 8.78626e-08 16.0006V2.00059Z" fill="#D9D9D9"/></svg></span>';
    playBtn.addEventListener('click', () => {
      vid.controls = true;
      wrap.classList.add('is-playing');
      const p = vid.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });

    wrap.appendChild(vid);
    wrap.appendChild(playBtn);
    welcomeVideoHost.appendChild(wrap);
  }

  $('#btn-start').addEventListener('click', startExperience);

  const startOverBtn = $('#btn-start-over');
  if (startOverBtn) {
    startOverBtn.addEventListener('click', () => {
      allowPageUnload = true;
      if (typeof window.rrReset === 'function') {
        window.rrReset();
      } else {
        try {
          sessionStorage.removeItem(getSessionStorageKey());
        } catch (_) {}
        window.location.reload();
      }
    });
  }

  $('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });
  $('#chat-input').addEventListener('input', () => {
    resizeChatInput();
    syncChatComposerState();
  });
  $('#chat-send').addEventListener('click', handleChatSend);
  mountChatDictation();

  $('#btn-regenerate').addEventListener('click', handleRegenerate);
  setRegenerateButtonLabel($('#btn-regenerate'), 'Regenerate this draft');
  $('#btn-approve').addEventListener('click', handleLooksGoodDraft);
  $('#btn-approve-all')?.addEventListener('click', handleApproveAllDrafts);
  const draftTa = $('#draft-textarea');
  if (draftTa) {
    draftTa.addEventListener('input', () => {
      if (!activeDraftPlatform) return;
      if (draftLooksGood[activeDraftPlatform]) {
        draftLooksGood[activeDraftPlatform] = false;
        renderDraftTabs();
        updateDraftScreenChrome();
        saveSession();
      }
    });
  }
  const viewDraft = $('#btn-view-draft');
  if (viewDraft) viewDraft.addEventListener('click', () => transitionTo('draft'));

  // Draft-screen stars are display-only: the draft screen is always the
  // positive path, so the rating is locked at a solid 5 and not clickable.

  const editHint = $('#btn-edit-hint');
  if (editHint) {
    editHint.addEventListener('click', () => $('#draft-textarea').focus());
  }

  $('#btn-continue-post').addEventListener('click', handleContinueAfterPost);
  $('#skip-remaining')?.addEventListener('click', handleContinueAfterPost);
  $('#btn-back-to-draft')?.addEventListener('click', () => transitionTo('draft'));

  const reviewOverlay = $('#review-complete-overlay');
  const confirmReviewBtn = $('#btn-review-complete-confirm');
  const laterReviewBtn = $('#btn-review-complete-later');
  const copyReviewBtn = $('#btn-review-complete-copy');
  if (reviewOverlay && confirmReviewBtn && laterReviewBtn) {
    confirmReviewBtn.addEventListener('click', () => {
      const plat = reviewOverlay.dataset.platform;
      hideReviewCompleteOverlay();
      if (plat && !platformsPosted[plat]) markPlatformPosted(plat);
    });
    laterReviewBtn.addEventListener('click', hideReviewCompleteOverlay);
    reviewOverlay.querySelector('[data-review-overlay-dismiss]')?.addEventListener('click', hideReviewCompleteOverlay);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!reviewOverlay.hidden) hideReviewCompleteOverlay();
    });
  }
  copyReviewBtn?.addEventListener('click', async () => {
    const plat = reviewOverlay?.dataset.platform || '';
    const text = String((plat && drafts[plat]) || reviewDraft || '').trim();
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) showToast();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      markReviewOverlayLeftApp();
      return;
    }
    maybeShowPendingReviewOverlay();
    maybePulseGuidedConfirm();
  });
  window.addEventListener('blur', markReviewOverlayLeftApp);
  window.addEventListener('focus', () => {
    maybeShowPendingReviewOverlay();
    maybePulseGuidedConfirm();
  });

  $('#btn-skip-video').addEventListener('click', () => transitionTo('complete'));
  $('#btn-record-video').addEventListener('click', openVideoCaptureModal);
  $('.video-powered')?.replaceChildren(document.createTextNode('Uploaded to HubSpot'));

  window.addEventListener('beforeunload', onBeforeUnloadReviewPost);

    const handoffBoot = await bootHandoff();
    if (handoffBoot === 'client') return;
    const restored = restoreSession();
    if (handoffRole === 'guest') {
      fillGuestBar();
      if (!restored) saveSession();
    }
  } catch (err) {
    console.error('[Reputation Rocket] Session restore failed:', err);
  }
});

// ── State Machine ───────────────────────────────────────────
function transitionTo(state) {
  clearPendingReviewOverlay();
  hideReviewCompleteOverlay();

  // Move the step bar before the welcome screen loses .active. On Step 1 the
  // bar lives inside that screen, and a hidden screen would hide the bar with it.
  placeProgressShell(state);

  $$('.screen').forEach(s => s.classList.remove('active'));

  currentState = state;

  const screenEl = $(`#screen-${state}`);
  if (screenEl) screenEl.classList.add('active');

  updateProgressBar(state);
  updateNavTitle(state);

  switch (state) {
    case 'chat':
      initChat();
      break;
    case 'draft':
      initDraftScreen();
      break;
    case 'post':
      initPostScreen();
      break;
    case 'video':
      if (!isVideoStepEnabled()) {
        transitionTo('complete');
        return;
      }
      initVideoScreen();
      break;
    case 'complete':
      initCompleteScreen();
      break;
    case 'negative':
      initNegativeScreen();
      break;
  }

  saveSession();
  syncPostStayNudge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Header title: "Review complete" on the final thank-you screen, default otherwise. */
function updateNavTitle(state) {
  const el = document.querySelector('.nav-title');
  if (!el) return;
  if (el.dataset.defaultTitle == null) el.dataset.defaultTitle = el.textContent;
  el.textContent = state === 'complete' ? 'Review complete' : el.dataset.defaultTitle;
}

// Step bar under the welcome CTA (CLIENT_CONFIG.progressBelowWelcome). Before the
// flow starts the steps have no context, so the bar previews them below the
// button, then goes back to its spot at the top from Step 2 on. #progress-shell-home
// marks that spot. EIM puts the bar under the button in the HTML so it does not
// jump down after the settings request. Clients that only set the flag get a
// comment marker on the first run. The guest handoff bar uses the same spot.
let progressShellHome = null;

function isProgressBelowWelcome() {
  return CLIENT_CONFIG.progressBelowWelcome === true;
}

function guestBarAnchor() {
  return progressShellHome
    || document.getElementById('progress-shell-home')
    || document.querySelector('.progress-shell');
}

function isParkedAfter(node, anchor) {
  if (!node || !anchor) return false;
  let prev = node.previousSibling;
  while (prev && prev.nodeType === 3 && !String(prev.textContent || '').trim()) {
    prev = prev.previousSibling;
  }
  return prev === anchor;
}

function placeProgressShell(state) {
  if (!isProgressBelowWelcome()) return;
  const shell = $('.progress-shell');
  const cta = $('#screen-welcome .welcome-cta');
  if (!shell || !cta) return;
  if (!progressShellHome) {
    progressShellHome = document.getElementById('progress-shell-home');
    if (!progressShellHome) {
      progressShellHome = document.createComment(' progress-shell home ');
      shell.before(progressShellHome);
    }
  }
  const below = state === 'welcome';
  const anchor = below ? cta : progressShellHome;
  if (!isParkedAfter(shell, anchor)) anchor.after(shell);
  shell.classList.toggle('progress-shell--below-welcome', below);
}

function getProgressStateToStep() {
  if (isVideoStepEnabled()) {
    return { welcome: 1, chat: 2, draft: 3, post: 4, video: 5, complete: 6, negative: -1 };
  }
  return { welcome: 1, chat: 2, draft: 3, post: 4, complete: 5, negative: -1 };
}

function updateProgressBar(state) {
  const activeStep = getProgressStateToStep()[state] || 1;

  $$('.progress-step').forEach(step => {
    const num = parseInt(step.dataset.step, 10);
    const badge = step.querySelector('.progress-badge');
    const dot = step.querySelector('.progress-dot');
    step.classList.remove('active', 'done');

    let isDone = false;
    let isActive = false;

    if (state === 'negative') {
      if (num <= 2) isDone = true;
    } else if (state === 'complete') {
      isDone = true;
    } else if (num < activeStep) {
      isDone = true;
    } else if (num === activeStep) {
      isActive = true;
    }

    if (isDone) step.classList.add('done');
    if (isActive) step.classList.add('active');

    if (dot) dot.dataset.state = isDone ? 'done' : isActive ? 'active' : 'pending';
    if (badge) {
      if (isDone) badge.textContent = 'Completed';
      else if (isActive) badge.textContent = 'In progress';
      else badge.textContent = 'Pending';
    }
  });
}

// ── Welcome → Chat ──────────────────────────────────────────
const URL_TO_HUBSPOT_LEAD_FIELDS = [
  { hs: 'firstname', keys: ['firstname', 'first_name'] },
  { hs: 'lastname', keys: ['lastname', 'last_name'] },
  { hs: 'email', keys: ['email'] },
  { hs: 'company', keys: ['company', 'companyname', 'company_name'] },
  { hs: 'website', keys: ['website', 'website_url'] },
  { hs: 'phone', keys: ['phone', 'phone_number', 'mobilephone'] },
  { hs: 'jobtitle', keys: ['jobtitle', 'job_title'] },
];

function getLeadFieldsFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const rows = [];
  const seen = new Set();

  URL_TO_HUBSPOT_LEAD_FIELDS.forEach(({ hs, keys }) => {
    const value = getQueryParam(p, ...keys);
    if (!value || seen.has(hs)) return;
    seen.add(hs);
    rows.push({ name: hs, value });
  });

  if (!seen.has('firstname')) {
    const fullName = getQueryParam(p, 'name');
    if (fullName) {
      const parts = fullName.split(/\s+/).filter(Boolean);
      if (parts[0]) {
        seen.add('firstname');
        rows.push({ name: 'firstname', value: parts[0] });
      }
      if (parts.length > 1 && !seen.has('lastname')) {
        seen.add('lastname');
        rows.push({ name: 'lastname', value: parts.slice(1).join(' ') });
      }
    }
  }

  return rows;
}

function hasHubSpotLeadFormConfigured() {
  const portal = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  const formId = String(CLIENT_CONFIG.hubspotFormId || '').trim();
  return !!(portal && formId);
}

function hasLeadCaptureFromUrl() {
  const rows = getLeadFieldsFromUrl();
  const email = rows.find((row) => row.name === 'email')?.value;
  const firstname = rows.find((row) => row.name === 'firstname')?.value;
  return !!(email && firstname);
}

function shouldShowHubSpotLeadForm() {
  if (!hasHubSpotLeadFormConfigured()) return false;
  return !hasLeadCaptureFromUrl();
}

function applyDocumentTitle() {
  const provider = String(PARAMS.providerName || '').trim();
  document.title = provider
    ? `Reputation Rocket | ${provider}`
    : 'Reputation Rocket';
}

function refreshDynamicLabels() {
  $$('.company-name').forEach((el) => { el.textContent = PARAMS.providerName; });
  $$('.provider-name').forEach((el) => { el.textContent = PARAMS.providerName; });
  $$('.first-name').forEach((el) => { el.textContent = PARAMS.firstName; });
  applyDocumentTitle();
}

function applyLeadIdentityFromStorage(identity) {
  if (!identity || typeof identity !== 'object') return;
  if (identity.name) PARAMS.name = String(identity.name);
  if (identity.firstName) PARAMS.firstName = String(identity.firstName);
  if (identity.email) PARAMS.email = String(identity.email);
  if (identity.visitorCompany) PARAMS.visitorCompany = String(identity.visitorCompany);
  refreshDynamicLabels();
}

/**
 * Normalize HubSpot field names (handles "0-1/firstname", paths, etc.).
 */
function normalizeHubSpotFieldKey(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const tail = s.split(/[/\\]/).pop();
  s = String(tail || s).replace(/-/g, '_');
  s = s.replace(/^\d+_\d+_?/, '');
  return s;
}

function rowValueToString(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(', ');
  return String(v).trim();
}

function parseSubmissionValuesFromHubSpotData(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.submissionValues)) return data.submissionValues;
  if (Array.isArray(data.submittedValues)) return data.submittedValues;
  if (Array.isArray(data.fields)) return data.fields;
  const sv = data.submissionValues;
  if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
    return Object.entries(sv).map(([name, value]) => ({ name, value: rowValueToString(value) }));
  }
  return [];
}

function scrapeLeadFieldsFromHubSpotDom(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
  const out = [];
  rootEl.querySelectorAll('input[name], select[name], textarea[name]').forEach((field) => {
    const name = field.name;
    if (!name) return;
    const t = (field.type || '').toLowerCase();
    if (t === 'button' || t === 'submit') return;
    if (t === 'hidden' && /utm|hs_context|csrf|goog-|hutk|__hstc|__hssc|content[_-]?type/i.test(name)) {
      return;
    }
    if ((t === 'checkbox' || t === 'radio') && !field.checked) return;
    const value = rowValueToString(field.value);
    if (!value) return;
    out.push({ name, value });
  });
  return out;
}

/**
 * Merge HubSpot embed submission + DOM into PARAMS for agent + Slack.
 */
function applyHubSpotSubmissionToParams(submissionValues) {
  const map = {};
  (submissionValues || []).forEach((row) => {
    const rawName = row.name != null ? String(row.name) : '';
    if (!rawName) return;
    const val = rowValueToString(row.value);
    const nk = normalizeHubSpotFieldKey(rawName);
    if (nk) map[nk] = val;
  });

  const first =
    map.firstname ||
    map.first_name ||
    map.fname ||
    '';
  const last = map.lastname || map.last_name || map.lname || '';
  let fullName =
    [first, last].filter(Boolean).join(' ').trim() ||
    map.name ||
    map.fullname ||
    map.full_name ||
    map.contact_name ||
    '';

  if (!fullName) {
    for (const [k, v] of Object.entries(map)) {
      if (!v) continue;
      if (
        k.includes('full_name') ||
        k === 'your_name' ||
        (k.includes('name') && !k.includes('company') && !k.includes('username') && k.length <= 20)
      ) {
        fullName = v;
        break;
      }
    }
  }

  if (fullName) PARAMS.name = fullName;
  if (first) PARAMS.firstName = first;
  else if (fullName) PARAMS.firstName = fullName.split(/\s+/)[0] || 'there';
  else PARAMS.firstName = 'there';

  let email =
    map.email ||
    map.work_email ||
    map.workemail ||
    map.contact_email ||
    map.businessemail ||
    '';
  if (!email) {
    for (const [k, v] of Object.entries(map)) {
      if (!v) continue;
      if (
        k === 'email' ||
        k.endsWith('_email') ||
        (k.includes('email') && !k.includes('confirm') && !k.includes('second'))
      ) {
        email = v;
        break;
      }
    }
  }
  if (email) PARAMS.email = email;

  let co =
    map.company ||
    map.companyname ||
    map.company_name ||
    map.organization ||
    map.organisation ||
    map.account_name ||
    map.your_company ||
    '';
  if (!co) {
    for (const [k, v] of Object.entries(map)) {
      if (!v) continue;
      if (
        (k.includes('company') || k.includes('organization')) &&
        !k.includes('associated') &&
        !k.includes('companyid') &&
        !k.includes('company_id')
      ) {
        co = v;
        break;
      }
    }
  }
  if (co) {
    PARAMS.visitorCompany = co;
  }

  refreshDynamicLabels();
}

function extractSubmissionFromHubSpotCallback($form, data) {
  const fromData = parseSubmissionValuesFromHubSpotData(data);
  if (fromData.length) return fromData;

  let el = $form && $form.length ? $form[0] : $form;
  if (el && typeof el.querySelector === 'function' && !el.querySelector('input[name]')) {
    const innerForm = el.querySelector('form.hs-form, form');
    if (innerForm) el = innerForm;
  }
  if (el && typeof el.querySelectorAll === 'function') {
    return scrapeLeadFieldsFromHubSpotDom(el);
  }

  const host = document.getElementById('hubspot-lead-form-target');
  if (host) {
    const form = host.querySelector('form.hs-form, form');
    if (form) return scrapeLeadFieldsFromHubSpotDom(form);
    return scrapeLeadFieldsFromHubSpotDom(host);
  }
  return [];
}

/**
 * Prefer callback rows; fill missing normalized keys from fallback (e.g. live DOM).
 */
function mergeHubSpotSubmissionRows(primary, fallback) {
  const byKey = new Map();
  const ingest = (rows, gapsOnly) => {
    for (const row of rows || []) {
      const nk = normalizeHubSpotFieldKey(row.name);
      if (!nk) continue;
      const val = rowValueToString(row.value);
      if (!val) continue;
      if (gapsOnly && byKey.has(nk)) continue;
      byKey.set(nk, { name: row.name, value: val });
    }
  };
  ingest(primary, false);
  ingest(fallback, true);
  return Array.from(byKey.values());
}

/** Resolved lead for agent + Slack (PARAMS + saved session leadIdentity fallback). */
function getLeadFieldsForApi() {
  let name = (PARAMS.name || '').trim();
  let email = (PARAMS.email || '').trim();
  let visitorCompany = (PARAMS.visitorCompany || '').trim();
  const reviewedCompany = (PARAMS.customerCompany || PARAMS.providerName || '').trim();

  try {
    const raw = sessionStorage.getItem(getSessionStorageKey());
    if (raw) {
      const data = JSON.parse(raw);
      const li = data.leadIdentity;
      if (li && typeof li === 'object') {
        if (!name && li.name) name = String(li.name).trim();
        if (!email && li.email) email = String(li.email).trim();
        if (!visitorCompany && li.visitorCompany) visitorCompany = String(li.visitorCompany).trim();
      }
    }
  } catch (_) { /* ignore */ }

  return {
    client_name: reviewedCompany,
    customer_name: name,
    customer_email: email,
    visitor_company: visitorCompany,
  };
}

function getNotifyLeadSnapshot() {
  const L = getLeadFieldsForApi();
  return {
    client: L.client_name || PARAMS.providerName,
    customer_name: L.customer_name || 'Unknown',
    customer_email: L.customer_email || 'Unknown',
  };
}

let hubspotFormsLoadingPromise = null;
let hubspotLeadFlowBusy = false;

function hubspotLeadModalOnEscape(e) {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('hubspot-lead-modal');
  if (!modal || modal.hasAttribute('hidden')) return;
  e.preventDefault();
  e.stopPropagation();
  hideHubSpotLeadModal();
}
function loadHubSpotFormsV2() {
  if (window.hbspt?.forms?.create) return Promise.resolve();
  if (hubspotFormsLoadingPromise) return hubspotFormsLoadingPromise;

  const existing = document.querySelector('script[src*="js.hsforms.net/forms/embed/v2.js"]');
  if (existing) {
    hubspotFormsLoadingPromise = new Promise((resolve, reject) => {
      const ready = () => {
        if (window.hbspt?.forms?.create) resolve();
        else reject(new Error('HubSpot forms API unavailable'));
      };
      if (window.hbspt?.forms?.create) {
        resolve();
        return;
      }
      if (existing.readyState === 'complete' || existing.readyState === 'loaded') {
        ready();
        return;
      }
      existing.addEventListener('load', ready);
      existing.addEventListener('error', () => reject(new Error('Failed to load HubSpot forms')));
    }).finally(() => {
      hubspotFormsLoadingPromise = null;
    });
    return hubspotFormsLoadingPromise;
  }

  hubspotFormsLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.hsforms.net/forms/embed/v2.js';
    s.charset = 'utf-8';
    s.async = true;
    s.onload = () => {
      if (window.hbspt?.forms?.create) resolve();
      else reject(new Error('HubSpot forms API missing after load'));
    };
    s.onerror = () => reject(new Error('Failed to load HubSpot forms'));
    document.head.appendChild(s);
  }).finally(() => {
    hubspotFormsLoadingPromise = null;
  });
  return hubspotFormsLoadingPromise;
}

function ensureHubSpotLeadModal() {
  let modal = document.getElementById('hubspot-lead-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hubspot-lead-modal';
    modal.className = 'hubspot-lead-modal';
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
    <button type="button" class="hubspot-lead-modal__backdrop" aria-label="Close dialog"></button>
    <div class="hubspot-lead-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="hubspot-lead-title">
      <button type="button" class="hubspot-lead-modal__close" aria-label="Close dialog">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M5 5l10 10M15 5L5 15"/>
        </svg>
      </button>
      <h2 id="hubspot-lead-title" class="hubspot-lead-modal__title">Before we continue</h2>
      <p class="hubspot-lead-modal__hint">Please share a few details so we can personalize your review and attribute your feedback correctly.</p>
      <div class="hubspot-lead-modal__form">
        <div id="hubspot-lead-proxy" class="hubspot-lead-proxy hs-form" role="form" aria-labelledby="hubspot-lead-title"></div>
        <div id="hubspot-lead-form-target" class="hubspot-lead-modal__hs-hidden" aria-hidden="true"></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
  } else {
    const dialog = modal.querySelector('.hubspot-lead-modal__dialog');
    if (dialog && !modal.querySelector('.hubspot-lead-modal__close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'hubspot-lead-modal__close';
      close.setAttribute('aria-label', 'Close dialog');
      close.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M5 5l10 10M15 5L5 15"/>
        </svg>`;
      dialog.insertBefore(close, dialog.firstChild);
    }
  }
  if (!modal.dataset.hubspotLeadDismissWired) {
    modal.dataset.hubspotLeadDismissWired = '1';
    modal.addEventListener('click', (e) => {
      if (e.target.classList.contains('hubspot-lead-modal__backdrop')) {
        e.preventDefault();
        hideHubSpotLeadModal();
      } else if (e.target.closest('.hubspot-lead-modal__close')) {
        e.preventDefault();
        hideHubSpotLeadModal();
      }
    });
  }
  return modal;
}

function showHubSpotLeadModal() {
  const modal = ensureHubSpotLeadModal();
  document.removeEventListener('keydown', hubspotLeadModalOnEscape, true);
  modal.removeAttribute('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.addEventListener('keydown', hubspotLeadModalOnEscape, true);
  document.getElementById('hubspot-lead-title')?.focus();
}

function hideHubSpotLeadModal() {
  document.removeEventListener('keydown', hubspotLeadModalOnEscape, true);
  const modal = document.getElementById('hubspot-lead-modal');
  hubspotLeadFlowBusy = false;
  if (!modal) return;
  modal.setAttribute('hidden', '');
  modal.setAttribute('aria-hidden', 'true');
}

function unwrapHubSpotFormEl($form) {
  let el = $form && $form.length != null && $form[0] ? $form[0] : $form;
  if (el && typeof el.querySelector === 'function' && el.tagName !== 'FORM') {
    const inner = el.querySelector('form.hs-form, form');
    if (inner) el = inner;
  }
  return el || null;
}

function markHubSpotFormDoNotCollect(root) {
  if (!root) return;
  const forms = root.tagName === 'FORM'
    ? [root]
    : (typeof root.querySelectorAll === 'function' ? [...root.querySelectorAll('form')] : []);
  forms.forEach((form) => {
    form.setAttribute('data-hs-do-not-collect', 'true');
    form.setAttribute('data-hs-ignore', 'true');
  });
}

const LEAD_PROXY_FIELDS = [
  { key: 'firstname', label: 'First Name', type: 'text', autocomplete: 'given-name' },
  { key: 'lastname', label: 'Last Name', type: 'text', autocomplete: 'family-name' },
  { key: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
  { key: 'company', label: 'Company Name', type: 'text', autocomplete: 'organization' },
  { key: 'website', label: 'Website', type: 'text', autocomplete: 'url' },
];

const LEAD_PROXY_FIELD_META = {
  firstname: { label: 'First Name', type: 'text', autocomplete: 'given-name' },
  lastname: { label: 'Last Name', type: 'text', autocomplete: 'family-name' },
  email: { label: 'Email', type: 'email', autocomplete: 'email' },
  company: { label: 'Company Name', type: 'text', autocomplete: 'organization' },
  website: { label: 'Website', type: 'text', autocomplete: 'url' },
  phone: { label: 'Phone', type: 'tel', autocomplete: 'tel' },
  jobtitle: { label: 'Job Title', type: 'text', autocomplete: 'organization-title' },
};

function leadProxyFieldSpec(key, hsField) {
  const k = normalizeHubSpotFieldKey(key);
  const known = LEAD_PROXY_FIELD_META[k];
  if (known) return { key: k, ...known };
  let label = '';
  if (hsField) {
    const wrap = hsField.closest('.hs-form-field');
    const el = wrap?.querySelector(':scope > label');
    label = String(el?.textContent || '').replace(/\s*\*+\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  if (!label) {
    label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return { key: k, label, type: 'text', autocomplete: 'on' };
}

function ensureLeadProxyField(spec) {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy || !spec?.key) return;
  if (proxy.querySelector(`[data-hs-field="${spec.key}"]`)) return;

  const wrap = document.createElement('div');
  wrap.className = 'hs-form-field';
  const id = `hubspot-lead-proxy-${spec.key}`;

  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = spec.label;
  const star = document.createElement('span');
  star.className = 'hs-form-required';
  star.textContent = ' *';
  label.appendChild(star);
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.id = id;
  input.className = 'hs-input';
  input.type = spec.type || 'text';
  input.required = true;
  if (spec.autocomplete) input.autocomplete = spec.autocomplete;
  if (spec.key === 'website') input.placeholder = 'https://';
  input.dataset.hsField = spec.key;
  wrap.appendChild(input);

  const actions = proxy.querySelector('.hs_submit');
  if (actions) proxy.insertBefore(wrap, actions);
  else proxy.appendChild(wrap);
}

function syncRequiredFieldsFromHubSpotForm(hsForm) {
  if (!hsForm) return;
  [...hsForm.querySelectorAll('input[name], select[name], textarea[name]')].forEach((field) => {
    const key = normalizeHubSpotFieldKey(field.name);
    if (!key || /hs_context|hutk|csrf|__hstc|__hssc|utm_/i.test(key)) return;
    const type = String(field.type || '').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
    const required = field.required || field.getAttribute('aria-required') === 'true';
    if (!required) return;
    ensureLeadProxyField(leadProxyFieldSpec(key, field));
  });
}

function setLeadProxyError(message) {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy) return;
  let el = proxy.querySelector('.hubspot-lead-modal__error');
  if (!message) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('p');
    el.className = 'hubspot-lead-modal__error';
    el.setAttribute('role', 'alert');
    proxy.insertBefore(el, proxy.firstChild);
  }
  el.textContent = message;
}

function missingFieldsFromHubSpotError(err) {
  const text = String(err && (err.message || err) || '');
  const names = [];
  const re = /fields\.([a-z0-9_]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const key = normalizeHubSpotFieldKey(m[1]);
    if (key && !names.includes(key)) names.push(key);
  }
  const extra = text.match(/not present in the form definition:\s*\[?([^\]]+)/i);
  if (extra && extra[1]) {
    extra[1].split(/[,\s]+/).forEach((raw) => {
      const key = normalizeHubSpotFieldKey(raw);
      if (key && !names.includes(key)) names.push(key);
    });
  }
  return names;
}

function hubspotErrorLooksLikeUnknownFields(err) {
  const text = String(err && (err.message || err) || '').toLowerCase();
  return /does not exist|not present in the form|not in the form/.test(text);
}

function prefillLeadProxyFromUrl() {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy) return;
  getLeadFieldsFromUrl().forEach(({ name, value }) => {
    const field = proxy.querySelector(`[data-hs-field="${name}"]`);
    if (field && value && !field.value) field.value = value;
  });
}

function scrapeLeadFieldsFromProxy() {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy) return [];
  const out = [];
  proxy.querySelectorAll('[data-hs-field]').forEach((field) => {
    const name = field.dataset.hsField;
    if (!name) return;
    const t = String(field.type || '').toLowerCase();
    if ((t === 'checkbox' || t === 'radio') && !field.checked) return;
    const value = t === 'checkbox' || t === 'radio'
      ? (field.checked ? (field.value || 'true') : '')
      : rowValueToString(field.value);
    if (!value) return;
    out.push({ name, value });
  });
  return out;
}

function leadProxyFieldsValid(proxy) {
  const fields = [...proxy.querySelectorAll('input, select, textarea')];
  for (const field of fields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function findHubSpotFieldByKey(hsForm, key) {
  if (!hsForm) return null;
  const want = normalizeHubSpotFieldKey(key);
  return [...hsForm.querySelectorAll('input[name], select[name], textarea[name]')]
    .find((el) => normalizeHubSpotFieldKey(el.name) === want) || null;
}

function copyLeadProxyToHubSpotForm(hsForm, proxy) {
  if (!hsForm || !proxy) return;
  proxy.querySelectorAll('[data-hs-field]').forEach((proxyField) => {
    const hsField = findHubSpotFieldByKey(hsForm, proxyField.dataset.hsField);
    if (!hsField) return;
    const t = String(hsField.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') {
      hsField.checked = !!proxyField.checked;
    } else {
      hsField.value = proxyField.value;
    }
    hsField.dispatchEvent(new Event('input', { bubbles: true }));
    hsField.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function hubspotFormSubmitUrl(portalId, formId, region) {
  const r = String(region || 'na1').toLowerCase();
  const host = !r || r === 'na1' ? 'https://api.hsforms.com' : `https://api-${r}.hsforms.com`;
  return `${host}/submissions/v3/integration/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formId)}`;
}

function hubspotTrackingCookie() {
  const match = document.cookie.match(/(?:^|; )hubspotutk=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Stage, Vercel previews and local dev never write to a client's HubSpot or
 * send their Slack, n8n or email notices: the form submit goes straight from
 * the browser to the client's live HubSpot, so only the page can stop it.
 * What would have gone out is logged to the console instead. Every other
 * host is production.
 */
function isTestHost(hostname) {
  const host = String(hostname == null ? window.location.hostname : hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  // Loopback includes IPv6 (::1). A miss here would post the lead form to the
  // client's live HubSpot from a local browser. Every *.vercel.app host is a
  // preview or the deployment alias, not the production custom domain.
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.startsWith('stage.') || host.endsWith('.vercel.app');
}

async function submitLeadFieldsToHubSpotApi(rows) {
  const portalId = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  const formId = String(CLIENT_CONFIG.hubspotFormId || '').trim();
  const region = String(CLIENT_CONFIG.hubspotFormRegion || 'na1').trim() || 'na1';
  if (!portalId || !formId) return false;
  if (isTestHost()) {
    console.info('[Reputation Rocket] Test host, lead form not sent to HubSpot:', rows);
    return true;
  }

  let fields = (rows || [])
    .map((row) => ({
      objectTypeId: '0-1',
      name: normalizeHubSpotFieldKey(row.name) || String(row.name || '').trim(),
      value: rowValueToString(row.value),
    }))
    .filter((row) => row.name && row.value);

  if (!fields.length) return false;

  const hutk = hubspotTrackingCookie();
  let lastError = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(hubspotFormSubmitUrl(portalId, formId, region), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields,
        context: {
          pageUri: window.location.href,
          pageName: document.title,
          ...(hutk ? { hutk } : {}),
        },
      }),
    });
    if (res.ok) return true;

    const text = await res.text();
    lastError = text || `HubSpot form submit failed (${res.status})`;
    const unknown = hubspotErrorLooksLikeUnknownFields(lastError)
      ? missingFieldsFromHubSpotError(lastError)
      : [];
    if (!unknown.length) throw new Error(lastError);

    const drop = new Set(unknown);
    const next = fields.filter((row) => !drop.has(row.name));
    if (next.length === fields.length) throw new Error(lastError);
    fields = next;
    if (!fields.length) throw new Error(lastError);
  }

  throw new Error(lastError || 'HubSpot form submit failed');
}

function finishLeadCapture(onSuccess, values) {
  const rows = values || scrapeLeadFieldsFromProxy();
  leadFields = Array.isArray(rows) ? rows.map((row) => ({
    name: String(row && row.name || ''),
    value: rowValueToString(row && row.value),
  })).filter((row) => row.name && row.value) : [];
  applyHubSpotSubmissionToParams(leadFields);
  saveSession();
  hideHubSpotLeadModal();
  if (handoffRole === 'guest' && !handoffLocked) {
    const who = [PARAMS.name, PARAMS.email].filter((part) => part && part !== 'there').join(' · ');
    if (who) setGuestStatus(`Details saved for ${who}.`);
  }
  if (typeof onSuccess === 'function') onSuccess();
}

async function submitLeadProxyToHubSpot(onSuccess) {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy || hubspotLeadFlowBusy === 'submitting') return;
  if (!leadProxyFieldsValid(proxy)) return;

  hubspotLeadFlowBusy = 'submitting';
  setLeadProxyError('');
  const values = scrapeLeadFieldsFromProxy();
  const host = document.getElementById('hubspot-lead-form-target');
  const hsForm = host ? unwrapHubSpotFormEl(host) : null;
  markHubSpotFormDoNotCollect(hsForm || host);
  copyLeadProxyToHubSpotForm(hsForm, proxy);

  try {
    await submitLeadFieldsToHubSpotApi(values);
  } catch (err) {
    console.warn('[Reputation Rocket] HubSpot form API submit failed:', err);
    const missing = missingFieldsFromHubSpotError(err);
    missing.forEach((key) => ensureLeadProxyField(leadProxyFieldSpec(key)));
    setLeadProxyError(
      missing.length
        ? `Please fill in ${missing.map((k) => leadProxyFieldSpec(k).label).join(', ')}.`
        : 'We couldn’t save your details. Check the form and try again.',
    );
    hubspotLeadFlowBusy = true;
    return;
  }

  finishLeadCapture(onSuccess, values);
}

function renderLeadProxyForm(onSuccess) {
  const proxy = document.getElementById('hubspot-lead-proxy');
  if (!proxy) return;

  proxy.innerHTML = '';
  LEAD_PROXY_FIELDS.forEach((spec) => {
    const wrap = document.createElement('div');
    wrap.className = 'hs-form-field';
    const id = `hubspot-lead-proxy-${spec.key}`;

    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = spec.label;
    const star = document.createElement('span');
    star.className = 'hs-form-required';
    star.textContent = ' *';
    label.appendChild(star);
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.id = id;
    input.className = 'hs-input';
    input.type = spec.type;
    input.required = true;
    input.autocomplete = spec.autocomplete;
    input.dataset.hsField = spec.key;
    wrap.appendChild(input);
    proxy.appendChild(wrap);
  });

  const actions = document.createElement('div');
  actions.className = 'hs_submit';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hs-button primary';
  btn.textContent = 'Continue';
  btn.addEventListener('click', () => submitLeadProxyToHubSpot(onSuccess));
  actions.appendChild(btn);
  proxy.appendChild(actions);

  if (!proxy.dataset.enterSubmitWired) {
    proxy.dataset.enterSubmitWired = '1';
    proxy.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      submitLeadProxyToHubSpot(onSuccess);
    });
  }

  prefillLeadProxyFromUrl();
  proxy.querySelector('input')?.focus();
}

async function openHubSpotLeadModalAndMountForm(onSuccess) {
  const targetSelector = '#hubspot-lead-form-target';
  showHubSpotLeadModal();
  renderLeadProxyForm(onSuccess);

  const target = document.querySelector(targetSelector);
  const portalId = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  const formId = String(CLIENT_CONFIG.hubspotFormId || '').trim();
  const region = String(CLIENT_CONFIG.hubspotFormRegion || 'na1').trim() || 'na1';

  try {
    await loadHubSpotFormsV2();
    if (target) target.innerHTML = '';
    window.hbspt.forms.create({
      portalId,
      formId,
      region,
      target: targetSelector,
      cssRequired: false,
      onFormReady: ($form) => {
        const hsForm = unwrapHubSpotFormEl($form) || target;
        markHubSpotFormDoNotCollect(hsForm);
        syncRequiredFieldsFromHubSpotForm(hsForm);
        prefillLeadProxyFromUrl();
      },
    });
  } catch (err) {
    console.warn('[Reputation Rocket] Hidden HubSpot form did not mount:', err);
  }
}

function beginSessionAfterLeadCapture() {
  sessionId = crypto.randomUUID();
  transitionTo('chat');
}

function setStartButtonBusy(busy) {
  const btn = $('#btn-start');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function startExperience() {
  if (hubspotLeadFlowBusy) return;

  // Guest sessions still collect the full HubSpot form, even when the URL
  // already has a name and email. Those two fields are not the whole form.
  if (handoffRole === 'guest' && hasHubSpotLeadFormConfigured()) {
    hubspotLeadFlowBusy = true;
    openHubSpotLeadModalAndMountForm(beginSessionAfterLeadCapture);
    return;
  }

  if (hasHubSpotLeadFormConfigured() && hasLeadCaptureFromUrl()) {
    hubspotLeadFlowBusy = 'submitting';
    setStartButtonBusy(true);
    const rows = getLeadFieldsFromUrl();
    try {
      await submitLeadFieldsToHubSpotApi(rows);
      hubspotLeadFlowBusy = false;
      setStartButtonBusy(false);
      finishLeadCapture(beginSessionAfterLeadCapture, rows);
    } catch (err) {
      console.warn('[Reputation Rocket] Silent HubSpot lead submit failed:', err);
      hubspotLeadFlowBusy = true;
      setStartButtonBusy(false);
      openHubSpotLeadModalAndMountForm(beginSessionAfterLeadCapture);
    }
    return;
  }

  if (shouldShowHubSpotLeadForm()) {
    hubspotLeadFlowBusy = true;
    openHubSpotLeadModalAndMountForm(beginSessionAfterLeadCapture);
    return;
  }

  beginSessionAfterLeadCapture();
}

// ── Chat Logic ──────────────────────────────────────────────
function initChat() {
  markHubSpotContactIncomplete();

  if (isInterviewV3()) {
    initInterviewChat();
    return;
  }

  if (chatHistory.length === 0) {
    sendMessage('Please start the review process.', true);
  }
  syncChatDraftPromptVisibility();
  if (!chatChoiceMode) maybeShowRatingButtons(latestAgentText());
  renderChatChoices();

  const chatInput = $('#chat-input');
  if (chatInput && !chatChoiceHidesInput() && !isChatDraftPromptVisible()) {
    chatInput.focus();
  }
}

// ── Interview V3: the page asks, the writer agent drafts ────
// CLIENT_CONFIG.interview = { version: 3, steps, lowRating } turns this on.
// The page asks every question itself: taps, the 5-star question, the stars,
// then open questions with one follow-up. All the answers go to the writer
// agent in ONE request, and it returns the same <drafts> block the rest of the
// portal uses. Under the lowRating threshold nothing goes to the agent: the
// review is saved and the chat ends on the negative screen. Clients without
// the block keep the V1 agent chat.

const INTERVIEW_WRITER_AGENT = 'reputation-rocket-writer';
const INTERVIEW_TYPING_MS = 450;
const INTERVIEW_WRITER_TIMEOUT_MS = 90000;

function interviewConfig() {
  const cfg = CLIENT_CONFIG.interview;
  return cfg && Number(cfg.version) === 3 && Array.isArray(cfg.steps) && cfg.steps.length ? cfg : null;
}

function isInterviewV3() {
  return Boolean(interviewConfig());
}

function ensureInterviewState() {
  if (!interviewState || typeof interviewState !== 'object') {
    interviewState = { step: 0, answers: {}, partial: {}, pending: '', done: false, writerSessionId: '' };
  }
  if (!interviewState.answers || typeof interviewState.answers !== 'object') interviewState.answers = {};
  if (!interviewState.partial || typeof interviewState.partial !== 'object') interviewState.partial = {};
  return interviewState;
}

/** A step whose skipIf matches earlier answers is not asked: a yes to "publish as a 5-star rating" skips the stars. */
function interviewStepSkipped(step, answers) {
  const rule = step && step.skipIf;
  if (!rule || typeof rule !== 'object') return false;
  const keys = Object.keys(rule);
  if (!keys.length) return false;
  return keys.every((key) => (answers || {})[key] === rule[key]);
}

function interviewWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** One line, so an answer cannot add a fake Q: or A: line to the writer prompt. */
function interviewOneLine(text, max = 4000) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A whole-number 1 to 5 the customer actually gave, or null. Never invent a 5. */
function interviewRecordedRating(answers) {
  const n = Number(answers && answers.rating);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * Resume of the star step. A recorded rating is not asked again: re-asking it
 * let a reload during the reach-out reply change an under-5 into a publishable 5.
 * '' means ask the step. 'lowRating' means the reach-out question is still open.
 */
function interviewResumeAction(step, answers, lowRating) {
  if (!step || step.type !== 'stars') return '';
  const rating = answers ? answers[step.id] : null;
  if (rating == null || rating === '') return '';
  if (interviewRatingGated(rating, lowRating) && !(answers && answers.reachOut)) return 'lowRating';
  return 'skip';
}

/** Closing line for a held review. A "no" must not promise that someone will call. */
function interviewLowRatingClosing(lowRating, answers) {
  const low = lowRating || {};
  const declined = !!(answers && answers.reachOut === 'no');
  return String((declined ? low.savedDeclined : low.saved) || '').trim();
}

/** A short answer and its follow-up stay two sentences, not one run-on. */
function interviewJoinFollowUp(first, second) {
  let a = String(first || '').trim();
  const b = String(second || '').trim();
  if (!a) return b;
  if (!b) return a;
  a = a.replace(/[,;:]+$/, '');
  if (!/[.!?]$/.test(a)) a += '.';
  return `${a} ${b}`;
}

/** Under the threshold with gate on: no drafts and no review links. A skipped rating is not a number. */
function interviewRatingGated(rating, lowRating) {
  if (!lowRating || !lowRating.gate) return false;
  const n = Number(rating);
  const below = lowRating.below == null ? 5 : Number(lowRating.below);
  return n >= 1 && n < below;
}

function interviewOption(step, id) {
  const options = step && Array.isArray(step.options) ? step.options : [];
  return options.find((o) => o && o.id === id) || null;
}

/** Their taps as the phrases a draft may use: one "label: value" line per tap step they answered. */
function interviewTapLines(cfg, answers) {
  const a = answers || {};
  const lines = [];
  ((cfg && cfg.steps) || [])
    .filter((s) => (s.type === 'single' || s.type === 'multi') && s.promptLabel)
    .forEach((s) => {
      const ids = s.type === 'multi' ? (Array.isArray(a[s.id]) ? a[s.id] : []) : [a[s.id]].filter(Boolean);
      const values = ids.map((id) => {
        const o = interviewOption(s, id);
        if (!o) return '';
        return o.firstSystem ? 'first system' : String(o.phrase || o.label || '').trim();
      }).filter(Boolean);
      const own = interviewOneLine(a[`${s.id}Other`]);
      if (own) values.push(`(own words) ${own}`);
      if (values.length) lines.push(`${s.promptLabel}: ${values.join('; ')}`);
    });
  return lines;
}

function interviewTextAnswer(step, answers) {
  const text = interviewOneLine((answers || {})[step.id]);
  if (text) return text;
  const label = interviewOneLine(step && step.skipLabel);
  return label && label !== 'Skip' ? `(chose: ${label})` : '(skipped)';
}

/** Drafts the writer may return: only this portal's platforms, in portal order. */
function interviewKeepDrafts(parsed, platforms) {
  const out = {};
  const list = Array.isArray(platforms) ? platforms : [];
  list.forEach((platform) => {
    const key = String(platform || '').trim().toLowerCase();
    if (!key || Object.prototype.hasOwnProperty.call(out, key)) return;
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, key)) return;
    const text = String(parsed[key]).trim();
    if (text) out[key] = text;
  });
  return out;
}

/**
 * The one message the writer agent gets: the rating, the taps and their own
 * words. Client name, platforms and review links travel in `config`.
 */
function buildInterviewWriterPrompt(cfg, answers) {
  const a = answers || {};
  const rating = interviewRecordedRating(a);
  const agreedFive = a.fiveStar === 'yes' && (rating == null || rating === 5);
  const shown = rating != null ? rating : (a.fiveStar === 'yes' ? 5 : null);
  let ratingLine = 'RATING: (missing)';
  if (shown != null && agreedFive && shown === 5) {
    ratingLine = 'RATING: 5 (they agreed to publish their review as a 5-star rating)';
  } else if (shown != null) {
    ratingLine = `RATING: ${shown}`;
  }
  const lines = [ratingLine, '', 'TAPPED'];
  const taps = interviewTapLines(cfg, a);
  if (taps.length) taps.forEach((line) => lines.push(`- ${line}`));
  else lines.push('- (nothing tapped)');
  lines.push('', 'THEIR WORDS');
  ((cfg && cfg.steps) || []).filter((s) => s.type === 'text').forEach((s) => {
    lines.push(`Q: ${interviewOneLine(s.ask)}`, `A: ${interviewTextAnswer(s, a)}`);
  });
  return lines.join('\n');
}

/** negative_flag for a V3 review under the threshold. Slack and email print the first 6 answers, so the useful ones go first. */
function buildInterviewNegativeFlag(cfg, answers, lead) {
  const a = answers || {};
  const steps = (cfg && cfg.steps) || [];
  const low = (cfg && cfg.lowRating) || {};
  const rating = interviewRecordedRating(a);
  const stars = steps.find((s) => s.type === 'stars');
  const responses = [{
    question: stars ? interviewOneLine(stars.ask) : 'Rating',
    answer: rating ? `${rating} star${rating === 1 ? '' : 's'}` : '(skipped)',
  }];
  const reach = (low.options || []).find((o) => o && o.id === a.reachOut);
  if (reach) responses.push({ question: 'May we reach out?', answer: reach.label });
  steps.filter((s) => s.type === 'text').forEach((s) => {
    responses.push({ question: interviewOneLine(s.ask), answer: interviewTextAnswer(s, a) });
  });
  const taps = interviewTapLines(cfg, a);
  if (taps.length) responses.push({ question: 'Their taps', answer: taps.join(' | ') });
  const info = lead || {};
  return {
    severity: rating != null && rating <= 2 ? 'high' : rating === 3 ? 'medium' : 'low',
    customer_name: info.customer_name || '',
    customer_email: info.customer_email || '',
    client_name: info.client_name || '',
    rating,
    survey_responses: responses,
    key_concerns: [],
    suggested_actions: reach && reach.id === 'yes'
      ? ['They said yes to a follow-up. Reach out before anything gets posted.']
      : reach && reach.id === 'no'
        ? ['They asked not to be contacted. Nothing was posted.']
        : [],
  };
}

function interviewEl(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (children || []).forEach((child) => { if (child) node.appendChild(child); });
  return node;
}

function interviewPause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function interviewSay(text) {
  const t = String(text || '').trim();
  if (!t) return;
  showTypingIndicator(true);
  await interviewPause(INTERVIEW_TYPING_MS);
  showTypingIndicator(false);
  addChatBubble('agent', t);
  chatHistory.push({ role: 'agent', content: t });
  agentMessageCount += 1;
  saveSession();
}

/** Asks once: after a reload the question is already the last thing in the chat. */
async function interviewAsk(text) {
  const t = String(text || '').trim();
  const last = chatHistory[chatHistory.length - 1];
  if (last && last.role === 'agent' && last.content === t) return;
  await interviewSay(t);
}

function interviewUserSay(text) {
  const t = String(text || '').trim();
  if (!t) return;
  addChatBubble('user', t);
  chatHistory.push({ role: 'user', content: t });
}

function setInterviewInputMode(mode) {
  interviewInputMode = mode;
  if (mode !== 'choices') document.getElementById('interview-choices')?.remove();
  if (mode !== 'text') {
    interviewTextStep = null;
    document.getElementById('interview-text-tools')?.remove();
  }
  syncChatComposerState();
}

/** The choices sit in the chat, right under their question, and scroll with it. */
function interviewChoiceBox(label) {
  document.getElementById('interview-choices')?.remove();
  const box = interviewEl('div', { id: 'interview-choices', class: 'interview-choices', role: 'group', 'aria-label': label });
  $('#chat-messages').appendChild(box);
  return box;
}

/** Keep the question in view when it and its choices don't both fit, then focus the first choice. */
function revealInterviewChoices(box) {
  requestAnimationFrame(() => {
    const messages = $('#chat-messages');
    if (!messages || !box.isConnected) return;
    const row = box.previousElementSibling;
    const base = messages.getBoundingClientRect().top - messages.scrollTop;
    const top = (row || box).getBoundingClientRect().top - base - 12;
    const bottom = box.getBoundingClientRect().bottom - base + 20 - messages.clientHeight;
    messages.scrollTop = Math.max(0, Math.min(top, bottom));
    const first = box.querySelector('button:not([disabled]), input:not([hidden])');
    if (first) first.focus({ preventScroll: true });
  });
}

function interviewActions(left, right) {
  return interviewEl('div', { class: 'interview-choice-actions' }, [
    interviewEl('div', {}, left),
    interviewEl('div', {}, right),
  ]);
}

function interviewChip(label, multi, attrs, onClick) {
  const chip = interviewEl('button', Object.assign({
    type: 'button',
    class: `interview-chip${multi ? '' : ' interview-chip--single'}`,
    'aria-pressed': 'false',
  }, attrs), [
    interviewEl('span', { class: 'interview-chip-box', 'aria-hidden': 'true' }),
    interviewEl('span', { text: label }),
  ]);
  chip.addEventListener('click', () => onClick(chip));
  return chip;
}

// Single and multi-select taps, with optional own words and Skip. Own words
// count toward the step's max, so nothing typed gets dropped.
function renderInterviewChoices(step, multi) {
  setInterviewInputMode('choices');
  const st = ensureInterviewState();
  const box = interviewChoiceBox(step.ask);
  const picked = new Set();
  const max = multi ? step.max || Infinity : 1;
  const min = step.min == null ? 1 : step.min;
  const grid = interviewEl('div', { class: 'interview-chip-grid' });
  const own = interviewEl('input', {
    class: 'interview-own-input', type: 'text', placeholder: 'In your own words',
    'aria-label': 'In your own words', maxlength: '120', hidden: true,
  });
  const hintText = step.max ? `Pick up to ${step.max}` : 'Pick all that apply';
  const hint = multi ? interviewEl('span', { class: 'interview-choice-hint', text: hintText }) : null;
  const cont = interviewEl('button', { type: 'button', class: 'btn btn-primary btn-md', disabled: true, text: 'Continue' });
  const ownOpen = () => !own.hidden;
  const ownText = () => (ownOpen() ? own.value.trim() : '');
  const used = () => picked.size + (ownOpen() ? 1 : 0);
  const sync = () => {
    const count = picked.size + (ownText() ? 1 : 0);
    // Continue means at least one answer. Skip is the way to leave a step blank.
    cont.disabled = multi ? count < Math.max(min, 1) : !ownText();
  };
  const flashLimit = () => {
    if (!hint) return;
    hint.textContent = `Up to ${step.max}. Unpick one first.`;
    hint.classList.add('is-flash');
  };
  const clearFlash = () => {
    if (!hint) return;
    hint.textContent = hintText;
    hint.classList.remove('is-flash');
  };
  const submit = (ids, text) => {
    st.answers[step.id] = multi ? ids : ids[0] || null;
    if (text) st.answers[`${step.id}Other`] = text;
    else delete st.answers[`${step.id}Other`];
    const labels = ids.map((id) => (interviewOption(step, id) || {}).label).filter(Boolean).concat(text ? [text] : []);
    setInterviewInputMode('none');
    interviewUserSay(labels.length ? labels.join(', ') : 'Skip');
    nextInterviewStep();
  };

  (step.options || []).forEach((o) => {
    grid.appendChild(interviewChip(o.label, multi, { 'data-option': o.id }, (chip) => {
      if (!multi) {
        submit([o.id], '');
        return;
      }
      if (picked.has(o.id)) picked.delete(o.id);
      else if (used() < max) picked.add(o.id);
      else {
        flashLimit();
        return;
      }
      clearFlash();
      chip.setAttribute('aria-pressed', String(picked.has(o.id)));
      sync();
    }));
  });
  if (step.ownWords) {
    const ghostClass = `interview-chip interview-chip--ghost${multi ? '' : ' interview-chip--single'}`;
    grid.appendChild(interviewChip('Something else', multi, { class: ghostClass, 'data-option': 'other' }, (chip) => {
      if (!ownOpen() && multi && used() >= max) {
        flashLimit();
        return;
      }
      own.hidden = ownOpen();
      if (own.hidden) own.value = '';
      chip.setAttribute('aria-pressed', String(ownOpen()));
      if (!multi) cont.hidden = !ownOpen();
      if (ownOpen()) own.focus();
      sync();
    }));
  }
  own.addEventListener('input', sync);
  own.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !cont.disabled) cont.click();
  });
  cont.addEventListener('click', () => submit(multi ? [...picked] : [], ownText()));

  const right = [];
  if (step.skip) {
    const skip = interviewEl('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: 'Skip' });
    skip.addEventListener('click', () => submit([], ''));
    right.push(skip);
  }
  if (multi || step.ownWords) right.push(cont);
  if (!multi) cont.hidden = true;

  box.appendChild(interviewEl('div', { class: 'interview-choice-scroll' }, [grid, own]));
  box.appendChild(interviewActions(hint ? [hint] : [], right));
  sync();
  revealInterviewChoices(box);
}

function renderInterviewStars(step) {
  setInterviewInputMode('choices');
  const st = ensureInterviewState();
  const box = interviewChoiceBox('Your rating from 1 to 5');
  const row = interviewEl('div', { class: 'rating-choice-row' });
  [1, 2, 3, 4, 5].forEach((n) => {
    const btn = interviewEl('button', {
      type: 'button', class: 'rating-choice', 'data-rating': String(n),
      'aria-label': `${n} star${n === 1 ? '' : 's'}`,
    });
    btn.innerHTML = `<span class="rating-choice-num">${n}</span>${ratingStarIcon()}`;
    btn.addEventListener('click', () => {
      st.answers[step.id] = n;
      setInterviewInputMode('none');
      interviewUserSay(`${n} star${n === 1 ? '' : 's'}`);
      if (interviewRatingGated(n, interviewConfig().lowRating)) runInterviewLowRating();
      else nextInterviewStep();
    });
    row.appendChild(btn);
  });
  box.appendChild(row);
  box.appendChild(interviewEl('div', { class: 'rating-choice-legend', 'aria-hidden': 'true' }, [
    interviewEl('span', { text: 'Poor' }),
    interviewEl('span', { text: 'Excellent' }),
  ]));
  // Without `skip` (after a no to 5 stars) the under-5 check always gets a number.
  if (step.skip) {
    const skip = interviewEl('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: 'Skip' });
    skip.addEventListener('click', () => {
      st.answers[step.id] = null;
      setInterviewInputMode('none');
      interviewUserSay('Skip');
      nextInterviewStep();
    });
    box.appendChild(interviewActions([], [skip]));
  }
  revealInterviewChoices(box);
}

// Under the threshold: offer to reach out first, then finish the questions.
// The chat then ends on the negative screen with no drafts (finishInterview).
async function runInterviewLowRating() {
  const low = interviewConfig().lowRating || {};
  const st = ensureInterviewState();
  st.pending = 'lowRating';
  saveSession();
  await interviewAsk(low.ask);
  setInterviewInputMode('choices');
  const box = interviewChoiceBox(low.ask);
  const grid = interviewEl('div', { class: 'interview-chip-grid' });
  (low.options || []).forEach((o) => {
    grid.appendChild(interviewChip(o.label, false, { 'data-option': o.id }, async () => {
      // Move past the stars before the reply is spoken. A reload in that pause
      // used to land back on the stars and let an under-5 become a 5.
      if (st.pending !== 'lowRating') return;
      st.answers.reachOut = o.id;
      st.pending = '';
      const nextIndex = (Number.isInteger(st.step) ? st.step : 0) + 1;
      st.step = nextIndex;
      setInterviewInputMode('none');
      interviewUserSay(o.label);
      saveSession();
      if (o.reply) await interviewSay(o.reply);
      runInterviewStep(nextIndex);
    }));
  });
  box.appendChild(interviewEl('div', { class: 'interview-choice-scroll' }, [grid]));
  revealInterviewChoices(box);
}

// Open questions use the chat's own text box (and its mic). followUp: one
// friendly nudge when the first answer is very short.
function renderInterviewText(step, isFollowUp) {
  setInterviewInputMode('text');
  const skipLabel = isFollowUp
    ? (step.followUp && step.followUp.skipLabel) || "That's it"
    : step.skipLabel || 'Skip';
  interviewTextStep = {
    step,
    isFollowUp,
    placeholder: isFollowUp ? 'Add one more sentence, or leave it here' : 'Type your answer, or skip',
  };
  const inputBar = $('.chat-input-bar');
  if (inputBar) {
    const tools = interviewEl('div', { id: 'interview-text-tools', class: 'interview-text-tools' });
    const skip = interviewEl('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: skipLabel });
    skip.addEventListener('click', () => finishInterviewText('', skipLabel));
    tools.appendChild(skip);
    inputBar.insertBefore(tools, inputBar.firstChild);
  }
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    resizeChatInput();
  }
  syncChatComposerState();
  if (input) input.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const messages = $('#chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
}

function finishInterviewText(text, label) {
  const current = interviewTextStep;
  if (!current) return;
  const { step, isFollowUp } = current;
  const st = ensureInterviewState();
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    resizeChatInput();
  }
  setInterviewInputMode('none');
  interviewUserSay(label || text);
  const followUp = step.followUp;
  const minWords = followUp && followUp.minWords == null ? 8 : followUp && followUp.minWords;
  if (followUp && !isFollowUp && text && interviewWordCount(text) < minWords) {
    st.partial[step.id] = text;
    saveSession();
    interviewAsk(followUp.ask).then(() => renderInterviewText(step, true));
    return;
  }
  const first = st.partial[step.id];
  delete st.partial[step.id];
  st.answers[step.id] = interviewJoinFollowUp(first, text);
  nextInterviewStep();
}

async function runInterviewStep(index) {
  const cfg = interviewConfig();
  const st = ensureInterviewState();
  st.step = index;
  const step = cfg.steps[index];
  if (!step) {
    finishInterview();
    return;
  }
  if (interviewStepSkipped(step, st.answers)) {
    if (step.skipValue !== undefined) st.answers[step.id] = step.skipValue;
    runInterviewStep(index + 1);
    return;
  }
  const resume = interviewResumeAction(step, st.answers, cfg.lowRating);
  if (resume === 'lowRating') {
    runInterviewLowRating();
    return;
  }
  if (resume === 'skip') {
    runInterviewStep(index + 1);
    return;
  }
  saveSession();
  // A reload during the follow-up picks up at the follow-up.
  if (step.type === 'text' && step.followUp && st.partial[step.id]) {
    await interviewAsk(step.followUp.ask);
    renderInterviewText(step, true);
    return;
  }
  await interviewAsk(step.ask);
  if (step.type === 'multi') renderInterviewChoices(step, true);
  else if (step.type === 'single') renderInterviewChoices(step, false);
  else if (step.type === 'stars') renderInterviewStars(step);
  else if (step.type === 'text') renderInterviewText(step, false);
  else runInterviewStep(index + 1);
}

function nextInterviewStep() {
  runInterviewStep(ensureInterviewState().step + 1);
}

async function finishInterview() {
  const cfg = interviewConfig();
  const st = ensureInterviewState();
  if (!cfg || st.done) return;
  setInterviewInputMode('none');
  const rating = interviewRecordedRating(st.answers);
  if (rating != null) agentRating = rating;
  if (interviewRatingGated(st.answers.rating, cfg.lowRating)) {
    st.done = true;
    const saved = interviewLowRatingClosing(cfg.lowRating, st.answers);
    // The negative screen shows this as its closing line.
    lastAgentMessage = saved;
    negativeFlagData = buildInterviewNegativeFlag(cfg, st.answers, getLeadFieldsForApi());
    saveSession();
    if (saved) await interviewSay(saved);
    setTimeout(() => transitionTo('negative'), 2500);
    return;
  }
  if (rating == null) {
    saveSession();
    showInterviewDraftError('Something went wrong saving your rating.', { retry: false });
    return;
  }
  st.done = true;
  saveSession();
  if (cfg.writingMessage) await interviewSay(cfg.writingMessage);
  requestInterviewDrafts();
}

async function requestInterviewDrafts() {
  if (isWaitingForAgent) return;
  const cfg = interviewConfig();
  const st = ensureInterviewState();
  if (!cfg || interviewRatingGated(st.answers.rating, cfg.lowRating) || interviewRecordedRating(st.answers) == null) return;
  isWaitingForAgent = true;
  syncChatComposerState();
  // A fresh writer session each try: a reused id would replay the last attempt.
  st.writerSessionId = crypto.randomUUID();
  saveSession();
  showTypingIndicator(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTERVIEW_WRITER_TIMEOUT_MS);
  try {
    const L = getLeadFieldsForApi();
    const res = await fetchWithStickyRetry({
      prompt: buildInterviewWriterPrompt(cfg, st.answers),
      agent: INTERVIEW_WRITER_AGENT,
      session_id: st.writerSessionId,
      config: {
        client_name: L.client_name,
        customer_name: L.customer_name,
        customer_email: L.customer_email,
        platforms: PARAMS.platforms,
        review_links: PARAMS.reviewLinks,
      },
    }, controller.signal);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    if (data.machine_id) machineId = data.machine_id;
    const match = String(data.result || '').match(/<drafts>([\s\S]*?)<\/drafts>/);
    const parsed = interviewKeepDrafts(match ? parseDraftsBlock(match[1]) : {}, PARAMS.platforms);
    if (!Object.keys(parsed).length) throw new Error('No drafts in the reply');
    drafts = parsed;
    activeDraftPlatform = Object.keys(drafts)[0];
    reviewDraft = drafts[activeDraftPlatform];
    draftLooksGood = {};
    showTypingIndicator(false);
    renderChatDraftPrompt();
    setChatDraftPromptVisible(true);
  } catch (err) {
    showTypingIndicator(false);
    console.warn('[Reputation Rocket] Writer request failed:', err);
    showInterviewDraftError(err && err.name === 'AbortError'
      ? 'Writing your drafts took too long.'
      : 'Something went wrong writing your drafts.');
  } finally {
    clearTimeout(timeout);
    isWaitingForAgent = false;
    syncChatComposerState();
    saveSession();
  }
}

function showInterviewDraftError(message, options) {
  const messages = $('#chat-messages');
  if (!messages) return;
  messages.querySelectorAll('.chat-error').forEach((el) => el.remove());
  const retryable = !options || options.retry !== false;
  const box = interviewEl('div', { class: 'chat-error' }, [
    interviewEl('span', { text: `${message} Your answers are saved.` }),
  ]);
  if (retryable) {
    const retry = interviewEl('button', { type: 'button', text: 'Retry' });
    retry.addEventListener('click', () => {
      box.remove();
      requestInterviewDrafts();
    });
    box.appendChild(retry);
  }
  messages.appendChild(box);
  messages.scrollTop = messages.scrollHeight;
}

function initInterviewChat() {
  const st = ensureInterviewState();
  syncChatDraftPromptVisibility();
  if (Object.keys(drafts || {}).length) {
    syncChatComposerState();
    return;
  }
  if (st.done) {
    if (interviewRatingGated(st.answers.rating, interviewConfig().lowRating)) {
      // Reloaded between the closing line and the negative screen.
      setTimeout(() => transitionTo('negative'), 0);
      return;
    }
    if (interviewRecordedRating(st.answers) == null) {
      showInterviewDraftError('Something went wrong saving your rating.', { retry: false });
      return;
    }
    requestInterviewDrafts();
    return;
  }
  if (st.pending === 'lowRating') {
    runInterviewLowRating();
    return;
  }
  runInterviewStep(Number(st.step) || 0);
}

// ── Tap-to-answer rating (star buttons + 4-star choice) ─────
// Handled entirely by the page: the assistant only ever receives the final
// whole-number rating. A tapped 4 never reaches it; the customer picks 5
// (public review) or 3 (private feedback) first, and the assistant runs its
// normal path for that number.

function isRatingButtonsEnabled() {
  return CLIENT_CONFIG.ratingButtons === true;
}

function isMurkyMiddleEnabled() {
  return CLIENT_CONFIG.murkyMiddle === true;
}

function isChatChoiceActive() {
  if (chatChoiceMode === 'stars') return isRatingButtonsEnabled();
  if (chatChoiceMode === 'murky' || chatChoiceMode === 'murky-feedback') {
    return isRatingButtonsEnabled() && isMurkyMiddleEnabled();
  }
  return false;
}

/** Choice modes that replace the text box entirely (the feedback step keeps it). */
function chatChoiceHidesInput() {
  // V3 shows the text box only for its open questions.
  if (isInterviewV3()) return interviewInputMode !== 'text';
  return isChatChoiceActive() && chatChoiceMode !== 'murky-feedback';
}

function looksLikeRatingQuestion(text) {
  const t = String(text || '').toLowerCase();
  return /\brat(e|ing)\b/.test(t) && /\b1\b/.test(t) && /\b5\b/.test(t);
}

function customerAnswerCount() {
  return chatHistory.filter((m) => m && m.role === 'user').length;
}

function latestAgentText() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    if (msg && msg.role === 'agent' && String(msg.content || '').trim()) {
      return String(msg.content);
    }
  }
  return lastAgentMessage || '';
}

/** Only 3 or 5, plus a clipped string feedback field. Anything else is dropped. */
function normalizeMurkyMiddle(value) {
  if (!value || typeof value !== 'object') return null;
  const chose = Number(value.chose);
  if (chose !== 5 && chose !== 3) return null;
  const feedback = typeof value.feedback === 'string'
    ? value.feedback.slice(0, MURKY_FEEDBACK_MAX_CHARS)
    : '';
  const supportHandled = value.supportHandled === true || (chose === 5 && Boolean(feedback));
  return { chose, feedback, supportHandled };
}

const MURKY_MIDDLE_MESSAGE =
  "Thank you for your 4-star rating. We've found that 4 stars is often the murky middle. " +
  'Would you prefer to leave a 3-star rating that goes to our support team, or a 5-star review ' +
  'about the best parts of your experience, with any feedback also shared with our support team?';

const MURKY_CHOICE_LABELS = {
  5: 'Leave a 5-star review',
  3: 'Send a 3-star rating to our support team',
};

// Picking 5 after a 4 promises "any feedback also shared with our support
// team". Order (Tonya, 9/30): the 5-star review questions come first; the
// review flow's closing improvements question is then shown as the support
// question below. Its answer still goes to the assistant (G2/Gartner ask
// what could be better, so the drafts need it) and is ALSO sent straight to
// the client's support flow the moment it is given, so it is never lost if
// the customer leaves before the final screen.
const MURKY_IMPROVE_QUESTION =
  "Thank you! Before you go, is there anything we could improve or do better? " +
  "We'll share your feedback with our support team.";
const MURKY_FEEDBACK_SKIP_LABEL = 'Nothing to add';
const MURKY_FEEDBACK_PLACEHOLDER = 'Type your feedback...';
const MURKY_FEEDBACK_MAX_CHARS = 2000;

/** The review flow's closing improvements question (Q5), in any phrasing the agent uses. */
function isImprovementQuestion(text) {
  const t = String(text || '');
  return (
    /\bremove friction\b/i.test(t)
    || /\bimprove the experience\b/i.test(t)
    || /put ["']?no["']? if nothing/i.test(t)
    || /\banything we could improve\b/i.test(t)
    || /\banything we could do better\b/i.test(t)
    || /\bwhere could we improve\b/i.test(t)
    || /\bwhat could (?:we |be )(?:improve|better)/i.test(t)
  );
}

function murkySupportAlreadyHandled() {
  const state = normalizeMurkyMiddle(murkyMiddle);
  return !!(state && state.supportHandled);
}

function markMurkySupportHandled(feedback) {
  const kept = keptMurkySupportFeedback(
    feedback == null ? (murkyMiddle && murkyMiddle.feedback) : feedback,
  );
  murkyMiddle = { chose: 5, feedback: kept, supportHandled: true };
}

/** Rating-button or 4-star-choice labels — the turn before the first review question. */
function isRatingOrChoiceAnswer(text) {
  const t = String(text || '');
  if (t === MURKY_CHOICE_LABELS[5] || t === MURKY_CHOICE_LABELS[3]) return true;
  return /^[1-5] stars?$/.test(t);
}

function isMurkyFiveSession() {
  if (!isRatingButtonsEnabled() || !isMurkyMiddleEnabled()) return false;
  const state = normalizeMurkyMiddle(murkyMiddle);
  return !!state && state.chose === 5;
}

// Jonathan, 9/30: after a 4 -> 5 choice, say we'll draft their review
// instead of the agent's "That's wonderful to hear!" (which reads as fake
// for someone who just told us 4).
const MURKY_REVIEW_INTRO = "Great, we'll draft your 5-star review. First, a few quick questions.";

function firstCustomerAnswer() {
  const first = chatHistory.find((m) => m && m.role === 'user');
  return first ? String(first.content || '') : '';
}

function lastCustomerAnswer() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i] && chatHistory[i].role === 'user') return String(chatHistory[i].content || '');
  }
  return '';
}

/** Tapped 5 on the star buttons (not via the 4-star choice). */
function isDirectFiveSession() {
  if (!isRatingButtonsEnabled() || normalizeMurkyMiddle(murkyMiddle)) return false;
  return ratedDirectFive || firstCustomerAnswer() === '5 stars';
}

/** Drop the agent's leading acknowledgment; keep from the first question on. */
function questionPart(text) {
  const sentences = String(text || '').replace(/([.!?])\s+/g, '$1\u0000').split('\u0000');
  const idx = sentences.findIndex((part) => part.includes('?'));
  return idx >= 0 ? sentences.slice(idx).join(' ').trim() : String(text || '').trim();
}

function ratingStarIcon() {
  return '<svg class="rating-choice-star" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><polygon fill="currentColor" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
}

function ensureChatChoiceBar() {
  let bar = document.getElementById('chat-choice-bar');
  if (bar) return bar;
  const inputBar = $('.chat-input-bar');
  if (!inputBar || !inputBar.parentNode) return null;
  bar = document.createElement('div');
  bar.id = 'chat-choice-bar';
  bar.className = 'chat-choice-bar';
  bar.hidden = true;
  inputBar.parentNode.insertBefore(bar, inputBar);
  return bar;
}

function renderChatChoices() {
  const bar = ensureChatChoiceBar();
  if (!bar) return;

  if (!isChatChoiceActive()) {
    bar.hidden = true;
    bar.innerHTML = '';
    syncChatComposerState();
    return;
  }

  if (chatChoiceMode === 'stars') {
    const buttons = [1, 2, 3, 4, 5]
      .map((n) => `
        <button type="button" class="rating-choice" data-rating="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">
          <span class="rating-choice-num">${n}</span>${ratingStarIcon()}
        </button>`)
      .join('');
    bar.innerHTML = `
      <div class="rating-choice-row" role="group" aria-label="Your rating from 1 to 5">${buttons}</div>
      <div class="rating-choice-legend" aria-hidden="true"><span>Poor</span><span>Excellent</span></div>`;
    bar.querySelectorAll('[data-rating]').forEach((btn) => {
      btn.addEventListener('click', () => handleRatingTap(Number(btn.dataset.rating)));
    });
  } else if (chatChoiceMode === 'murky') {
    bar.innerHTML = `
      <div class="murky-choice" role="group" aria-label="Choose your rating">
        <button type="button" class="btn btn-primary btn-md" data-murky="5">${escapeHtml(MURKY_CHOICE_LABELS[5])}</button>
        <button type="button" class="btn btn-secondary btn-md" data-murky="3">${escapeHtml(MURKY_CHOICE_LABELS[3])}</button>
      </div>`;
    bar.querySelectorAll('[data-murky]').forEach((btn) => {
      btn.addEventListener('click', () => handleMurkyChoice(Number(btn.dataset.murky)));
    });
  } else if (chatChoiceMode === 'murky-feedback') {
    bar.innerHTML = `
      <div class="murky-choice murky-feedback" role="group" aria-label="Feedback for our support team">
        <button type="button" class="btn btn-secondary btn-md" data-murky-skip>${escapeHtml(MURKY_FEEDBACK_SKIP_LABEL)}</button>
      </div>`;
    bar.querySelector('[data-murky-skip]')?.addEventListener('click', () => handleMurkyFeedback(''));
  }

  bar.hidden = false;
  syncChatComposerState();
  const messages = $('#chat-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function handleRatingTap(n) {
  if (isWaitingForAgent || chatChoiceMode !== 'stars') return;
  if (!Number.isInteger(n) || n < 1 || n > 5) return;

  // Lock first so a double-tap cannot add a second bubble or send twice.
  chatChoiceMode = null;
  renderChatChoices();

  const label = `${n} star${n === 1 ? '' : 's'}`;
  addChatBubble('user', label);
  chatHistory.push({ role: 'user', content: label });
  if (n === 5) ratedDirectFive = true;

  if (n === 4 && isMurkyMiddleEnabled()) {
    addChatBubble('agent', MURKY_MIDDLE_MESSAGE);
    chatHistory.push({ role: 'agent', content: MURKY_MIDDLE_MESSAGE });
    chatChoiceMode = 'murky';
    renderChatChoices();
    saveSession();
    return;
  }

  saveSession();
  sendMessage(String(n), true);
}

function handleMurkyChoice(choice) {
  if (isWaitingForAgent || chatChoiceMode !== 'murky') return;
  if (choice !== 5 && choice !== 3) return;

  chatChoiceMode = null;
  renderChatChoices();

  const label = MURKY_CHOICE_LABELS[choice];
  addChatBubble('user', label);
  chatHistory.push({ role: 'user', content: label });
  murkyMiddle = { chose: choice, feedback: '', supportHandled: false };
  saveSession();
  sendMessage(String(choice), true);
}

/**
 * Answer to the support question at the end of the 4 -> 5 review flow.
 * Empty = "Nothing to add". The answer goes to the assistant as the review
 * flow's improvements answer (drafts need it) and, when it is real feedback,
 * straight to the client's support flow.
 */
function handleMurkyFeedback(text) {
  if (isWaitingForAgent || chatChoiceMode !== 'murky-feedback') return;
  const feedback = String(text || '').trim().slice(0, MURKY_FEEDBACK_MAX_CHARS);

  // Lock first so a second Enter/click cannot send twice.
  chatChoiceMode = null;
  const input = $('#chat-input');
  if (input) input.value = '';
  renderChatChoices();

  const kept = keptMurkySupportFeedback(feedback);
  markMurkySupportHandled(kept);
  saveSession();

  if (feedback) {
    sendMessage(feedback);
  } else {
    addChatBubble('user', MURKY_FEEDBACK_SKIP_LABEL);
    chatHistory.push({ role: 'user', content: MURKY_FEEDBACK_SKIP_LABEL });
    sendMessage('no', true);
  }
  if (kept) sendLifecycleNotification('support_feedback');
}

/** Show the star buttons when the assistant has just asked the rating question. */
function maybeShowRatingButtons(agentText) {
  if (!isRatingButtonsEnabled()) return;
  if (customerAnswerCount() !== 0) return;
  if (!looksLikeRatingQuestion(agentText)) return;
  chatChoiceMode = 'stars';
  renderChatChoices();
}

function isNoFeedbackAnswer(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.toLowerCase() === MURKY_FEEDBACK_SKIP_LABEL.toLowerCase()) return true;
  return /^(no|nope|none|nothing|n\/a|na|all good)\b[\s.!]*$/i.test(t);
}

/** Keep only real support notes. Skip-button copy and "no"/"nothing" stay out of the alert. */
function keptMurkySupportFeedback(text) {
  const feedback = String(text || '').trim().slice(0, MURKY_FEEDBACK_MAX_CHARS);
  if (!feedback || isNoFeedbackAnswer(feedback)) return '';
  return feedback;
}

/** Extra alert fields so support sees a 4-star customer was asked to choose. */
function murkyMiddleNotifyFields() {
  const state = normalizeMurkyMiddle(murkyMiddle);
  if (!state) return {};
  const out = { rating_note: `Rated 4, chose ${state.chose} after the 4-star prompt` };
  if (state.chose === 5 && state.feedback) {
    out.support_feedback = state.feedback;
  }
  return out;
}

function draftsReadyInlineMessage() {
  return clientCopy('draftsReadyMessage', null, '').trim();
}

function isChatDraftPromptVisible() {
  const inline = $('#chat-draft-inline');
  if (inline && inline.isConnected) return true;
  const el = $('#chat-draft-prompt');
  return !!(el && el.classList.contains('visible'));
}

function setChatDraftPromptVisible(visible) {
  const show = !!visible;
  // A configured message replaces the card. Adding .visible would turn the
  // empty shell into a blank bar over the chat (shared CSS positions it there).
  const useInline = !!draftsReadyInlineMessage();
  const el = $('#chat-draft-prompt');
  if (el) {
    el.classList.toggle('visible', show && !useInline);
    el.hidden = useInline;
  }
  syncChatDraftInlineMessage(show);
  syncChatComposerState();
}

/**
 * Clients that set CLIENT_CONFIG.copy.draftsReadyMessage get the drafts-ready
 * step as a chat message with a "Read the drafts." link instead of the card.
 * It is rebuilt from the drafts on reload, like the card.
 */
function syncChatDraftInlineMessage(visible) {
  const message = draftsReadyInlineMessage();
  const messages = $('#chat-messages');
  if (!message || !messages) return;
  let row = $('#chat-draft-inline');
  if (!visible) {
    if (row) row.remove();
    return;
  }
  if (!row) {
    row = document.createElement('div');
    row.id = 'chat-draft-inline';
    row.className = 'chat-message-row agent chat-draft-inline';
    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble agent';
    const paragraphs = message.split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean);
    paragraphs.forEach((para) => {
      const text = document.createElement('p');
      text.textContent = para;
      bubble.appendChild(text);
    });
    const text = bubble.lastElementChild;
    if (!text) return;
    text.appendChild(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'chat-draft-inline__link';
    const linkLabel = clientCopy('draftsReadyLink', null, 'Read the drafts.').trim() || 'Read the drafts.';
    link.textContent = linkLabel;
    const openDrafts = (e) => {
      e.preventDefault();
      transitionTo('draft');
    };
    link.addEventListener('click', openDrafts);
    // Middle-click would open a useless copy of this page. The link only
    // moves to the review screen inside this visit.
    link.addEventListener('auxclick', (e) => {
      if (e.button === 1) openDrafts(e);
    });
    text.appendChild(link);
    row.appendChild(avatar);
    row.appendChild(bubble);
  }
  if (row.parentNode === messages && messages.lastElementChild === row) return;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

let chatMicPhase = '';
let chatMicSession = 0;
let chatMicRecorder = null;
let chatMicStream = null;
let chatMicChunks = [];
let chatMicTimer = null;
let chatMicDiscard = false;
let chatMicAudioContext = null;
let chatMicWaveFrame = 0;
// Live interview answers run long. Five minutes at 32 kbps is about 1.2 MB.
// Phones that record MP4 often ignore the low bitrate, so those stay shorter
// and every recording is refused before upload if it would exceed the host limit.
const CHAT_MIC_MAX_MS = 5 * 60 * 1000;
const CHAT_MIC_MP4_MAX_MS = 2 * 60 * 1000;
const CHAT_MIC_BITS_PER_SECOND = 32000;
const CHAT_MIC_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);

function setChatMicStatus(message) {
  const el = document.getElementById('chat-mic-status');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function chatMicMessage(reason) {
  if (reason === 'missing_openai_key') return 'Voice typing is unavailable.';
  if (reason === 'too_large') return 'That recording was too long.';
  if (reason === 'empty') return "Didn't catch that. Try again.";
  if (reason === 'blocked') return 'Microphone is blocked.';
  return 'Could not transcribe that. Try again.';
}

function stopChatMicTracks() {
  if (!chatMicStream) return;
  chatMicStream.getTracks().forEach((track) => track.stop());
  chatMicStream = null;
}

function stopChatMicWave() {
  if (chatMicWaveFrame) cancelAnimationFrame(chatMicWaveFrame);
  chatMicWaveFrame = 0;
  if (chatMicAudioContext) {
    chatMicAudioContext.close().catch(() => {});
    chatMicAudioContext = null;
  }
}

function startChatMicWave() {
  stopChatMicWave();
  if (!chatMicStream || !window.AudioContext) return;
  const context = new AudioContext();
  chatMicAudioContext = context;
  const source = context.createMediaStreamSource(chatMicStream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const bars = [...document.querySelectorAll('.chat-mic-bar')];
  const draw = () => {
    if (chatMicPhase !== 'recording' || chatMicAudioContext !== context) return;
    analyser.getByteFrequencyData(bins);
    bars.forEach((bar, index) => {
      const sample = bins[index * 2] || 0;
      bar.style.transform = `scaleY(${0.2 + (sample / 255) * 0.8})`;
    });
    chatMicWaveFrame = requestAnimationFrame(draw);
  };
  context.resume().then(draw).catch(() => {});
}

/** The client name and the question on screen, sent as transcription hints. */
function chatMicContext() {
  const parts = [`A customer is answering a review interview about ${clientDisplayName()}.`];
  const question = latestAgentText().replace(/\s+/g, ' ').trim();
  if (question) parts.push(`The question was: ${question.slice(-400)}`);
  return parts.join(' ');
}

function preferredChatMicMime() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function chatMicLimitMs() {
  const mime = String((chatMicRecorder && chatMicRecorder.mimeType) || '');
  if (mime.includes('mp4')) return CHAT_MIC_MP4_MAX_MS;
  return CHAT_MIC_MAX_MS;
}

let syncingChatComposer = false;

function stopChatDictation(discard) {
  if (chatMicPhase === 'starting') {
    chatMicPhase = '';
    chatMicDiscard = false;
    if (chatMicTimer) {
      clearTimeout(chatMicTimer);
      chatMicTimer = null;
    }
    stopChatMicWave();
    stopChatMicTracks();
    return;
  }
  if (chatMicPhase !== 'recording' || !chatMicRecorder) return;
  chatMicDiscard = !!discard;
  chatMicPhase = discard ? '' : 'transcribing';
  if (chatMicTimer) {
    clearTimeout(chatMicTimer);
    chatMicTimer = null;
  }
  stopChatMicWave();
  const button = document.getElementById('chat-mic');
  if (button) {
    button.classList.remove('is-recording');
    button.querySelectorAll('.chat-mic-bar').forEach((bar) => { bar.style.transform = ''; });
    if (discard || chatMicPhase !== 'transcribing') button.setAttribute('aria-label', 'Dictate your answer');
  }
  try { chatMicRecorder.stop(); } catch (_) { chatMicPhase = ''; }
  syncChatComposerState();
}

function applyChatTranscript(text) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const spoken = String(text || '').trim();
  if (!spoken) {
    setChatMicStatus(chatMicMessage('empty'));
    return;
  }
  const existing = input.value.trim();
  input.value = existing ? `${existing} ${spoken}` : spoken;
  setChatMicStatus('');
  input.focus();
}

async function transcribeChatRecording(blob) {
  const body = new FormData();
  const type = blob.type || 'audio/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  body.append('audio', blob, `answer.${ext}`);
  body.append('context', chatMicContext());
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(70000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || 'transcribe_failed');
  return data.text || '';
}

async function finishChatDictation() {
  const blob = new Blob(chatMicChunks, { type: chatMicChunks[0] && chatMicChunks[0].type || 'audio/webm' });
  chatMicChunks = [];
  stopChatMicTracks();
  if (chatMicDiscard) {
    chatMicDiscard = false;
    chatMicPhase = '';
    syncChatComposerState();
    focusChatInput();
    return;
  }
  if (!blob.size) {
    chatMicPhase = '';
    setChatMicStatus(chatMicMessage('empty'));
    syncChatComposerState();
    focusChatInput();
    return;
  }
  if (blob.size > CHAT_MIC_MAX_BYTES) {
    chatMicPhase = '';
    setChatMicStatus(chatMicMessage('too_large'));
    syncChatComposerState();
    focusChatInput();
    return;
  }
  chatMicPhase = 'transcribing';
  setChatMicStatus('Transcribing…');
  const button = document.getElementById('chat-mic');
  if (button) {
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'Transcribing');
  }
  syncChatComposerState();
  try {
    applyChatTranscript(await transcribeChatRecording(blob));
  } catch (err) {
    setChatMicStatus(chatMicMessage(err && err.message));
  } finally {
    chatMicPhase = '';
    const done = document.getElementById('chat-mic');
    if (done) {
      done.removeAttribute('aria-busy');
      done.setAttribute('aria-label', 'Dictate your answer');
    }
    syncChatComposerState();
    focusChatInput();
  }
}

function focusChatInput() {
  const input = document.getElementById('chat-input');
  if (input && !input.disabled) input.focus();
}

function abortChatMicStartup(message) {
  chatMicSession += 1;
  stopChatMicTracks();
  chatMicRecorder = null;
  chatMicChunks = [];
  chatMicPhase = '';
  chatMicDiscard = false;
  const button = document.getElementById('chat-mic');
  if (button) {
    button.classList.remove('is-recording');
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', 'Dictate your answer');
  }
  setChatMicStatus(message || '');
  syncChatComposerState();
}

async function startChatDictation() {
  if (chatMicPhase || isWaitingForAgent) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    setChatMicStatus(chatMicMessage('blocked'));
    return;
  }
  chatMicPhase = 'starting';
  setChatMicStatus('');
  syncChatComposerState();
  try {
    chatMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    abortChatMicStartup(chatMicMessage('blocked'));
    return;
  }
  if (chatMicPhase !== 'starting') {
    stopChatMicTracks();
    chatMicDiscard = false;
    return;
  }
  chatMicChunks = [];
  const mime = preferredChatMicMime();
  try {
    const recorderOptions = { audioBitsPerSecond: CHAT_MIC_BITS_PER_SECOND };
    if (mime) recorderOptions.mimeType = mime;
    chatMicRecorder = new MediaRecorder(chatMicStream, recorderOptions);
  } catch (_) {
    abortChatMicStartup(chatMicMessage('blocked'));
    return;
  }
  chatMicRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size) chatMicChunks.push(event.data);
  });
  const session = ++chatMicSession;
  chatMicRecorder.addEventListener('stop', () => {
    if (session !== chatMicSession) return;
    finishChatDictation();
  });
  try {
    chatMicRecorder.start();
  } catch (_) {
    abortChatMicStartup(chatMicMessage('blocked'));
    return;
  }
  chatMicPhase = 'recording';
  startChatMicWave();
  const button = document.getElementById('chat-mic');
  if (button) {
    button.classList.add('is-recording');
    button.setAttribute('aria-label', 'Stop and transcribe');
  }
  chatMicTimer = setTimeout(() => stopChatDictation(false), chatMicLimitMs());
  syncChatComposerState();
}

function mountChatDictation() {
  const bar = document.querySelector('.chat-input-bar');
  const send = document.getElementById('chat-send');
  if (!bar || !send || document.getElementById('chat-mic')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'chat-mic';
  button.className = 'chat-mic-btn';
  button.setAttribute('aria-label', 'Dictate your answer');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="chat-mic-bars" aria-hidden="true"><span class="chat-mic-bar"></span><span class="chat-mic-bar"></span><span class="chat-mic-bar"></span><span class="chat-mic-bar"></span><span class="chat-mic-bar"></span></span>';
  button.addEventListener('click', () => {
    if (chatMicPhase === 'recording') stopChatDictation(false);
    else startChatDictation();
  });

  const status = document.createElement('p');
  status.id = 'chat-mic-status';
  status.className = 'chat-mic-status';
  status.hidden = true;
  status.setAttribute('role', 'status');

  send.insertAdjacentElement('beforebegin', button);
  bar.appendChild(status);
}

function resizeChatInput() {
  const input = document.getElementById('chat-input');
  if (!input || input.tagName !== 'TEXTAREA') return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function syncChatComposerState() {
  if (syncingChatComposer) return;
  syncingChatComposer = true;
  try {
    syncChatComposerStateNow();
  } finally {
    syncingChatComposer = false;
  }
}

function syncChatComposerStateNow() {
  const inputBar = $('.chat-input-bar');
  const chatInput = $('#chat-input');
  const chatSend = $('#chat-send');
  if (!chatInput || !chatSend) return;

  if (!chatInput.dataset.defaultPlaceholder) chatInput.dataset.defaultPlaceholder = chatInput.placeholder || '';
  const feedbackStep = chatChoiceMode === 'murky-feedback';
  const interviewPlaceholder = isInterviewV3() && interviewTextStep ? interviewTextStep.placeholder : '';
  chatInput.placeholder = feedbackStep
    ? MURKY_FEEDBACK_PLACEHOLDER
    : interviewPlaceholder || chatInput.dataset.defaultPlaceholder;
  if (feedbackStep) {
    chatInput.setAttribute('maxlength', String(MURKY_FEEDBACK_MAX_CHARS));
    chatInput.setAttribute('aria-label', 'Feedback for our support team');
  } else {
    chatInput.removeAttribute('maxlength');
    chatInput.removeAttribute('aria-label');
  }

  const promptVisible = isChatDraftPromptVisible() || chatChoiceHidesInput();
  if (inputBar) {
    inputBar.hidden = promptVisible;
    inputBar.setAttribute('aria-hidden', promptVisible ? 'true' : 'false');
  }

  const mic = document.getElementById('chat-mic');
  if (promptVisible || isWaitingForAgent) stopChatDictation(true);

  if (promptVisible) {
    chatInput.disabled = true;
    chatSend.disabled = true;
    if (mic) mic.disabled = true;
    return;
  }

  const micBusy = chatMicPhase === 'transcribing' || chatMicPhase === 'starting';
  chatInput.disabled = !!isWaitingForAgent || micBusy;
  chatSend.disabled = !chatInput.value.trim() || !!isWaitingForAgent || !!chatMicPhase;
  if (mic) mic.disabled = !!isWaitingForAgent || micBusy;
  resizeChatInput();
}

async function sendMessage(text, isHidden = false) {
  if (isWaitingForAgent) return;
  let autoAnswer = null;

  if (!isHidden) {
    addChatBubble('user', text);
    chatHistory.push({ role: 'user', content: text });
  }

  const chatInput = $('#chat-input');
  chatInput.value = '';
  resizeChatInput();
  chatInput.disabled = true;
  $('#chat-send').disabled = true;
  isWaitingForAgent = true;

  showTypingIndicator(true);

  try {
    const L = getLeadFieldsForApi();
    const body = {
      prompt: text,
      agent: CONFIG.AGENT,
      session_id: sessionId,
      config: {
        client_name: L.client_name,
        customer_name: L.customer_name,
        customer_email: L.customer_email,
        platforms: PARAMS.platforms,
        review_links: PARAMS.reviewLinks,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

    const res = await fetchWithStickyRetry(body, controller.signal);

    clearTimeout(timeout);

    if (!res.ok) {
      let detail = '';
      try {
        const errorBody = await res.json();
        detail = errorBody.error || errorBody.message || '';
      } catch (_) { /* response was not JSON */ }
      throw new Error(`API error: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    const data = await res.json();
    if (data.machine_id) {
      machineId = data.machine_id;
    }
    const resultText = data.result || '';
    lastAgentMessage = resultText;

    if (data.data && data.data.negative_flag) {
      negativeFlagData = data.data.negative_flag;
    }

    if (!negativeFlagData) {
      const flagMatch = resultText.match(/<!--NEGATIVE_FLAG:([\s\S]*?)-->/);
      if (flagMatch) {
        try {
          negativeFlagData = JSON.parse(flagMatch[1]);
        } catch (_) { /* ignore parse error */ }
      }
    }

    if (!negativeFlagData) {
      const soMatch = resultText.match(/<structured_output>([\s\S]*?)<\/structured_output>/);
      if (soMatch) {
        try {
          const parsed = JSON.parse(soMatch[1]);
          if (parsed.negative_flag) negativeFlagData = parsed.negative_flag;
        } catch (_) { /* ignore */ }
      }
    }

    const parsedRating = extractAgentRating(data, resultText, negativeFlagData);
    if (parsedRating != null) agentRating = parsedRating;

    const draftsMatch = resultText.match(/<drafts>([\s\S]*?)<\/drafts>/);
    let draftsParsed = false;
    if (draftsMatch) {
      const parsed = parseDraftsBlock(draftsMatch[1]);
      if (Object.keys(parsed).length > 0) {
        drafts = parsed;
        activeDraftPlatform = Object.keys(drafts)[0];
        reviewDraft = drafts[activeDraftPlatform];
        draftLooksGood = {};
        draftsParsed = true;
      }
    }

    let displayText = resultText
      .replace(/<!--NEGATIVE_FLAG:[\s\S]*?-->/g, '')
      .replace(/<structured_output>[\s\S]*?<\/structured_output>/g, '')
      .replace(/<drafts>[\s\S]*?<\/drafts>/g, '')
      .trim();

    // Route negative when the agent flags it (covers the sentiment override:
    // high rating + negative text) OR when the decimal rating is below the 4.1
    // cutoff. Computed before the 4 -> 5 / direct-5 intercepts so those
    // paths cannot hide a question and then also jump to the negative screen.
    const ratingBelowCutoff = agentRating != null && agentRating < RATING_POSITIVE_CUTOFF;
    const routingNegative = !!(negativeFlagData || ratingBelowCutoff);
    const priorAgentText = latestAgentText();
    const justAfterRating = isRatingOrChoiceAnswer(lastCustomerAnswer());

    // 4 -> 5 path: the closing improvements question becomes the support
    // question (Tonya, 9/30), with a "Nothing to add" button. Never treat
    // the first reply after choosing 5 as that closing question.
    const enterSupportFeedback = !draftsParsed
      && !routingNegative
      && isMurkyFiveSession()
      && isImprovementQuestion(displayText)
      && !justAfterRating
      && !murkySupportAlreadyHandled();
    if (enterSupportFeedback) displayText = MURKY_IMPROVE_QUESTION;

    // First question after choosing 5 on the 4-star prompt.
    if (
      !draftsParsed
      && !routingNegative
      && isMurkyFiveSession()
      && lastCustomerAnswer() === MURKY_CHOICE_LABELS[5]
      && displayText.includes('?')
      && !enterSupportFeedback
    ) {
      displayText = `${MURKY_REVIEW_INTRO} ${questionPart(displayText)}`;
    }

    // Jonathan, 9/30: someone who tapped 5 and just praised the team should
    // not be asked "where could we improve?". Answer it for them, unseen, so
    // the review flow finishes exactly as a "no" answer does today. Once only,
    // so a re-asked question cannot loop hidden "no"s.
    const skipImprovementQuestion = !draftsParsed
      && !routingNegative
      && isDirectFiveSession()
      && isImprovementQuestion(displayText)
      && !justAfterRating
      && !directFiveImproveSkipped;

    if (skipImprovementQuestion) {
      autoAnswer = 'no';
      directFiveImproveSkipped = true;
    } else {
      showTypingIndicator(false);
      addChatBubble('agent', displayText);
      chatHistory.push({ role: 'agent', content: displayText });
      agentMessageCount++;
    }

    if (enterSupportFeedback) markMurkySupportHandled(murkyMiddle && murkyMiddle.feedback);

    // Safety net so 4 -> 5 feedback is never lost: if the drafts arrive and
    // the support question was never recognized (agent rephrased it), the
    // answer that produced the drafts is that feedback — but only when the
    // previous agent turn actually looked like the improvements question.
    // Otherwise a late draft after Q4 would page support with the wrong text.
    if (
      draftsParsed
      && isMurkyFiveSession()
      && !murkySupportAlreadyHandled()
      && isImprovementQuestion(priorAgentText)
    ) {
      const answer = keptMurkySupportFeedback(isHidden ? '' : text);
      if (answer && !/^[1-5]$/.test(answer)) {
        markMurkySupportHandled(answer);
        sendLifecycleNotification('support_feedback');
      }
    }

    // Handle transitions
    if (routingNegative) {
      if (!negativeFlagData) {
        // Routed negative on rating alone — synthesize a minimal flag so the
        // negative screen + Slack notification still have rating context.
        negativeFlagData = { rating: agentRating, severity: 'low' };
      }
      // Negative path: show empathy message, then transition after delay
      setTimeout(() => transitionTo('negative'), 2500);
    } else if (draftsParsed) {
      renderChatDraftPrompt();
      setChatDraftPromptVisible(true);
    } else if (detectDraft(displayText)) {
      // Backwards-compat fallback: legacy single-draft text
      reviewDraft = extractDraft(displayText);
      draftLooksGood = {};
      renderChatDraftPrompt();
      setChatDraftPromptVisible(true);
    } else if (enterSupportFeedback) {
      chatChoiceMode = 'murky-feedback';
      renderChatChoices();
    } else if (!skipImprovementQuestion) {
      maybeShowRatingButtons(displayText);
    }

  } catch (err) {
    showTypingIndicator(false);
    if (err.name === 'AbortError') {
      showChatError('Request timed out. The agent took too long to respond.', text);
    } else {
      showChatError(`Something went wrong: ${err.message}`, text);
    }
  } finally {
    isWaitingForAgent = false;
    syncChatComposerState();
    if (!isChatDraftPromptVisible() && !chatChoiceHidesInput()) {
      chatInput.focus();
    }
    saveSession();
  }
  if (autoAnswer) sendMessage(autoAnswer, true);
}

function handleChatSend() {
  const input = $('#chat-input');
  const text = input.value.trim();
  // The send button is disabled while the mic is recording or transcribing.
  // Enter used to skip that lock and send a partial answer, or discard the take.
  if (!text || isWaitingForAgent || chatMicPhase) return;
  // V3 answers its own open questions; nothing goes to the chat agent.
  if (isInterviewV3()) {
    if (interviewTextStep) finishInterviewText(text);
    return;
  }
  // The 4 -> 5 support question: also routes the answer to the support flow.
  if (chatChoiceMode === 'murky-feedback') {
    handleMurkyFeedback(text);
    return;
  }
  sendMessage(text);
}

function addChatBubble(role, text) {
  const messages = $('#chat-messages');

  if (role === 'agent') {
    const row = document.createElement('div');
    row.className = 'chat-message-row agent';

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    avatar.setAttribute('aria-hidden', 'true');

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble agent';
    bubble.innerHTML = renderMarkdown(text);

    row.appendChild(avatar);
    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return;
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = renderMarkdown(text);
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function showTypingIndicator(show) {
  const indicator = $('#typing-indicator');
  indicator.classList.toggle('visible', show);
  if (show) {
    const messages = $('#chat-messages');
    messages.scrollTop = messages.scrollHeight;
  }
}

function showChatError(message, retryText) {
  const messages = $('#chat-messages');
  const errorDiv = document.createElement('div');
  errorDiv.className = 'chat-error';
  errorDiv.innerHTML = `<span>${message}</span>`;

  if (retryText) {
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      errorDiv.remove();
      sendMessage(retryText, true);
    });
    errorDiv.appendChild(retryBtn);
  }

  messages.appendChild(errorDiv);
  messages.scrollTop = messages.scrollHeight;
}

// ── Markdown Renderer (minimal) ─────────────────────────────
function renderMarkdown(text) {
  return escapeHtml(text)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeMarkdownHref(href);
      return safeHref ? `<a href="${safeHref}" target="_blank" rel="noopener">${label}</a>` : label;
    })
    // Line breaks
    .replace(/\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeMarkdownHref(href) {
  try {
    const decodedHref = href.replace(/&amp;/g, '&');
    const url = new URL(decodedHref, window.location.href);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
    return escapeHtml(url.href);
  } catch (_) {
    return '';
  }
}

// ── Rating routing ──────────────────────────────────────────
// Ratings of 4.1 and above are positive; 4.0 and below route to the negative
// ("honesty") path. Decimal ratings (4.2, 4.5, ...) are fully supported.
const RATING_POSITIVE_CUTOFF = 4.1;

/**
 * Pull a numeric rating out of the agent response, supporting decimals.
 * Looks (in order) at structured data, the negative flag, and inline markers.
 * Returns a finite number or null if none is present.
 */
function extractAgentRating(data, resultText, flag) {
  const candidates = [];
  if (data && data.data && data.data.rating != null) candidates.push(data.data.rating);
  if (flag && flag.rating != null) candidates.push(flag.rating);

  if (typeof resultText === 'string') {
    const soMatch = resultText.match(/<structured_output>([\s\S]*?)<\/structured_output>/);
    if (soMatch) {
      try {
        const parsed = JSON.parse(soMatch[1]);
        if (parsed && parsed.rating != null) candidates.push(parsed.rating);
      } catch (_) { /* ignore */ }
    }
    const inline = resultText.match(/<!--\s*RATING:\s*([\d.]+)\s*-->/i);
    if (inline) candidates.push(inline[1]);
  }

  for (const c of candidates) {
    const n = parseFloat(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ── Draft Detection ─────────────────────────────────────────
const DRAFT_SIGNALS = [
  /i've put together a draft/i,
  /here's a draft/i,
  /draft review for/i,
  /here is a draft/i,
  /drafted.*review/i,
  /review draft/i,
];

function detectDraft(text) {
  if (agentMessageCount < 4) return false;

  return DRAFT_SIGNALS.some(re => re.test(text));
}

function extractDraft(text) {
  const quoteMatch = text.match(/"([^"]{40,})"/);
  if (quoteMatch) return quoteMatch[1].trim();

  const lines = text.split('\n');
  const blockquoteLines = lines.filter(l => l.startsWith('> '));
  if (blockquoteLines.length > 0) {
    return blockquoteLines.map(l => l.replace(/^>\s?/, '')).join('\n').trim();
  }

  // Agent often uses "---" separator, then "Review Draft:" header, then text, then "---" or link
  const draftHeaderMatch = text.match(/(?:Review Draft|Draft Review)[:\s]*\n+([\s\S]*?)(?:\n---|\n\nWhen you're ready|\n\nLet me know|\n\n\[|$)/i);
  if (draftHeaderMatch && draftHeaderMatch[1].trim().length > 30) {
    return cleanDraft(draftHeaderMatch[1]);
  }

  // Try to find text after "---" separator blocks (agent pattern: intro --- draft --- link)
  const sections = text.split(/\n---\n/);
  if (sections.length >= 2) {
    // The draft is usually the section after the first ---
    const draftSection = sections[1].replace(/^.*?Draft[:\s]*/i, '').trim();
    if (draftSection.length > 30) return cleanDraft(draftSection);
  }

  // Try to find text after draft signal, before link or "When you're ready"
  for (const re of DRAFT_SIGNALS) {
    const match = text.match(re);
    if (match) {
      const afterSignal = text.slice(match.index + match[0].length);
      const endMatch = afterSignal.match(/\n\n(?:When you're ready|You can post|Here's the link|Let me know|\[)/i);
      if (endMatch) {
        const draft = afterSignal.slice(0, endMatch.index).trim();
        if (draft.length > 30) return cleanDraft(draft);
      }
      const cleaned = afterSignal.replace(/\[.*?\]\(.*?\)/g, '').trim();
      if (cleaned.length > 30) return cleanDraft(cleaned);
    }
  }

  // Fallback: return the longest paragraph
  const paragraphs = text.split('\n\n').filter(p => p.length > 40 && !DRAFT_SIGNALS.some(re => re.test(p)));
  if (paragraphs.length > 0) {
    return cleanDraft(paragraphs.reduce((a, b) => a.length > b.length ? a : b));
  }

  return text.trim();
}

function cleanDraft(text) {
  return text
    .replace(/^[\s\n:]+/, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/\*\*/g, '')
    .replace(/^[""]|[""]$/g, '')
    .trim();
}

// ── Screen 3: Draft ─────────────────────────────────────────
function parseDraftsBlock(inner) {
  const out = {};
  const re = /<draft\s+platform="([^"]+)"\s*>([\s\S]*?)<\/draft>/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

function initDraftScreen() {
  // Backwards-compat: if no structured drafts captured, treat the legacy single draft as the first platform's draft so the UI still has something to show.
  if (Object.keys(drafts).length === 0 && reviewDraft) {
    const fallbackPlat = PARAMS.platforms[0] || 'review';
    drafts = { [fallbackPlat]: reviewDraft };
    activeDraftPlatform = fallbackPlat;
  }
  if (!activeDraftPlatform) {
    activeDraftPlatform = Object.keys(drafts)[0] || PARAMS.platforms[0] || 'review';
  }
  Object.keys(draftLooksGood).forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(drafts, k)) delete draftLooksGood[k];
  });
  renderDraftTabs();
  setActiveDraft(activeDraftPlatform);
  updateStarDisplay();
  updateDraftScreenChrome();
  markHubSpotContactIncomplete();
}

const PLATFORM_FAVICON_HOST = {
  hubspot: 'hubspot.com',
  g2: 'g2.com',
  google: 'google.com',
  trustpilot: 'trustpilot.com',
  clutch: 'clutch.co',
  capterra: 'capterra.com',
  gartner: 'gartner.com',
  greatnonprofits: 'greatnonprofits.org',
};

const PLATFORM_LOGOS = {
  greatnonprofits: '/assets/image/greatnonprofits.png',
};

function platformFaviconHost(platform) {
  const key = String(platform || '').toLowerCase();
  const link = PARAMS.reviewLinks && PARAMS.reviewLinks[key];
  if (link) {
    try {
      const host = new URL(link).hostname;
      if (host) return host.replace(/^www\./i, '');
    } catch (_) { /* ignore */ }
  }
  return PLATFORM_FAVICON_HOST[key] || key || 'example.com';
}

function draftTabLogoCandidates(plat) {
  const key = String(plat || '').toLowerCase();
  const urls = [];
  const add = (u) => {
    if (u == null || typeof u !== 'string') return;
    const t = u.trim();
    if (!t || urls.includes(t)) return;
    urls.push(t);
  };

  const custom = CLIENT_CONFIG.platformLogos && CLIENT_CONFIG.platformLogos[key];
  add(custom);
  add(PLATFORM_LOGOS[key]);

  const canonical = PLATFORM_FAVICON_HOST[key];
  const fromLink = platformFaviconHost(plat);

  const s2host = canonical || fromLink;
  if (s2host && !PLATFORM_LOGOS[key]) {
    add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s2host)}&sz=128`);
  }

  return urls;
}

function getChatDraftPromptPlatformList() {
  const keys = Object.keys(drafts).filter((k) => drafts[k] != null && String(drafts[k]).trim());
  if (keys.length) return keys;
  if (Array.isArray(PARAMS.platforms) && PARAMS.platforms.length) return [...PARAMS.platforms];
  return ['hubspot'];
}

function renderChatDraftPrompt() {
  const sub = $('#chat-draft-prompt-subhead');
  const grid = $('#chat-draft-prompt-platforms');
  if (!sub || !grid) return;

  const platformList = getChatDraftPromptPlatformList();
  const n = platformList.length;
  sub.textContent = `${n} review ${n === 1 ? 'draft' : 'drafts'} can be reviewed and edited:`;

  grid.innerHTML = '';
  platformList.forEach((plat) => {
    const card = document.createElement('div');
    card.className = 'chat-draft-prompt__mini';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'chat-draft-prompt__mini-icon';

    const img = document.createElement('img');
    img.alt = '';
    img.width = 36;
    img.height = 36;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';

    const candidates = draftTabLogoCandidates(plat);
    let idx = 0;
    const loadNextLogo = () => {
      if (idx >= candidates.length) {
        img.style.display = 'none';
        iconWrap.classList.add('chat-draft-prompt__mini-icon--empty');
        return;
      }
      img.src = candidates[idx++];
    };
    img.addEventListener('error', loadNextLogo);
    loadNextLogo();
    iconWrap.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'chat-draft-prompt__mini-meta';

    const nameEl = document.createElement('p');
    nameEl.className = 'chat-draft-prompt__mini-name';
    nameEl.textContent = platformDisplayName(plat);

    const status = document.createElement('div');
    status.className = 'chat-draft-prompt__mini-status';
    status.innerHTML =
      '<span class="chat-draft-prompt__mini-status-text">Draft Ready</span><span class="chat-draft-prompt__mini-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity="0.12"/><path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

    meta.appendChild(nameEl);
    meta.appendChild(status);
    card.appendChild(iconWrap);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}

function syncChatDraftPromptVisibility() {
  const el = $('#chat-draft-prompt');
  if (!el) return;
  const fromDrafts =
    Object.keys(drafts).length > 0 &&
    Object.keys(drafts).some((k) => drafts[k] != null && String(drafts[k]).trim());
  const fromLegacy = !!(reviewDraft && String(reviewDraft).trim());
  if (fromDrafts || fromLegacy) {
    renderChatDraftPrompt();
    setChatDraftPromptVisible(true);
    return;
  }
  setChatDraftPromptVisible(false);
}

function renderDraftTabs() {
  const tabsEl = $('#draft-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  const platformList = Object.keys(drafts);
  platformList.forEach(plat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'draft-tab' +
      (plat === activeDraftPlatform ? ' active' : '') +
      (draftLooksGood[plat] ? ' is-approved' : '');
    btn.dataset.platform = plat;
    btn.setAttribute('role', 'tab');

    const iconWrap = document.createElement('span');
    iconWrap.className = 'draft-tab-icon';

    const img = document.createElement('img');
    img.alt = '';
    img.width = 50;
    img.height = 50;
    img.loading = 'lazy';
    img.decoding = 'async';

    const candidates = draftTabLogoCandidates(plat);
    let idx = 0;
    const loadNextLogo = () => {
      if (idx >= candidates.length) {
        img.style.display = 'none';
        iconWrap.classList.add('draft-tab-icon--empty');
        return;
      }
      img.src = candidates[idx++];
    };
    img.addEventListener('error', loadNextLogo);
    loadNextLogo();

    iconWrap.appendChild(img);

    const label = document.createElement('span');
    label.className = 'draft-tab-label';
    label.textContent = platformDisplayName(plat);

    btn.appendChild(iconWrap);
    btn.appendChild(label);

    if (draftLooksGood[plat]) {
      const check = document.createElement('span');
      check.className = 'draft-tab-check';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
      btn.appendChild(check);
    }

    btn.addEventListener('click', () => {
      drafts[activeDraftPlatform] = $('#draft-textarea').value;
      setActiveDraft(plat);
    });
    tabsEl.appendChild(btn);
  });
}

function setActiveDraft(plat) {
  activeDraftPlatform = plat;
  $('#draft-textarea').value = drafts[plat] || '';
  $$('#draft-tabs .draft-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.platform === plat);
  });
  updateDraftScreenChrome();
  saveSession();
}

function orderedDraftPlatforms() {
  const set = new Set(Object.keys(drafts));
  const out = [];
  for (const p of PARAMS.platforms) {
    if (set.has(p)) out.push(p);
  }
  for (const p of Object.keys(drafts)) {
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

function updateDraftScreenChrome() {
  const plat = activeDraftPlatform;
  const name = plat ? platformDisplayName(plat) : '';

  const hintText = $('#draft-copy-hint-text');
  if (hintText) {
    hintText.textContent = plat ? `You'll copy & paste this on ${name}` : '';
  }

  const desc = $('#draft-what-next-desc');
  if (desc) {
    desc.textContent = plat
      ? `Once you approve, we'll show you step-by-step how to post this review on ${name}.`
      : '';
  }

  const approveAll = $('#btn-approve-all');
  if (!approveAll) return;
  const order = orderedDraftPlatforms();
  approveAll.disabled = order.length === 0;
}

function handleLooksGoodDraft() {
  if (!activeDraftPlatform) return;
  drafts[activeDraftPlatform] = $('#draft-textarea').value.trim();
  draftLooksGood[activeDraftPlatform] = true;
  renderDraftTabs();

  const order = orderedDraftPlatforms();
  let nextPlat = null;
  const curIdx = order.indexOf(activeDraftPlatform);
  for (let step = 1; step < order.length; step++) {
    const i = (curIdx + step) % order.length;
    if (!draftLooksGood[order[i]]) {
      nextPlat = order[i];
      break;
    }
  }

  if (nextPlat && nextPlat !== activeDraftPlatform) {
    setActiveDraft(nextPlat);
  } else {
    reviewDraft = drafts[activeDraftPlatform] || reviewDraft;
    transitionTo('post');
  }
}

function handleApproveAllDrafts() {
  const order = orderedDraftPlatforms();
  if (order.length === 0) return;
  if (activeDraftPlatform) {
    drafts[activeDraftPlatform] = $('#draft-textarea').value.trim();
  }
  for (const p of order) {
    draftLooksGood[p] = true;
  }
  if (!activeDraftPlatform) activeDraftPlatform = order[0];
  reviewDraft = drafts[activeDraftPlatform] || reviewDraft;
  renderDraftTabs();
  updateDraftScreenChrome();
  saveSession();
  transitionTo('post');
}

function updateStarDisplay() {
  $$('#draft-stars .star').forEach(star => {
    const val = parseInt(star.dataset.value);
    star.classList.toggle('filled', val <= starRating);
    star.classList.toggle('empty', val > starRating);
  });
}

function handleRegenerate() {
  const btn = $('#btn-regenerate');
  btn.disabled = true;
  setRegenerateButtonLabel(btn, 'Regenerating...');

  drafts[activeDraftPlatform] = $('#draft-textarea').value;

  sendRegenerateRequest(activeDraftPlatform).finally(() => {
    btn.disabled = false;
    setRegenerateButtonLabel(btn, 'Regenerate this draft');
  });
}

async function sendRegenerateRequest(platform) {
  try {
    const L = getLeadFieldsForApi();
    // V3 sends the answers again under a new writer session. Reusing the
    // session that produced the drafts replays that attempt instead of writing.
    const v3 = isInterviewV3();
    const plat = String(platform || '').trim().toLowerCase();
    const st = v3 ? ensureInterviewState() : null;
    const cfg = v3 ? interviewConfig() : null;
    const allowed = (PARAMS.platforms || []).some((p) => String(p).toLowerCase() === plat);
    if (v3 && (!cfg || !allowed)) return;
    const currentDraft = v3 ? interviewOneLine(drafts[plat] || drafts[platform]) : '';
    const body = {
      prompt: v3
        ? [
            buildInterviewWriterPrompt(cfg, st.answers),
            '',
            `Write the ${plat} draft again from the answers above. Keep every rule: their words, at most one sentence of yours, nothing invented.`,
            currentDraft ? `Current ${plat} draft, which you must not copy: ${currentDraft}` : '',
            `Wrap it in <drafts><draft platform="${plat}">...</draft></drafts>. Do not include any other platforms.`,
          ].filter(Boolean).join('\n')
        : `Please regenerate ONLY the ${platform} draft with a slightly different angle. Wrap the new draft in <drafts><draft platform="${platform}">...</draft></drafts>. Do not include any other platforms.`,
      agent: v3 ? INTERVIEW_WRITER_AGENT : CONFIG.AGENT,
      session_id: v3 ? crypto.randomUUID() : sessionId,
      config: {
        client_name: L.client_name,
        customer_name: L.customer_name,
        customer_email: L.customer_email,
        platforms: PARAMS.platforms,
        review_links: PARAMS.reviewLinks,
      },
    };

    const res = await fetchWithStickyRetry(body, undefined);
    if (!res.ok) throw new Error('API error');

    const data = await res.json();
    if (data.machine_id) {
      machineId = data.machine_id;
    }
    const resultText = data.result || '';

    const draftsMatch = resultText.match(/<drafts>([\s\S]*?)<\/drafts>/);
    if (draftsMatch) {
      const parsedAll = parseDraftsBlock(draftsMatch[1]);
      const nextText = v3 ? interviewKeepDrafts(parsedAll, [plat])[plat] : parsedAll[platform];
      if (nextText) {
        drafts[platform] = nextText;
        delete draftLooksGood[platform];
        if (platform === activeDraftPlatform) {
          $('#draft-textarea').value = nextText;
        }
        renderDraftTabs();
        updateDraftScreenChrome();
        saveSession();
        return;
      }
    }
    if (v3) throw new Error('No draft in the reply');
    // Fallback: legacy single-draft extraction
    const newDraft = extractDraft(resultText);
    if (newDraft && newDraft.length > 30) {
      drafts[platform] = newDraft;
      delete draftLooksGood[platform];
      if (platform === activeDraftPlatform) {
        $('#draft-textarea').value = newDraft;
      }
      renderDraftTabs();
      updateDraftScreenChrome();
      saveSession();
    }
  } catch (err) {
    console.error('Regenerate failed:', err);
    const hint = $('#draft-copy-hint-text');
    if (hint) hint.textContent = 'Could not rewrite that draft. Your current text is unchanged.';
  }
}

// ── Screen 4: Post ──────────────────────────────────────────
const PLATFORM_META = {
  hubspot:          { name: 'HubSpot',          desc: 'B2B marketplace reviews',              icon: 'globe',  flow: 'paste'  },
  g2:               { name: 'G2',               desc: 'Where buyers compare software',        icon: 'star',   flow: 'fields' },
  trustpilot:       { name: 'Trustpilot',       desc: 'Trusted by millions of consumers',     icon: 'shield', flow: 'paste'  },
  google:           { name: 'Google Business',  desc: 'Your most visible review',             icon: 'globe',  flow: 'paste'  },
  capterra:         { name: 'Capterra',         desc: 'Software reviews for businesses',      icon: 'star',   flow: 'paste'  },
  gartner:          { name: 'Gartner',          desc: 'Enterprise buyer reviews',             icon: 'star',   flow: 'fields' },
  greatnonprofits:  { name: 'GreatNonprofits',  desc: 'Where supporters share nonprofit impact', icon: 'star', flow: 'paste' },
};

function isRichPostLayout() {
  const el = $('#screen-post');
  return String((el && el.dataset.postLayout) || CLIENT_CONFIG.postScreenLayout || '') === 'rich';
}

/**
 * Human-facing client name for UI copy. providerName doubles as the backend
 * routing slug (often lowercase), so never show it raw when a displayName exists.
 */
function clientDisplayName() {
  return String(CLIENT_CONFIG.displayName || PARAMS.providerName || 'this team').trim() || 'this team';
}

/**
 * Per-client wording override. A client config can set CLIENT_CONFIG.copy[key]
 * to a string with {placeholder} tokens; anything unset keeps the shared default.
 * Only the caller's own fields are filled in, so a token like {toString} stays put.
 */
function clientCopy(key, vars, fallback) {
  const copy = typeof CLIENT_CONFIG !== 'undefined' && CLIENT_CONFIG && CLIENT_CONFIG.copy;
  const tpl = copy && Object.prototype.hasOwnProperty.call(copy, key) ? copy[key] : undefined;
  if (typeof tpl !== 'string') return fallback;
  return tpl.replace(/\{(\w+)\}/g, (match, name) => {
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name) || vars[name] == null) return match;
    return String(vars[name]);
  });
}

/** Per-platform hint under a post card's button, from CLIENT_CONFIG.copy.cardHints. */
function clientCardHint(plat, fallback) {
  const copy = typeof CLIENT_CONFIG !== 'undefined' && CLIENT_CONFIG && CLIENT_CONFIG.copy;
  const hints = copy && copy.cardHints;
  const hint = hints && Object.prototype.hasOwnProperty.call(hints, plat) ? hints[plat] : undefined;
  return typeof hint === 'string' ? hint : fallback;
}

function truncatePostSnippet(s, max = 280) {
  const t = String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function formatConfirmedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) {
    return '';
  }
}

function iconExternalLink() {
  return '<svg class="btn-icon-right" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';
}

function iconLockSmall() {
  return '<svg class="platform-card-lock" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

function renderRichStarsRow() {
  const star =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon fill="currentColor" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  return `<div class="platform-card-stars" aria-hidden="true">${Array(5)
    .fill(`<span class="platform-card-star">${star}</span>`)
    .join('')}</div>`;
}

function createPlatformCardLogo(plat, size = 48) {
  const img = document.createElement('img');
  img.alt = '';
  img.width = size;
  img.height = size;
  img.className = 'platform-card-logo';
  img.loading = 'lazy';
  const candidates = draftTabLogoCandidates(plat);
  let idx = 0;
  const next = () => {
    if (idx >= candidates.length) {
      img.removeAttribute('src');
      img.style.display = 'none';
      return;
    }
    img.src = candidates[idx++];
  };
  img.addEventListener('error', next);
  next();
  return img;
}

function richPendingStatusHTML() {
  return `
    <span class="platform-card-status platform-card-status--pending">
      <span class="platform-card-status-icon" aria-hidden="true"></span>
      Not confirmed yet
    </span>`;
}

function mountRichPostedCard(card, plat, meta, postedAtIso) {
  const whenLabel = postedAtIso ? formatConfirmedAt(postedAtIso) : 'Recently';
  card.innerHTML = `
    <div class="platform-card-top platform-card-top--posted">
      <span class="platform-card-label-confirmed">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
        Confirmed
      </span>
    </div>
    <div class="platform-card-brand">
      <div class="platform-card-logo-wrap"></div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p>${escapeHtml(meta.desc)}</p>
    </div>
    ${renderRichStarsRow()}
    <p class="platform-card-snippet">${escapeHtml(truncatePostSnippet(draftSnippetText(plat, drafts[plat] || reviewDraft || '')))}</p>
    <p class="platform-card-confirmed-meta">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
      Confirmed on ${escapeHtml(whenLabel)}
    </p>
    <div class="platform-card-actions platform-card-actions--split">
      <button type="button" class="btn btn-secondary btn-sm" data-action="view-review-link" data-platform="${escapeHtml(plat)}">
        Open review site ${iconExternalLink()}
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="post-another" data-platform="${escapeHtml(plat)}">
        Undo confirmation
      </button>
    </div>`;
  const wrap = card.querySelector('.platform-card-logo-wrap');
  if (wrap) wrap.appendChild(createPlatformCardLogo(plat));
}

function mountRichPasteUnpostedCard(card, plat, index1, meta) {
  const guided = Boolean(reviewFormOpened[plat]) && isRichPostLayout();
  const draft = drafts[plat] || reviewDraft || '';

  if (guided) {
    card.innerHTML = `
    <div class="platform-card-top">
      ${richPendingStatusHTML()}
    </div>
    <div class="platform-card-brand">
      <div class="platform-card-logo-wrap"></div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p>${escapeHtml(meta.desc)}</p>
    </div>
    ${renderRichStarsRow()}
    ${guidedStepsHTML(plat, meta, 1, 1, { pasteFlow: true })}
    <div class="field-row">
      <div class="field-row-head">
        <span class="field-label">Your review</span>
        <button type="button" class="btn-copy" data-action="copy-all" data-platform="${escapeHtml(plat)}">Copy again</button>
      </div>
      <p class="field-body">${escapeHtml(truncatePostSnippet(draft, 420))}</p>
    </div>
    ${guidedConfirmHTML(plat, meta)}`;
  } else {
    card.innerHTML = `
    <div class="platform-card-top">
      ${richPendingStatusHTML()}
    </div>
    <div class="platform-card-brand">
      <div class="platform-card-logo-wrap"></div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p>${escapeHtml(meta.desc)}</p>
    </div>
    ${renderRichStarsRow()}
    <p class="platform-card-snippet">${escapeHtml(truncatePostSnippet(draft))}</p>
    <div class="platform-card-actions platform-card-actions--stack">
      <button type="button" class="btn btn-primary btn-md" data-action="post-paste" data-platform="${escapeHtml(plat)}">
        Open ${escapeHtml(meta.name)} review form ${iconExternalLink()}
      </button>
    </div>
    <p class="platform-card-foot-hint">${iconLockSmall()}<span>${escapeHtml(clientCardHint(plat, 'We copy your review for you. Takes about a minute.'))}</span></p>`;
  }
  const wrap = card.querySelector('.platform-card-logo-wrap');
  if (wrap) wrap.appendChild(createPlatformCardLogo(plat));
}

function parseG2Fields(draft) {
  if (!draft) return [];
  // Matches [FIELD: question text]\nbody-until-next-[FIELD: or EOF]
  const re = /\[FIELD:\s*([^\]]+?)\]\s*([\s\S]*?)(?=\n*\[FIELD:|$)/g;
  const out = [];
  let m;
  while ((m = re.exec(draft)) !== null) {
    out.push({ label: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

function formatDraftForOverlay(platform, draftText) {
  const text = String(draftText || '').trim();
  if (!text) return '';
  const meta = PLATFORM_META[String(platform || '').toLowerCase()];
  if (!meta || meta.flow !== 'fields') return text;
  return text.replace(/\[FIELD:\s*([^\]]+?)\]/g, '$1');
}

/**
 * Card-preview text: for fields-flow drafts, drop the question labels entirely
 * (they read as noise in a truncated snippet) and keep only the answers.
 */
function draftSnippetText(platform, draftText) {
  const meta = PLATFORM_META[String(platform || '').toLowerCase()];
  if (meta && meta.flow === 'fields') {
    const fields = parseG2Fields(draftText);
    if (fields.length > 0) return fields.map((f) => f.body).join(' ');
  }
  return formatDraftForOverlay(platform, draftText);
}

// ── Guided post flow (rich layout) ──────────────────────────
// After "Open … review form" the card turns into a 4-step checklist that
// walks the visitor through login → copy → paste → confirm. Replaces the
// old instant "Finished?" overlay, which covered the drafts it asked about.

function copiedFieldIdxs(plat) {
  const arr = platformFieldsCopied[plat];
  return Array.isArray(arr) ? arr : [];
}

function markFieldCopied(plat, idx) {
  const seen = new Set(copiedFieldIdxs(plat));
  seen.add(idx);
  platformFieldsCopied[plat] = [...seen];
  saveSession();
}

/** Current step in the guided checklist: 1 login, 2 copy, 3 paste, 4 confirm. */
function guidedCurrentStep(copiedCount, totalFields) {
  if (copiedCount === 0) return 1;
  if (copiedCount < totalFields) return 2;
  return 3;
}

function guidedStepsHTML(plat, meta, copiedCount, totalFields, { pasteFlow = false } = {}) {
  const current = pasteFlow ? 3 : guidedCurrentStep(copiedCount, totalFields);
  const copyLabel = pasteFlow
    ? 'Your review is already copied'
    : `Copy your answers below (${copiedCount} of ${totalFields} copied)`;
  const steps = [
    { n: 1, label: `Log in to ${meta.name}, or create a free account` },
    { n: 2, label: copyLabel },
    { n: 3, label: `Paste into the ${meta.name} tab` },
    { n: 4, label: 'Come back here and tap "I posted my review"' },
  ];
  const items = steps
    .map((s) => {
      const done = s.n < current || (s.n === 2 && (pasteFlow || (totalFields > 0 && copiedCount >= totalFields)));
      const cls = done ? 'done' : s.n === current ? 'active' : '';
      const dot = done
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
        : String(s.n);
      return `<li class="guided-step ${cls}"><span class="guided-step-dot" aria-hidden="true">${dot}</span><span class="guided-step-label">${escapeHtml(s.label)}</span></li>`;
    })
    .join('');
  return `<ol class="guided-steps" aria-label="How to post your review">${items}</ol>`;
}

function guidedConfirmHTML(plat, meta) {
  return `
    <div class="platform-card-actions platform-card-actions--stack guided-confirm">
      <button type="button" class="btn btn-primary btn-md btn-confirm-guided" data-action="confirm-posted" data-platform="${escapeHtml(plat)}">
        I posted my review on ${escapeHtml(meta.name)}
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="reopen-window" data-platform="${escapeHtml(plat)}">
        Reopen ${escapeHtml(meta.name)} tab ${iconExternalLink()}
      </button>
    </div>`;
}

function mountRichG2UnpostedCard(card, plat, index1, meta) {
  const draft = drafts[plat] || reviewDraft || '';
  const fields = parseG2Fields(draft);

  if (fields.length === 0) {
    mountRichPasteUnpostedCard(card, plat, index1, meta);
    return;
  }

  const guided = Boolean(reviewFormOpened[plat]);
  const copied = new Set(copiedFieldIdxs(plat));
  const nextIdx = fields.findIndex((_, i) => !copied.has(i));

  const fieldRows = fields
    .map((f, i) => {
      const isCopied = copied.has(i);
      const isNext = guided && i === nextIdx;
      const rowCls = `field-row${isCopied ? ' field-row--copied' : ''}${isNext ? ' field-row--next' : ''}`;
      const btnLabel = isCopied ? 'Copied ✓' : 'Copy';
      const nextTag = isNext ? '<span class="field-next-tag">Next</span>' : '';
      return `
    <div class="${rowCls}">
      <div class="field-row-head">
        <span class="field-label">${escapeHtml(f.label)}</span>
        ${nextTag}
        <button type="button" class="btn-copy${isCopied ? ' btn-copy--done' : ''}" data-action="copy-section" data-platform="${escapeHtml(plat)}" data-idx="${i}" data-text="${escapeAttr(f.body)}">${btnLabel}</button>
      </div>
      <p class="field-body">${escapeHtml(f.body)}</p>
    </div>`;
    })
    .join('');

  const preHint = clientCardHint(
    plat,
    `Takes about 2 minutes. You may need a free ${meta.name} account, and that is normal.`
  );

  card.innerHTML = `
    <div class="platform-card-top">
      ${richPendingStatusHTML()}
    </div>
    <div class="platform-card-brand">
      <div class="platform-card-logo-wrap"></div>
      <h4>${escapeHtml(meta.name)}</h4>
      <p>${escapeHtml(meta.desc)}</p>
    </div>
    ${renderRichStarsRow()}
    ${guided ? '' : `<p class="platform-card-snippet">${escapeHtml(truncatePostSnippet(draftSnippetText(plat, draft)))}</p>`}
    ${guided ? guidedStepsHTML(plat, meta, copied.size, fields.length) : `
    <div class="platform-card-actions platform-card-actions--stack">
      <button type="button" class="btn btn-primary btn-md" data-action="open-form" data-platform="${escapeHtml(plat)}">
        Open ${escapeHtml(meta.name)} review form ${iconExternalLink()}
      </button>
    </div>
    <p class="platform-card-foot-hint">${iconLockSmall()}<span>${escapeHtml(preHint)}</span></p>`}
    <details class="card-details card-details--rich" open>
      <summary>Your answers for ${escapeHtml(meta.name)} (${fields.length})</summary>
      <div class="card-details-body">${fieldRows}</div>
    </details>
    ${guided ? guidedConfirmHTML(plat, meta) : ''}`;

  const wrap = card.querySelector('.platform-card-logo-wrap');
  if (wrap) wrap.appendChild(createPlatformCardLogo(plat));
}

function clearPendingReviewOverlay() {
  pendingReviewOverlayPlatform = null;
  reviewOverlayAwaitingReturn = false;
  pendingReviewOverlayScheduledAt = 0;
  if (reviewOverlayFallbackTimer != null) {
    clearTimeout(reviewOverlayFallbackTimer);
    reviewOverlayFallbackTimer = null;
  }
}

function flushPendingReviewOverlay() {
  const plat = pendingReviewOverlayPlatform;
  clearPendingReviewOverlay();
  if (plat != null) showReviewCompleteOverlay(plat);
}

function markReviewOverlayLeftApp() {
  if (pendingReviewOverlayPlatform != null) reviewOverlayAwaitingReturn = true;
}

function pageIsForeground() {
  if (document.hidden) return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  return true;
}

function maybeShowPendingReviewOverlay() {
  if (pendingReviewOverlayPlatform == null) return;
  if (!pageIsForeground()) return;
  if (!reviewOverlayAwaitingReturn) return;
  if (Date.now() - pendingReviewOverlayScheduledAt < REVIEW_OVERLAY_BOUNCE_MS) return;
  flushPendingReviewOverlay();
}

/**
 * When the visitor comes back from a review window, draw their eye to the
 * card-level "I posted my review" button instead of throwing a modal at them.
 */
function maybePulseGuidedConfirm() {
  if (currentState !== 'post' || !isRichPostLayout()) return;
  $$('.btn-confirm-guided').forEach((btn) => {
    btn.classList.remove('pulse');
    void btn.offsetWidth; /* restart the animation */
    btn.classList.add('pulse');
  });
}

/**
 * Ask "finished?" only after the user comes back from the review site.
 * If they never leave (blocked tab, missing URL, opener stayed focused),
 * show the overlay after a short fallback so confirm is not lost.
 */
function scheduleReviewCompleteOverlay(platform) {
  if (platform == null || platformsPosted[platform]) return;
  if (currentState !== 'post') return;
  clearPendingReviewOverlay();
  pendingReviewOverlayPlatform = platform;
  pendingReviewOverlayScheduledAt = Date.now();
  reviewOverlayAwaitingReturn = !pageIsForeground();

  reviewOverlayFallbackTimer = setTimeout(() => {
    reviewOverlayFallbackTimer = null;
    if (pendingReviewOverlayPlatform !== platform) return;
    if (!pageIsForeground()) {
      reviewOverlayAwaitingReturn = true;
      return;
    }
    flushPendingReviewOverlay();
  }, REVIEW_OVERLAY_FALLBACK_MS);
}

function reviewPublicationHint(platformName) {
  const name = String(platformName || 'That site').trim() || 'That site';
  return `Mark your session as complete below. ${name}, and any site that reads it, only updates once ${name} publishes your review.`;
}

function hideReviewCompleteOverlay() {
  const overlay = $('#review-complete-overlay');
  if (!overlay) return;
  const draftWrap = $('#review-complete-draft-wrap');
  const draftEl = $('#review-complete-draft');
  if (draftWrap) draftWrap.hidden = true;
  if (draftEl) draftEl.textContent = '';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  delete overlay.dataset.platform;
}

function showReviewCompleteOverlay(platform, { stealFocus = true } = {}) {
  const overlay = $('#review-complete-overlay');
  if (!overlay || platform == null || platformsPosted[platform]) return;
  if (currentState !== 'post') return;
  const meta = PLATFORM_META[platform] || { name: platform };
  const titleEl = $('#review-complete-title');
  const hintEl = $('#review-complete-hint');
  const draftWrap = $('#review-complete-draft-wrap');
  const draftEl = $('#review-complete-draft');
  const rawDraftText = String((drafts[platform] || reviewDraft || '')).trim();
  const draftText = formatDraftForOverlay(platform, rawDraftText);
  if (titleEl) titleEl.textContent = `Finished on ${meta.name}?`;
  if (hintEl) hintEl.textContent = reviewPublicationHint(meta.name);
  if (draftWrap && draftEl) {
    draftWrap.hidden = !draftText;
    draftEl.textContent = draftText;
  }
  overlay.dataset.platform = platform;
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  if (stealFocus) {
    $('#btn-review-complete-confirm')?.focus();
  }
}

/**
 * Legacy (non-guided) layout: ask "finished?" only once the visitor comes
 * back from the review tab. The popup argument is kept for call-site
 * compatibility; review sites always open in a tab now, so it is null.
 */
function presentReviewCompleteAfterOpen(platform, popup) {
  if (popup) {
    try { popup.focus(); } catch (_) { /* ignore */ }
  }
  scheduleReviewCompleteOverlay(platform);
}

/**
 * Opens a review site in a new browser tab. Must run from a user click.
 * A temporary anchor with target="_blank" is the most popup-blocker-friendly
 * way to do this. Always returns null: there is no popup window to track, and
 * the guided checklist plus the return-triggered confirm handle the way back.
 * (A centered mini window was tried 9/8; it covered Reputation Rocket instead
 * of keeping it visible, and tabs are what people already know.)
 */
function openReviewPlatform(url, platform) {
  if (!url) return null;

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return null;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(tmp);
    return ok;
  }
}

function resetPlatformPostProgress(platform) {
  delete platformsPosted[platform];
  delete platformPostedAt[platform];
  delete reviewFormOpened[platform];
  delete platformFieldsCopied[platform];
  initPostScreen();
  saveSession();
}

function initPostScreen() {
  const grid = $('#platform-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const rich = isRichPostLayout();

  PARAMS.platforms.forEach((plat, idx) => {
    const meta = PLATFORM_META[plat] || { name: plat, desc: 'Post your review', icon: 'globe', flow: 'paste' };
    const isPosted = platformsPosted[plat] || false;
    const flow = meta.flow || 'paste';

    const card = document.createElement('div');
    card.dataset.platform = plat;

    if (rich) {
      card.className = `platform-card platform-card--rich flow-${flow}${isPosted ? ' platform-card--posted' : ''}`;
      if (isPosted) {
        mountRichPostedCard(card, plat, meta, platformPostedAt[plat]);
      } else if (flow === 'fields') {
        mountRichG2UnpostedCard(card, plat, idx + 1, meta);
      } else {
        mountRichPasteUnpostedCard(card, plat, idx + 1, meta);
      }
    } else {
      card.className = `platform-card flow-${flow}${isPosted ? ' posted' : ''}`;
      const header = `
      <div class="platform-icon">${getPlatformIcon(meta.icon)}</div>
      <h4>${meta.name}</h4>
      <p>${meta.desc}</p>
    `;

      if (isPosted) {
        card.innerHTML = header + '<span class="platform-status done">Marked submitted</span>';
      } else if (flow === 'fields') {
        card.innerHTML = header + renderG2CardBody(plat);
      } else {
        card.innerHTML = header + `
        <span class="platform-status ready" data-action="post-paste" data-platform="${plat}">Copy &amp; open ${meta.name} →</span>
        <p class="platform-hint">We'll ask you to confirm when you return to this tab</p>
      `;
      }
    }
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-action="post-paste"]').forEach(btn => {
    btn.addEventListener('click', () => handlePastePost(btn.dataset.platform));
  });
  grid.querySelectorAll('[data-action="view-review-link"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) openReviewPlatform(link, plat);
    });
  });
  grid.querySelectorAll('[data-action="post-another"]').forEach(btn => {
    btn.addEventListener('click', () => resetPlatformPostProgress(btn.dataset.platform));
  });
  // open-form: multi-field flows (G2/Gartner). Rich layout enters the guided
  // checklist (auto-copies the first answer, no overlay). Legacy layout keeps
  // the return-triggered confirm overlay.
  grid.querySelectorAll('[data-action="open-form"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      const popup = link ? openReviewPlatform(link, plat) : null;
      reviewFormOpened[plat] = true;
      if (isRichPostLayout()) {
        const fields = parseG2Fields(drafts[plat] || reviewDraft || '');
        if (fields.length > 0) {
          const ok = await copyToClipboard(fields[0].body);
          if (ok) {
            markFieldCopied(plat, 0);
            showToast();
          }
        }
        saveSession();
        initPostScreen();
        return;
      }
      saveSession();
      initPostScreen();
      presentReviewCompleteAfterOpen(plat, popup);
    });
  });
  grid.querySelectorAll('[data-action="open-only"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) {
        const popup = openReviewPlatform(link, plat);
        presentReviewCompleteAfterOpen(plat, popup);
      }
    });
  });
  // reopen-window: guided cards offer a way back to the review tab if the visitor closed it.
  grid.querySelectorAll('[data-action="reopen-window"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) openReviewPlatform(link, plat);
    });
  });
  grid.querySelectorAll('[data-action="confirm-posted"]').forEach(btn => {
    btn.addEventListener('click', () => markPlatformPosted(btn.dataset.platform));
  });
  // Wire per-field / per-section copy buttons
  grid.querySelectorAll('[data-action="copy-section"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await copyToClipboard(btn.dataset.text);
      if (ok) showToast();
      const plat = btn.dataset.platform;
      const idx = Number(btn.dataset.idx);
      // Guided cards persist copied state and advance the checklist.
      if (isRichPostLayout() && plat && reviewFormOpened[plat] && Number.isInteger(idx)) {
        markFieldCopied(plat, idx);
        initPostScreen();
        return;
      }
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });
  // Wire "copy entire draft" buttons
  grid.querySelectorAll('[data-action="copy-all"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const plat = btn.dataset.platform;
      const ok = await copyToClipboard(drafts[plat] || reviewDraft || '');
      if (ok) showToast();
    });
  });
  updatePostContinueButton();
  updatePostProgress();
  syncPostStayNudge();
}

function renderG2CardBody(plat) {
  const draft = drafts[plat] || reviewDraft || '';
  const fields = parseG2Fields(draft);
  const link = PARAMS.reviewLinks[plat] || '';
  const name = platformDisplayName(plat);

  if (fields.length === 0) {
    // backwards-compat fallback: no markers found, treat as paste flow
    return `
      <span class="platform-status ready" data-action="post-paste" data-platform="${plat}">Copy &amp; open ${escapeHtml(name)} →</span>
      <p class="platform-hint">We'll ask you to confirm when you return to this tab</p>
    `;
  }

  const fieldRows = fields.map((f, i) => `
    <div class="field-row">
      <div class="field-row-head">
        <span class="field-label">${escapeHtml(f.label)}</span>
        <button type="button" class="btn-copy" data-action="copy-section" data-text="${escapeAttr(f.body)}">Copy</button>
      </div>
      <p class="field-body">${escapeHtml(f.body)}</p>
    </div>
  `).join('');

  const g2Hint = `Open the ${name} form first (button above). Then copy each answer below into ${name}.`;

  return `
    <span class="platform-status ready" data-action="open-form" data-platform="${plat}">Open ${escapeHtml(name)} review form →</span>
    <p class="platform-hint">${escapeHtml(g2Hint)}</p>
    <details class="card-details" open>
      <summary>Your answers for ${escapeHtml(name)} (${fields.length})</summary>
      <div class="card-details-body">
        ${fieldRows}
      </div>
    </details>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/\n/g, '&#10;');
}

function getPlatformIcon(type) {
  const icons = {
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    award: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
  };
  return icons[type] || icons.globe;
}

async function handlePastePost(platform, opts = {}) {
  const { skipOverlay = false } = opts;
  const link = PARAMS.reviewLinks[platform];
  const draftText = drafts[platform] || reviewDraft || '';

  const popup = link ? openReviewPlatform(link, platform) : null;

  if (isRichPostLayout()) {
    // Guided checklist takes over; the draft is copied below either way.
    reviewFormOpened[platform] = true;
    markFieldCopied(platform, 0);
    initPostScreen();
  } else if (!skipOverlay) {
    presentReviewCompleteAfterOpen(platform, popup);
  }

  try {
    await navigator.clipboard.writeText(draftText);
    showToast();
  } catch (_) {
    const tmp = document.createElement('textarea');
    tmp.value = draftText;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showToast();
  }
}

function markPlatformPosted(platform) {
  platformsPosted[platform] = true;
  platformPostedAt[platform] = new Date().toISOString();
  triggerConfetti({ count: 50, duration: 2 });
  initPostScreen();
  saveSession();
}

function updatePostContinueButton() {
  const postedCount = Object.values(platformsPosted).filter(Boolean).length;
  const btn = $('#btn-continue-post');
  if (btn) {
    btn.disabled = postedCount === 0;
    const svg = btn.querySelector('svg');
    const label = isVideoStepEnabled() ? 'Continue to next step' : 'Finish';
    btn.textContent = `${label} `;
    if (svg) btn.appendChild(svg);
  }
  const sub = $('#post-continue-sub');
  if (!sub) return;
  if (isVideoStepEnabled()) {
    sub.hidden = false;
    sub.textContent = 'Next up: Record a quick video';
  } else {
    const text = clientCopy('postFinishHint', null, "You're all set. We'll wrap up on the next screen.");
    sub.hidden = !text;
    sub.textContent = text;
  }
}

function updatePostProgress() {
  const total = PARAMS.platforms.length;
  const posted = Object.values(platformsPosted).filter(Boolean).length;
  const pct = total ? Math.round((posted / total) * 100) : 0;
  const fill = $('#post-progress-fill');
  const text = $('#post-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${posted} of ${total} confirmed`;
  const headline = $('#post-progress-headline');
  if (headline) headline.textContent = `${posted} of ${total} reviews posted`;
}

function handleContinueAfterPost() {
  if (isVideoStepEnabled()) {
    transitionTo('video');
  } else {
    transitionTo('complete');
  }
}

/**
 * Native leave-site prompt while the visitor is still on the review-post step
 * with unconfirmed platforms. Modern browsers ignore custom copy and show a
 * generic “Leave site?” dialog — that is the only blocking API available.
 * Opening a review site in a new tab does not fire this.
 */
let allowPageUnload = false;

function shouldWarnBeforeLeavingReviewPost() {
  if (allowPageUnload) return false;
  if (currentState !== 'post') return false;
  const platforms = PARAMS.platforms || [];
  if (!platforms.length) return false;
  return platforms.some((plat) => !platformsPosted[plat]);
}

function onBeforeUnloadReviewPost(event) {
  if (!shouldWarnBeforeLeavingReviewPost()) return;
  event.preventDefault();
  event.returnValue = '';
}

function postStayNudgeStorageKey() {
  return `rr-post-stay-nudge:${PARAMS.clientSlug || 'default'}`;
}

function isPostStayNudgeDismissed() {
  try {
    return sessionStorage.getItem(postStayNudgeStorageKey()) === '1';
  } catch (_) {
    return false;
  }
}

function dismissPostStayNudge() {
  try {
    sessionStorage.setItem(postStayNudgeStorageKey(), '1');
  } catch (_) { /* ignore */ }
  const el = document.getElementById('post-stay-nudge');
  if (!el) return;
  el.classList.remove('is-visible');
  el.hidden = true;
}

function reviewSitePhrase() {
  const names = (PARAMS.platforms || []).map((id) => (PLATFORM_META[id] || {}).name || id);
  if (names.length <= 1) return names[0] || 'the review site';
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `one of the ${names.length} review sites`;
}

function ensurePostStayNudge() {
  let el = document.getElementById('post-stay-nudge');
  if (el) return el;

  el = document.createElement('aside');
  el.id = 'post-stay-nudge';
  el.className = 'post-stay-nudge';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'post-stay-nudge-title');
  el.setAttribute('aria-describedby', 'post-stay-nudge-body');
  el.innerHTML = `
    <div class="post-stay-nudge-accent" aria-hidden="true"></div>
    <button type="button" class="post-stay-nudge-close" aria-label="Dismiss reminder">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </button>
    <div class="post-stay-nudge-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <div class="post-stay-nudge-copy">
      <p id="post-stay-nudge-title" class="post-stay-nudge-title"></p>
      <p id="post-stay-nudge-body" class="post-stay-nudge-body"></p>
    </div>
  `;
  el.querySelector('.post-stay-nudge-close').addEventListener('click', dismissPostStayNudge);
  document.body.appendChild(el);
  return el;
}

function syncPostStayNudge() {
  const el = ensurePostStayNudge();
  // Only nag once the visitor has actually opened a review site. Before that
  // the reminder has nothing to remind them of and just reads as noise.
  const anyFormOpened = (PARAMS.platforms || []).some((plat) => Boolean(reviewFormOpened[plat]));
  const show = anyFormOpened && shouldWarnBeforeLeavingReviewPost() && !isPostStayNudgeDismissed();
  const provider = clientDisplayName();
  const total = (PARAMS.platforms || []).length;
  const posted = Object.values(platformsPosted).filter(Boolean).length;
  const titleEl = el.querySelector('#post-stay-nudge-title');
  const bodyEl = el.querySelector('#post-stay-nudge-body');
  if (posted > 0) {
    // Acknowledge progress so the reminder never feels like it ignored the click.
    const remaining = Math.max(0, total - posted);
    titleEl.textContent = `${posted} down, ${remaining} to go 🎉`;
    bodyEl.textContent = clientCopy(
      'postNudgeProgress',
      { provider },
      `Nice work! Confirm the rest so ${provider} can see your reviews.`
    );
  } else {
    titleEl.textContent = 'Wait, did you post yet?';
    bodyEl.textContent =
      `Your reviews won’t be posted unless you visit ${reviewSitePhrase()}. Come back here and confirm so ${provider} can see them.`;
  }

  // Reserve room so the floating reminder never sits on top of the cards.
  const postScreen = document.getElementById('screen-post');
  if (postScreen) postScreen.classList.toggle('has-stay-nudge', show);

  if (!show) {
    el.classList.remove('is-visible');
    el.hidden = true;
    return;
  }

  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-visible'));
}

function isVideoStepEnabled() {
  return Boolean(CLIENT_CONFIG.videoCaptureEnabled || PARAMS.videoUrl);
}

/** Hide the Video progress step (and trailing connector) when capture is off. */
function applyVideoStepVisibility() {
  const videoStep = document.querySelector('.progress-step[data-step="5"]');
  const postStep = document.querySelector('.progress-step[data-step="4"]');
  const postConnector = postStep?.querySelector('.progress-connector');
  const enabled = isVideoStepEnabled();
  if (videoStep) videoStep.hidden = !enabled;
  if (postConnector) postConnector.hidden = !enabled;
}

function initVideoScreen() {
  const status = document.getElementById('video-status-text');
  if (status) {
    const maxMins = Math.floor(VIDEO_CAPTURE_SETTINGS.maxSeconds / 60);
    status.textContent = `Record up to ${maxMins} minutes (~${VIDEO_CAPTURE_SETTINGS.maxUploadMB}MB). Upload only happens after you confirm.`;
    status.classList.remove('error');
  }
}

/** Build the interview-question list items (modal <ol>) from PARAMS.interviewQuestions. */
function interviewQuestionsListHTML() {
  return PARAMS.interviewQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join('');
}

/** Populate the video screen's question list (numbered cards) from config. */
function renderVideoScreenQuestions() {
  const wrap = document.querySelector('#screen-video .video-questions');
  if (!wrap) return;
  wrap.innerHTML = PARAMS.interviewQuestions
    .map((q, i) => `<div class="video-question"><span class="q-num">${i + 1}</span><p>${escapeHtml(q)}</p></div>`)
    .join('');
}

function ensureVideoCaptureModal() {
  let modal = document.getElementById('video-capture-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'video-capture-modal';
  modal.className = 'video-capture-modal';
  modal.setAttribute('hidden', '');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <button type="button" class="video-capture-modal__backdrop" aria-label="Close dialog"></button>
    <div class="video-capture-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="video-capture-title">
      <button type="button" class="video-capture-modal__close" aria-label="Close dialog">×</button>
      <h3 id="video-capture-title" class="video-capture-modal__title">Record your testimonial</h3>
      <p class="video-capture-modal__hint">Max length: ${formatVideoDuration(VIDEO_CAPTURE_SETTINGS.maxSeconds)}. Please keep your camera and mic on while recording.</p>

      <div id="video-capture-step-permission" class="video-capture-modal__step">
        <div id="video-capture-permission" class="video-capture-modal__permission">
          <p class="video-capture-modal__permission-text">
            Allow camera and microphone access in your browser prompt.
            If blocked, click the lock/camera icon near the address bar and enable access for this site.
          </p>
          <button type="button" id="btn-video-enable-permissions" class="btn btn-primary btn-sm">Enable camera & microphone</button>
        </div>
        <p id="video-capture-setup-error" class="video-capture-modal__error" hidden></p>
      </div>

      <div id="video-capture-step-settings" class="video-capture-modal__step" hidden>
        <div class="video-capture-modal__device-grid">
          <label class="video-capture-modal__field">
            <span>Camera</span>
            <select id="video-input-select" class="video-capture-modal__select"></select>
          </label>
          <label class="video-capture-modal__field">
            <span>Microphone</span>
            <select id="audio-input-select" class="video-capture-modal__select"></select>
          </label>
        </div>
        <p id="video-capture-settings-error" class="video-capture-modal__error" hidden></p>

        <div class="video-capture-modal__upload">
          <button type="button" id="btn-video-continue" class="btn btn-primary">Continue to recorder</button>
        </div>
      </div>

      <div id="video-capture-step-recorder" class="video-capture-modal__step" hidden>
        <div class="video-capture-modal__questions">
          <p class="video-capture-modal__questions-label">Interview questions</p>
          <ol class="video-capture-modal__questions-list">
            ${interviewQuestionsListHTML()}
          </ol>
          <p style="margin-top: 14px;font-size: 14px">Just imagine you're telling a friend about your experience. That's it!</p>
        </div>

        <div class="video-capture-modal__preview">
          <video id="video-capture-preview" playsinline muted autoplay></video>
        </div>

        <div class="video-capture-modal__meta">
          <span id="video-capture-timer">00:00 / ${formatVideoDuration(VIDEO_CAPTURE_SETTINGS.maxSeconds)}</span>
        </div>
        <p id="video-capture-error" class="video-capture-modal__error" hidden></p>

        <div id="video-capture-recorder-controls" class="video-capture-modal__actions">
          <button type="button" id="btn-video-start" class="btn btn-primary btn-sm">Record my video</button>
          <button type="button" id="btn-video-stop" class="btn btn-secondary btn-sm" hidden>Stop</button>
          <button type="button" id="btn-video-reset" class="btn btn-secondary btn-sm" hidden>Reset</button>
        </div>

        <div id="video-capture-upload-wrap" class="video-capture-modal__upload">
          <button type="button" id="btn-video-upload" class="btn btn-primary">Submit video</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target.classList.contains('video-capture-modal__backdrop') || e.target.closest('.video-capture-modal__close')) {
      e.preventDefault();
      closeVideoCaptureModal();
    }
  });

  document.getElementById('btn-video-start')?.addEventListener('click', handlePrimaryVideoButton);
  document.getElementById('btn-video-enable-permissions')?.addEventListener('click', requestVideoPermissions);
  document.getElementById('btn-video-continue')?.addEventListener('click', continueToVideoRecorderStep);
  document.getElementById('btn-video-stop')?.addEventListener('click', stopVideoRecording);
  document.getElementById('btn-video-reset')?.addEventListener('click', resetVideoRecordingState);
  document.getElementById('btn-video-upload')?.addEventListener('click', uploadRecordedVideoToHubSpot);
  document.getElementById('video-input-select')?.addEventListener('change', handleVideoInputChange);
  document.getElementById('audio-input-select')?.addEventListener('change', handleAudioInputChange);

  return modal;
}

async function openVideoCaptureModal() {
  const modal = ensureVideoCaptureModal();
  modal.removeAttribute('hidden');
  modal.setAttribute('aria-hidden', 'false');
  terminateVideoCaptureSession();
  hideVideoCaptureError();
  updateVideoRecorderMeta();
  await refreshMediaDeviceOptions();
  let alreadyGranted = false;
  try {
    await ensureVideoStream();
    alreadyGranted = true;
  } catch (_) {
    alreadyGranted = false;
  } finally {
    if (videoStream) stopVideoStream();
  }
  setVideoModalStep(alreadyGranted ? 'settings' : 'permission');
  renderVideoRecorderState();
}

function closeVideoCaptureModal() {
  const modal = document.getElementById('video-capture-modal');
  if (!modal) return;
  terminateVideoCaptureSession();
  modal.setAttribute('hidden', '');
  modal.setAttribute('aria-hidden', 'true');
}

async function ensureVideoStream() {
  if (videoStream) {
    const preview = document.getElementById('video-capture-preview');
    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.srcObject = videoStream;
      preview.controls = false;
      preview.muted = true;
      preview.play().catch(() => {});
    }
    return videoStream;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser does not support camera recording.');
  }

  const videoConstraint = videoInputDeviceId
    ? { deviceId: { exact: videoInputDeviceId } }
    : {
      width: { ideal: VIDEO_CAPTURE_SETTINGS.width },
      height: { ideal: VIDEO_CAPTURE_SETTINGS.height },
      facingMode: 'user',
    };
  const audioConstraint = audioInputDeviceId
    ? { deviceId: { exact: audioInputDeviceId } }
    : true;

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraint,
      audio: audioConstraint,
    });
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      throw new Error('Camera/microphone access was blocked. Please enable access for this site and try again.');
    }
    throw err;
  }
  const preview = document.getElementById('video-capture-preview');
  if (preview) {
    preview.srcObject = videoStream;
    preview.muted = true;
    preview.play().catch(() => {});
  }
  await refreshMediaDeviceOptions();
  return videoStream;
}

function setVideoModalStep(step) {
  const permission = document.getElementById('video-capture-step-permission');
  const settings = document.getElementById('video-capture-step-settings');
  const recorder = document.getElementById('video-capture-step-recorder');
  if (permission) permission.hidden = step !== 'permission';
  if (settings) settings.hidden = step !== 'settings';
  if (recorder) recorder.hidden = step !== 'recorder';
}

async function refreshMediaDeviceOptions() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (_) {
    return;
  }
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput');
  populateMediaSelect('video-input-select', cameras, 'Camera', videoInputDeviceId, (nextId) => {
    videoInputDeviceId = nextId;
  });
  populateMediaSelect('audio-input-select', mics, 'Microphone', audioInputDeviceId, (nextId) => {
    audioInputDeviceId = nextId;
  });
}

function populateMediaSelect(selectId, devices, fallbackLabel, selectedId, onSelect) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const nextSelected = selectedId && devices.some((d) => d.deviceId === selectedId)
    ? selectedId
    : (devices[0] ? devices[0].deviceId : '');
  onSelect(nextSelected);

  const options = devices.map((device, idx) => {
    const label = (device.label || `${fallbackLabel} ${idx + 1}`).trim();
    return `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(label)}</option>`;
  }).join('');

  select.innerHTML = options || `<option value="">No ${fallbackLabel.toLowerCase()} detected</option>`;
  select.value = nextSelected;
}

async function continueToVideoRecorderStep() {
  hideVideoCaptureError();
  try {
    stopVideoStream();
    await ensureVideoStream();
    setVideoModalStep('recorder');
    renderVideoRecorderState();
  } catch (err) {
    showVideoCaptureError(err.message || 'Unable to access camera/microphone.');
  }
}

function handleVideoInputChange(e) {
  videoInputDeviceId = e.target.value || '';
}

function handleAudioInputChange(e) {
  audioInputDeviceId = e.target.value || '';
}

async function requestVideoPermissions() {
  hideVideoCaptureError();
  try {
    await ensureVideoStream();
    stopVideoStream();
    await refreshMediaDeviceOptions();
    setVideoModalStep('settings');
  } catch (err) {
    showVideoCaptureError(err.message || 'Unable to access camera/microphone.');
  }
}

function stopVideoStream() {
  stopFramedRecordingStream();
  if (!videoStream) return;
  videoStream.getTracks().forEach((track) => track.stop());
  videoStream = null;
  const preview = document.getElementById('video-capture-preview');
  if (preview) preview.srcObject = null;
}

function pickRecorderMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/webm;codecs=vp9,opus',
  ];
  for (const mime of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function startVideoTimer() {
  clearVideoTimer();
  videoTimerId = setInterval(() => {
    videoElapsedSec += 1;
    if (videoElapsedSec >= VIDEO_CAPTURE_SETTINGS.maxSeconds) {
      stopVideoRecording();
      showVideoCaptureError(`Recording stopped at the ${formatVideoDuration(VIDEO_CAPTURE_SETTINGS.maxSeconds)} limit.`);
    }
    updateVideoRecorderMeta();
  }, 1000);
}

function clearVideoTimer() {
  if (videoTimerId) clearInterval(videoTimerId);
  videoTimerId = null;
}

function updateVideoRecorderMeta() {
  const timer = document.getElementById('video-capture-timer');
  if (timer) {
    timer.textContent = `${formatVideoDuration(videoElapsedSec)} / ${formatVideoDuration(VIDEO_CAPTURE_SETTINGS.maxSeconds)}`;
  }
}

function formatVideoDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Build a 16:9 recording stream from the raw camera stream. The camera frame is
 * drawn (centered, object-fit: contain) onto a fixed 16:9 canvas with a
 * background fill, and the canvas video track is combined with the original
 * audio. This guarantees the uploaded file is always 16:9 even when the camera
 * provides a 4:3 or portrait feed. Returns null if canvas capture isn't
 * supported, in which case the caller falls back to the raw stream.
 */
function buildFramedRecordingStream(sourceStream) {
  if (!sourceStream || typeof document.createElement('canvas').captureStream !== 'function') {
    return null;
  }
  const videoTrack = sourceStream.getVideoTracks()[0];
  if (!videoTrack) return null;

  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_CAPTURE_SETTINGS.width;
  canvas.height = VIDEO_CAPTURE_SETTINGS.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const src = document.createElement('video');
  src.muted = true;
  src.playsInline = true;
  src.srcObject = sourceStream;
  src.play().catch(() => {});
  videoFrameSourceEl = src;

  const bg = VIDEO_CAPTURE_SETTINGS.backgroundFill || '#000000';
  const draw = () => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const vw = src.videoWidth;
    const vh = src.videoHeight;
    if (vw && vh) {
      const scale = Math.min(canvas.width / vw, canvas.height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(src, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    }
    videoFrameRafId = requestAnimationFrame(draw);
  };
  draw();

  const framedStream = canvas.captureStream(VIDEO_CAPTURE_SETTINGS.frameRate || 30);
  sourceStream.getAudioTracks().forEach((track) => framedStream.addTrack(track));
  videoRecordingStream = framedStream;
  return framedStream;
}

function stopFramedRecordingStream() {
  if (videoFrameRafId) {
    cancelAnimationFrame(videoFrameRafId);
    videoFrameRafId = null;
  }
  if (videoFrameSourceEl) {
    videoFrameSourceEl.pause();
    videoFrameSourceEl.srcObject = null;
    videoFrameSourceEl = null;
  }
  if (videoRecordingStream) {
    // Stop only the canvas video track; audio tracks are shared with
    // videoStream (reused for re-records) and must stay live.
    videoRecordingStream.getVideoTracks().forEach((track) => track.stop());
    videoRecordingStream = null;
  }
}

async function startVideoRecording() {
  hideVideoCaptureError();
  await ensureVideoStream();
  if (!window.MediaRecorder) {
    showVideoCaptureError('This browser does not support recording.');
    return;
  }

  const mimeType = pickRecorderMimeType();
  const recordingStream = buildFramedRecordingStream(videoStream) || videoStream;

  const preview = document.getElementById('video-capture-preview');
  if (preview) {
    preview.pause();
    preview.removeAttribute('src');
    // Show the framed (16:9) stream so the preview matches the recording.
    preview.srcObject = recordingStream;
    preview.controls = false;
    preview.muted = true;
    preview.play().catch(() => {});
  }

  try {
    videoChunks = [];
    videoRecordedBlob = null;
    videoRecordedMime = mimeType || 'video/webm';
    videoElapsedSec = 0;
    videoRecorder = new MediaRecorder(recordingStream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: VIDEO_CAPTURE_SETTINGS.videoBitsPerSecond,
      audioBitsPerSecond: VIDEO_CAPTURE_SETTINGS.audioBitsPerSecond,
    });
  } catch (err) {
    stopFramedRecordingStream();
    showVideoCaptureError(`Unable to start recording: ${err.message}`);
    return;
  }

  videoRecorder.ondataavailable = (evt) => {
    if (!evt.data || !evt.data.size) return;
    videoChunks.push(evt.data);
    const total = videoChunks.reduce((sum, c) => sum + c.size, 0);
    if (total > VIDEO_CAPTURE_SETTINGS.maxUploadBytes) {
      showVideoCaptureError(`Recording reached the max upload size (~${VIDEO_CAPTURE_SETTINGS.maxUploadMB}MB).`);
      stopVideoRecording();
    }
    updateVideoRecorderMeta();
  };

  videoRecorder.onstop = () => {
    clearVideoTimer();
    stopFramedRecordingStream();
    videoRecordedBlob = new Blob(videoChunks, { type: videoRecordedMime || 'video/webm' });
    const preview = document.getElementById('video-capture-preview');
    if (preview && videoRecordedBlob && videoRecordedBlob.size > 0) {
      preview.srcObject = null;
      preview.src = URL.createObjectURL(videoRecordedBlob);
      preview.controls = true;
      preview.muted = false;
    }
    renderVideoRecorderState();
  };

  videoRecorder.onerror = (evt) => {
    showVideoCaptureError(`Recording error: ${evt.error?.message || 'Unknown issue'}`);
    clearVideoTimer();
    stopFramedRecordingStream();
    renderVideoRecorderState();
  };

  // Use a single finalized recording blob for better media metadata compatibility.
  videoRecorder.start();
  startVideoTimer();
  renderVideoRecorderState();
}

async function handlePrimaryVideoButton() {
  const state = videoRecorder ? videoRecorder.state : 'inactive';
  if (state === 'inactive') {
    await startVideoRecording();
    return;
  }
  if (state === 'recording') {
    videoRecorder.pause();
    clearVideoTimer();
    renderVideoRecorderState();
    return;
  }
  if (state === 'paused') {
    videoRecorder.resume();
    startVideoTimer();
    renderVideoRecorderState();
  }
}

function stopVideoRecording() {
  if (!videoRecorder) return;
  if (videoRecorder.state === 'inactive') return;
  clearVideoTimer();
  videoRecorder.stop();
  renderVideoRecorderState();
}

function resetVideoRecordingState() {
  if (videoRecorder && videoRecorder.state !== 'inactive') {
    videoRecorder.stop();
  }
  stopFramedRecordingStream();
  videoRecorder = null;
  videoChunks = [];
  videoRecordedBlob = null;
  videoRecordedMime = '';
  videoElapsedSec = 0;
  clearVideoTimer();
  const preview = document.getElementById('video-capture-preview');
  if (preview) {
    preview.controls = false;
    preview.muted = true;
    preview.removeAttribute('src');
    preview.load();
    if (videoStream) {
      preview.srcObject = videoStream;
      preview.play().catch(() => {});
    }
  }
  updateVideoRecorderMeta();
  renderVideoRecorderState();
  hideVideoCaptureError();
}

function terminateVideoCaptureSession() {
  clearVideoTimer();
  if (videoRecorder) {
    try {
      videoRecorder.ondataavailable = null;
      videoRecorder.onerror = null;
      videoRecorder.onstop = null;
      if (videoRecorder.state !== 'inactive') {
        videoRecorder.stop();
      }
    } catch (_) { /* ignore */ }
  }
  videoRecorder = null;
  videoChunks = [];
  videoRecordedBlob = null;
  videoRecordedMime = '';
  videoElapsedSec = 0;
  stopVideoStream();
  const preview = document.getElementById('video-capture-preview');
  if (preview) {
    preview.pause();
    preview.removeAttribute('src');
    preview.srcObject = null;
    preview.controls = false;
    preview.muted = true;
    preview.load();
  }
}

function renderVideoRecorderState() {
  const state = videoRecorder ? videoRecorder.state : 'inactive';
  const hasBlob = !!(videoRecordedBlob && videoRecordedBlob.size > 0);

  const start = document.getElementById('btn-video-start');
  const stop = document.getElementById('btn-video-stop');
  const reset = document.getElementById('btn-video-reset');
  const upload = document.getElementById('btn-video-upload');

  if (start) {
    start.hidden = false;
    start.disabled = videoIsUploading;
    if (state === 'recording') start.textContent = 'Pause';
    else if (state === 'paused') start.textContent = 'Resume';
    else if (hasBlob) start.textContent = 'Record again';
    else start.textContent = 'Record my video';
  }
  if (stop) {
    const canStop = state === 'recording' || state === 'paused';
    stop.hidden = !canStop;
    stop.disabled = !canStop || videoIsUploading;
  }
  if (reset) {
    reset.hidden = !(state === 'inactive' && hasBlob);
    reset.disabled = !(state === 'inactive' && hasBlob) || videoIsUploading;
  }
  if (upload) {
    upload.disabled = !hasBlob || videoIsUploading;
    upload.textContent = videoIsUploading ? 'Submitting...' : 'Submit video';
  }
}

function showVideoCaptureError(message) {
  const els = [
    document.getElementById('video-capture-error'),
    document.getElementById('video-capture-setup-error'),
    document.getElementById('video-capture-settings-error'),
  ].filter(Boolean);
  els.forEach((el) => {
    el.hidden = false;
    el.textContent = message;
  });
}

function hideVideoCaptureError() {
  const els = [
    document.getElementById('video-capture-error'),
    document.getElementById('video-capture-setup-error'),
    document.getElementById('video-capture-settings-error'),
  ].filter(Boolean);
  els.forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
}

async function uploadRecordedVideoToHubSpot() {
  if (!videoRecordedBlob || videoIsUploading) return;
  hideVideoCaptureError();
  videoIsUploading = true;
  renderVideoRecorderState();

  const lead = getLeadFieldsForApi();
  const portalId = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  if (!portalId) {
    showVideoCaptureError('This client is missing hubspotPortalId in config.js.');
    videoIsUploading = false;
    renderVideoRecorderState();
    return;
  }
  const ext = videoRecordedMime.includes('mp4') ? 'mp4' : 'webm';
  const fileName =
    `${String(PARAMS.firstName || PARAMS.name || 'visitor').split(/\s+/)[0]}_reprocket_testimonial.${ext}`;

  const form = new FormData();
  form.append('video', videoRecordedBlob, fileName);
  form.append('portalId', portalId);
  form.append('clientSlug', String(PARAMS.clientSlug || 'default'));
  form.append('sessionId', String(sessionId || ''));
  form.append('firstName', String(PARAMS.firstName || '').trim());
  form.append('visitorCompany', String(PARAMS.visitorCompany || '').trim());
  form.append('customerName', lead.customer_name || '');
  form.append('customerEmail', lead.customer_email || '');
  form.append('customerCompany', lead.client_name || PARAMS.customerCompany || '');

  try {
    if (isTestHost()) {
      console.info('[Reputation Rocket] Test host, video not uploaded to HubSpot:', { fileName, portalId });
      uploadedVideoMeta = {
        id: '',
        url: '',
        name: fileName,
        portalId,
        uploadedAt: new Date().toISOString(),
      };
      closeVideoCaptureModal();
      const held = document.getElementById('video-status-text');
      if (held) {
        held.textContent = 'Test host: video was not sent to HubSpot.';
        held.classList.remove('error');
      }
      transitionTo('complete');
      return;
    }
    const res = await fetch(CONFIG.VIDEO_UPLOAD_URL, { method: 'POST', body: form });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!res.ok) {
      throw new Error(payload.error || payload.message || `Upload failed (${res.status})`);
    }
    uploadedVideoMeta = {
      id: payload?.file?.id || '',
      url: payload?.file?.url || '',
      name: payload?.file?.name || '',
      portalId: payload?.portal_id || portalId,
      uploadedAt: new Date().toISOString(),
    };
    closeVideoCaptureModal();
    const status = document.getElementById('video-status-text');
    if (status) {
      status.textContent = 'Video uploaded to HubSpot successfully.';
      status.classList.remove('error');
    }
    transitionTo('complete');
  } catch (err) {
    showVideoCaptureError(err.message || 'Upload failed. Please try again.');
    const status = document.getElementById('video-status-text');
    if (status) {
      status.textContent = 'Video upload failed. You can retry or skip.';
      status.classList.add('error');
    }
  } finally {
    videoIsUploading = false;
    renderVideoRecorderState();
  }
}

// ── Toast ───────────────────────────────────────────────────
function showToast() {
  const toast = $('#toast');
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ── Screen 6: Complete ──────────────────────────────────────
function initCompleteScreen() {
  const posted = Object.values(platformsPosted).filter(Boolean).length;
  const statReviews = $('#stat-reviews');
  if (statReviews) statReviews.textContent = posted;
  const videoStat = document.getElementById('stat-video-container');
  if (videoStat) {
    videoStat.style.display = uploadedVideoMeta ? '' : 'none';
  }
  triggerConfetti();
  sendLifecycleNotification('completed');
  markHubSpotContactComplete('positive');
  maybeRedirectToThankYou();
}

async function patchHubSpotContact(properties, { attempts = 5, delayMs = 700, role = '' } = {}) {
  if (!CONFIG.HUBSPOT_CONTACT_URL) return false;
  if (!properties || typeof properties !== 'object' || !Object.keys(properties).length) return false;

  const portalId = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  if (!portalId) return false;
  if (isTestHost()) {
    console.info('[Reputation Rocket] Test host, HubSpot contact not updated:', properties);
    return true;
  }

  const email = (getLeadFieldsForApi().customer_email || PARAMS.email || '').trim();
  if (!email || email === 'Unknown') return false;

  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    if (role === 'incomplete' && hubspotCompleteSent) return true;
    try {
      const res = await fetch(CONFIG.HUBSPOT_CONTACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_slug: PARAMS.clientSlug,
          portal_id: portalId,
          email,
          properties,
        }),
      });

      if (res.ok) return true;

      const errorText = await res.text();
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed.detail || parsed.error || parsed.message || errorText;
      } catch (_) { /* not JSON */ }
      lastErr = new Error(`${res.status}: ${detail}`);
      if (res.status !== 404 && res.status !== 502) break;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
  }

  console.warn('[Reputation Rocket] HubSpot contact property update failed:', lastErr);
  return false;
}

function markHubSpotContactIncomplete() {
  if (isGuestOperatorSession()) return;
  if (hubspotCompleteSent || hubspotIncompleteSent) return;

  const completeProperty = String(CLIENT_CONFIG.hubspotCompleteProperty || '').trim();
  const incompleteValue = String(
    CLIENT_CONFIG.hubspotIncompleteValue
    || CLIENT_CONFIG.hubspotCompleteIncompleteValue
    || 'No'
  ).trim();
  if (!completeProperty || !incompleteValue) return;

  window.setTimeout(() => {
    if (hubspotCompleteSent || hubspotIncompleteSent) return;
    patchHubSpotContact(
      { [completeProperty]: incompleteValue },
      { role: 'incomplete' },
    ).then((ok) => {
      if (!ok || hubspotCompleteSent) return;
      hubspotIncompleteSent = true;
      saveSession();
    });
  }, 1500);
}

async function markHubSpotContactComplete(outcome) {
  if (isGuestOperatorSession()) return;
  if (hubspotCompleteSent) return;

  const completeProperty = String(CLIENT_CONFIG.hubspotCompleteProperty || '').trim();
  const completeValue = String(CLIENT_CONFIG.hubspotCompleteValue || 'Yes').trim();
  const outcomeProperty = String(CLIENT_CONFIG.hubspotOutcomeProperty || '').trim();

  if (!completeProperty && !outcomeProperty) return;

  const properties = {};
  if (completeProperty && completeValue) {
    properties[completeProperty] = completeValue;
  }
  if (outcomeProperty && (outcome === 'positive' || outcome === 'negative')) {
    const outcomeValue = outcome === 'negative'
      ? String(CLIENT_CONFIG.hubspotOutcomeNegativeValue || 'negative').trim()
      : String(CLIENT_CONFIG.hubspotOutcomePositiveValue || 'positive').trim();
    if (outcomeValue) properties[outcomeProperty] = outcomeValue;
  }
  if (!Object.keys(properties).length) return;

  const ok = await patchHubSpotContact(properties);
  if (!ok) return;
  hubspotCompleteSent = true;
  saveSession();
}

function maybeRedirectToThankYou() {
  if (isGuestOperatorSession()) return;
  if (!PARAMS.thankYouUrl) return;
  if (!isAllowedRedirectUrl(PARAMS.thankYouUrl)) {
    console.warn('[Reputation Rocket] Blocked unapproved thank_you_url:', PARAMS.thankYouUrl);
    return;
  }
  // Avoid duplicate hint if re-entered
  if (!document.getElementById('ty-hint')) {
    const host = document.querySelector('.screen.active .screen-content');
    if (host) {
      const wrap = document.createElement('p');
      wrap.className = 'text-center mt-md';
      const link = document.createElement('a');
      link.id = 'ty-hint';
      link.className = 'link-inline';
      link.href = PARAMS.thankYouUrl;
      link.textContent = `Go back to ${PARAMS.customerCompany}`;
      wrap.appendChild(link);
      host.appendChild(wrap);
    }
  }
  setTimeout(() => { window.location.href = PARAMS.thankYouUrl; }, PARAMS.thankYouRedirectDelayMs);
}

function triggerConfetti(opts = {}) {
  const { count = 70, duration = 3 } = opts;
  const container = $('#confetti-container');
  container.innerHTML = '';

  const cs = getComputedStyle(document.documentElement);
  const pick = (v, fallback) => (v && v.trim()) || fallback;
  const colors = [
    pick(cs.getPropertyValue('--ll-purple'), '#ffffff'),
    pick(cs.getPropertyValue('--ll-accent'), '#22c55e'),
    '#d5d7da',
    '#949494',
    '#ffffff',
    pick(cs.getPropertyValue('--ll-muted'), '#93949f'),
  ];

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const size = 4 + Math.random() * 6;
    const left = Math.random() * 100;
    const delay = Math.random() * Math.min(duration, 1.5);
    const dur = duration + Math.random() * (duration / 2);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = Math.random() > 0.5 ? '50%' : `${Math.random() * 4}px`;

    piece.style.cssText = `
      left: ${left}%;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${shape};
      animation-delay: ${delay}s;
      animation-duration: ${dur}s;
    `;
    container.appendChild(piece);
  }

  // Clean up after animation
  setTimeout(() => { container.innerHTML = ''; }, (duration + 3) * 1000);
}

// ── Screen 7: Negative ──────────────────────────────────────
function initNegativeScreen() {
  if (lastAgentMessage) {
    const cleanMsg = lastAgentMessage
      .replace(/<!--NEGATIVE_FLAG:[\s\S]*?-->/g, '')
      .replace(/<structured_output>[\s\S]*?<\/structured_output>/g, '')
      .trim();
    $('#empathy-message').innerHTML = renderMarkdown(cleanMsg);
  }

  sendLifecycleNotification('negative');
  markHubSpotContactComplete('negative');
}

async function sendLifecycleNotification(event) {
  if (isGuestOperatorSession()) return;
  if (!CONFIG.NOTIFY_URL || notificationsSent[event]) return;

  const lead = getNotifyLeadSnapshot();
  const payload = {
    event,
    client_slug: PARAMS.clientSlug,
    provider: PARAMS.providerName,
    client: lead.client,
    visitor_company: lead.visitor_company || '',
    customer_name: lead.customer_name,
    customer_email: lead.customer_email,
    rating: agentRating != null ? agentRating : starRating,
    posted: Object.keys(platformsPosted).filter(platform => platformsPosted[platform]),
    platforms: PARAMS.platforms,
    session_id: sessionId,
    ts: new Date().toISOString(),
    negative_flag: event === 'negative' ? negativeFlagData : null,
    video_testimonial: uploadedVideoMeta || null,
    transcript: Array.isArray(chatHistory)
      ? chatHistory
          .filter((m) => m && m.content && String(m.content).trim())
          .map((m) => ({ role: m.role, content: String(m.content).trim() }))
      : [],
    ...murkyMiddleNotifyFields(),
  };
  if (PARAMS.supportEmail) {
    payload.support_email = PARAMS.supportEmail;
  }
  if (isTestHost()) {
    console.info(`[Reputation Rocket] Test host, "${event}" notification not sent:`, payload);
    notificationsSent[event] = true;
    saveSession();
    return;
  }

  try {
    const res = await fetch(CONFIG.NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed.detail || parsed.error || parsed.message || errorText;
      } catch (_) { /* not JSON */ }
      const msg = `Notification failed (${res.status}): ${detail}`;
      if (event === 'negative') {
        showNegativeNotificationError(msg);
      }
      throw new Error(msg);
    }

    notificationsSent[event] = true;
    saveSession();
  } catch (err) {
    console.warn('[Reputation Rocket] Notification failed:', err);
  }
}

function showNegativeNotificationError(message) {
  if (document.getElementById('notification-fail')) return;
  const wrap = document.querySelector('#screen-negative .screen-content') || document.querySelector('#screen-negative');
  if (!wrap) return;
  const el = document.createElement('div');
  el.id = 'notification-fail';
  el.className = 'notification-fail';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  const empathy = document.getElementById('empathy-card');
  if (empathy && empathy.parentNode === wrap) {
    empathy.insertAdjacentElement('afterend', el);
  } else {
    wrap.insertBefore(el, wrap.firstChild);
  }
}

function isAllowedRedirectUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (!PARAMS.allowedRedirectHosts.length) return true;
    return PARAMS.allowedRedirectHosts.includes(url.hostname);
  } catch (_) {
    return false;
  }
}

// ── Platform display name ───────────────────────────────────
function platformDisplayName(platform) {
  const names = {
    hubspot: 'HubSpot', g2: 'G2', trustpilot: 'Trustpilot',
    clutch: 'Clutch', google: 'Google Business', capterra: 'Capterra',
    gartner: 'Gartner', greatnonprofits: 'GreatNonprofits',
  };
  return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

// ── Session Persistence ─────────────────────────────────────
function isGuestOperatorSession() {
  return handoffRole === 'guest';
}

function buildSessionSnapshot() {
  return {
    clientSlug: PARAMS.clientSlug,
    sessionId,
    machineId,
    currentState,
    chatHistory,
    agentMessageCount,
    reviewDraft,
    drafts,
    activeDraftPlatform,
    currentPlatformIndex,
    starRating,
    agentRating,
    platformsPosted,
    platformPostedAt,
    reviewFormOpened,
    platformFieldsCopied,
    negativeFlagData,
    lastAgentMessage,
    notificationsSent,
    hubspotCompleteSent,
    hubspotIncompleteSent,
    uploadedVideoMeta,
    draftLooksGood,
    chatChoiceMode,
    murkyMiddle,
    ratedDirectFive,
    directFiveImproveSkipped,
    interviewState,
    leadIdentity: {
      name: PARAMS.name,
      firstName: PARAMS.firstName,
      email: PARAMS.email,
      visitorCompany: PARAMS.visitorCompany,
    },
    leadFields,
    savedAt: new Date().toISOString(),
  };
}

function saveSession() {
  try {
    sessionStorage.setItem(getSessionStorageKey(), JSON.stringify(buildSessionSnapshot()));
  } catch (_) { /* quota exceeded — ignore */ }
  queueHandoffSync();
}

function applySavedSession(data) {
  try {
    if (!data || typeof data !== 'object') return false;
    if (data.clientSlug !== PARAMS.clientSlug) return false;

    const resumeState = data.currentState || 'welcome';
    if (resumeState !== 'welcome' && !data.sessionId) return false;

    sessionId = data.sessionId || '';
    machineId = data.machineId || '';
    chatHistory = data.chatHistory || [];
    agentMessageCount = data.agentMessageCount || 0;
    reviewDraft = data.reviewDraft || '';
    drafts = data.drafts || {};
    activeDraftPlatform = data.activeDraftPlatform || '';
    currentPlatformIndex = data.currentPlatformIndex || 0;
    starRating = data.starRating || 5;
    agentRating = typeof data.agentRating === 'number' ? data.agentRating : null;
    platformsPosted = data.platformsPosted || {};
    platformPostedAt =
      data.platformPostedAt && typeof data.platformPostedAt === 'object' ? data.platformPostedAt : {};
    reviewFormOpened = data.reviewFormOpened || {};
    platformFieldsCopied =
      data.platformFieldsCopied && typeof data.platformFieldsCopied === 'object' ? data.platformFieldsCopied : {};
    negativeFlagData = data.negativeFlagData || null;
    lastAgentMessage = data.lastAgentMessage || '';
    notificationsSent = data.notificationsSent || {};
    hubspotCompleteSent = Boolean(data.hubspotCompleteSent);
    hubspotIncompleteSent = Boolean(data.hubspotIncompleteSent);
    uploadedVideoMeta = data.uploadedVideoMeta && typeof data.uploadedVideoMeta === 'object'
      ? data.uploadedVideoMeta
      : null;
    draftLooksGood = data.draftLooksGood && typeof data.draftLooksGood === 'object'
      ? data.draftLooksGood
      : {};
    chatChoiceMode = ['stars', 'murky', 'murky-feedback'].includes(data.chatChoiceMode)
      ? data.chatChoiceMode
      : null;
    if (chatChoiceMode === 'stars' && !isRatingButtonsEnabled()) chatChoiceMode = null;
    if (
      (chatChoiceMode === 'murky' || chatChoiceMode === 'murky-feedback')
      && (!isRatingButtonsEnabled() || !isMurkyMiddleEnabled())
    ) {
      chatChoiceMode = null;
    }
    murkyMiddle = normalizeMurkyMiddle(data.murkyMiddle);
    ratedDirectFive = data.ratedDirectFive === true || firstCustomerAnswer() === '5 stars';
    directFiveImproveSkipped = data.directFiveImproveSkipped === true;
    interviewState = data.interviewState && typeof data.interviewState === 'object' && !Array.isArray(data.interviewState)
      ? data.interviewState
      : null;

    applyLeadIdentityFromStorage(data.leadIdentity);
    leadFields = Array.isArray(data.leadFields) ? data.leadFields : [];
    if (leadFields.length) applyHubSpotSubmissionToParams(leadFields);

    chatHistory.forEach(msg => addChatBubble(msg.role, msg.content));

    let nextState = resumeState;
    if (nextState === 'video' && !isVideoStepEnabled()) nextState = 'complete';
    transitionTo(nextState);
    return true;
  } catch (_) {
    return false;
  }
}

function restoreSession() {
  try {
    const saved = sessionStorage.getItem(getSessionStorageKey());
    if (!saved) return false;
    return applySavedSession(JSON.parse(saved));
  } catch (_) {
    return false;
  }
}

function guestTokenStorageKey() {
  const slug = String(PARAMS.clientSlug || 'default').trim() || 'default';
  return `rr_guest_token_${slug}`;
}

function createHandoffToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function readOrCreateGuestToken() {
  const key = guestTokenStorageKey();
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{22,128}$/.test(existing)) return existing;
  } catch (_) { /* ignore */ }
  const next = createHandoffToken();
  try { sessionStorage.setItem(key, next); } catch (_) { /* ignore */ }
  return next;
}

function canSyncHandoff() {
  if (!handoffToken || (handoffRole !== 'guest' && handoffRole !== 'client')) return false;
  if (handoffRole === 'guest' && handoffLocked) return false;
  return true;
}

function queueHandoffSync() {
  if (!canSyncHandoff()) return;
  if (handoffSaveTimer) clearTimeout(handoffSaveTimer);
  handoffSaveTimer = setTimeout(() => {
    handoffSaveTimer = null;
    handoffWriteChain = handoffWriteChain.then(() => pushHandoffSnapshot()).catch(() => {});
  }, 400);
}

async function flushHandoffSync() {
  if (handoffSaveTimer) {
    clearTimeout(handoffSaveTimer);
    handoffSaveTimer = null;
  }
  handoffWriteChain = handoffWriteChain.then(() => pushHandoffSnapshot()).catch(() => false);
  return handoffWriteChain;
}

async function pushHandoffSnapshot() {
  if (!canSyncHandoff()) return false;
  try {
    const res = await fetch('/api/handoff', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        token: handoffToken,
        clientSlug: PARAMS.clientSlug,
        role: handoffRole,
        snapshot: buildSessionSnapshot(),
      }),
    });
    if (res.status === 409 && handoffRole === 'guest') {
      lockGuestHandoff();
      return false;
    }
    return res.ok;
  } catch (_) {
    return false;
  }
}

function setGuestStatus(text) {
  const el = document.getElementById('guest-handoff-status');
  if (el) el.textContent = text;
}

function fillGuestBar() {
  if (handoffLocked) return;
  const who = [PARAMS.name, PARAMS.email].filter((part) => part && part !== 'there').join(' · ');
  if (who) setGuestStatus(`Details saved for ${who}.`);
}

function lockGuestHandoff() {
  if (handoffLocked) return;
  handoffLocked = true;
  if (handoffPollTimer) {
    clearInterval(handoffPollTimer);
    handoffPollTimer = null;
  }
  const bar = document.getElementById('guest-handoff-bar');
  if (bar) bar.classList.add('is-locked');
  setGuestStatus('Handed off. This browser will not overwrite the client.');
}

function mountGuestBar() {
  if (document.getElementById('guest-handoff-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'guest-handoff-bar';
  bar.className = 'guest-handoff-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Live session handoff');
  bar.innerHTML = `
    <div class="guest-handoff-bar__copy">
      <p class="guest-handoff-bar__title">Live session</p>
      <p id="guest-handoff-status" class="guest-handoff-bar__status" aria-live="polite">Begin the session and fill in the client's details.</p>
    </div>
    <div class="guest-handoff-bar__fields">
      <button type="button" id="guest-handoff-copy" class="btn btn-primary btn-sm">Copy client link</button>
    </div>
  `;
  // Above the step bar's home spot, even while the bar sits under the welcome CTA.
  const anchor = guestBarAnchor();
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
  else document.body.prepend(bar);

  document.getElementById('guest-handoff-copy')?.addEventListener('click', copyGuestHandoffLink);
  fillGuestBar();
}

async function copyGuestHandoffLink() {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('handoff', handoffToken);
  const copied = await copyToClipboard(url.toString());
  const saved = await flushHandoffSync();
  if (!copied) {
    setGuestStatus(saved
      ? 'Saved, but the link could not be copied.'
      : 'Could not copy the link.');
    return;
  }
  if (handoffLocked) {
    setGuestStatus('Handed off. Link copied.');
    return;
  }
  setGuestStatus(saved
    ? 'Link copied.'
    : 'Link copied, but the save did not go through. Copy again in a moment.');
}

async function pollHandoffClaim() {
  if (handoffRole !== 'guest' || handoffLocked || !handoffToken) return;
  try {
    const res = await fetch(
      `/api/handoff?token=${encodeURIComponent(handoffToken)}&clientSlug=${encodeURIComponent(PARAMS.clientSlug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.claimed) lockGuestHandoff();
  } catch (_) { /* keep polling */ }
}

function startHandoffPoll() {
  if (handoffPollTimer) clearInterval(handoffPollTimer);
  handoffPollTimer = setInterval(pollHandoffClaim, 8000);
}

function preferLocalHandoffSnapshot(serverSnapshot) {
  if (!serverSnapshot || typeof serverSnapshot !== 'object') return null;
  try {
    const localRaw = sessionStorage.getItem(getSessionStorageKey());
    if (!localRaw) return serverSnapshot;
    const local = JSON.parse(localRaw);
    if (!local || local.clientSlug !== PARAMS.clientSlug) return serverSnapshot;
    if ((local.sessionId || '') !== (serverSnapshot.sessionId || '')) return serverSnapshot;
    const localTime = Date.parse(local.savedAt || '') || 0;
    const serverTime = Date.parse(serverSnapshot.savedAt || '') || 0;
    if (localTime > serverTime) return local;
  } catch (_) { /* use the server copy */ }
  return serverSnapshot;
}

function showHandoffUnavailable() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('handoff')) {
    url.searchParams.delete('handoff');
    window.history.replaceState({}, '', url.toString());
  }
  const host = document.querySelector('#screen-welcome .screen-content');
  if (!host || document.getElementById('handoff-unavailable')) return;
  const note = document.createElement('p');
  note.id = 'handoff-unavailable';
  note.className = 'handoff-unavailable';
  note.setAttribute('role', 'alert');
  note.textContent = 'This resume link has expired or is no longer available. You can start from the beginning.';
  host.insertBefore(note, host.firstChild);
}

async function bootHandoff() {
  const params = new URLSearchParams(window.location.search);
  const token = (params.get('handoff') || '').trim();
  if (token) {
    try {
      const res = await fetch(
        `/api/handoff?token=${encodeURIComponent(token)}&clientSlug=${encodeURIComponent(PARAMS.clientSlug)}&claim=1`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        showHandoffUnavailable();
        return '';
      }
      const data = await res.json();
      handoffToken = token;
      handoffRole = 'client';
      const snapshot = preferLocalHandoffSnapshot(data.snapshot);
      if (!snapshot || !applySavedSession(snapshot)) {
        handoffToken = '';
        handoffRole = '';
        showHandoffUnavailable();
        return '';
      }
      return 'client';
    } catch (_) {
      showHandoffUnavailable();
      return '';
    }
  }

  if (params.get('guest') === 'true') {
    handoffRole = 'guest';
    handoffToken = readOrCreateGuestToken();
    mountGuestBar();
    startHandoffPoll();
    return 'guest';
  }

  return '';
}

window.addEventListener('pagehide', () => {
  if (!canSyncHandoff()) return;
  if (handoffSaveTimer) {
    clearTimeout(handoffSaveTimer);
    handoffSaveTimer = null;
  }
  try {
    fetch('/api/handoff', {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: handoffToken,
        clientSlug: PARAMS.clientSlug,
        role: handoffRole,
        snapshot: buildSessionSnapshot(),
      }),
    });
  } catch (_) { /* the next visit will retry */ }
});

window.rrReset = () => {
  allowPageUnload = true;
  hideReviewCompleteOverlay();
  try {
    sessionStorage.removeItem(getSessionStorageKey());
  } catch (_) {}
  if (handoffRole === 'guest') {
    try { sessionStorage.removeItem(guestTokenStorageKey()); } catch (_) {}
    window.location.reload();
    return;
  }
  if (new URLSearchParams(window.location.search).has('handoff')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('handoff');
    window.location.replace(url.toString());
    return;
  }
  window.location.reload();
};
