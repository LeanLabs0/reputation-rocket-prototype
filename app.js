const CLIENT_CONFIG = window.CLIENT_CONFIG || {};

function applyCurrentYearTokens() {
  const year = String(new Date().getFullYear());
  $$('[data-current-year]').forEach((el) => { el.textContent = year; });
}

const CONFIG = {
  API_URL: CLIENT_CONFIG.agentEndpoint || '/api/agent',
  NOTIFY_URL: CLIENT_CONFIG.notificationEndpoint || '/api/notify',
  VIDEO_UPLOAD_URL: CLIENT_CONFIG.videoUploadEndpoint || '/api/upload-video',
  AGENT: 'reputation-rocket',
  TIMEOUT_MS: 60000,
};

const REGENERATE_DRAFT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-regenerate-icon" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';

function setRegenerateButtonLabel(btn, label) {
  if (!btn) return;
  btn.innerHTML = `${REGENERATE_DRAFT_ICON_SVG}<span class="btn-regenerate-label">${label}</span>`;
}

// ── URL Params ──────────────────────────────────────────────
const PARAMS = (() => {
  const p = new URLSearchParams(window.location.search);
  const name = p.get('name') || '';

  const providerName = (
    (CLIENT_CONFIG.providerName || CLIENT_CONFIG.brandName || CLIENT_CONFIG.company || '').trim() ||
    'our team'
  );

  const customerCompanyFromUrl =
    (p.get('companyName') || p.get('company_name') || p.get('company') || '').trim();

  const customerCompany =
    customerCompanyFromUrl ||
    (CLIENT_CONFIG.defaultCustomerCompany || CLIENT_CONFIG.customerCompany || '').trim() ||
    providerName;

  const platformsFromUrl = (p.get('platforms') || '').split(',').map(s => s.trim()).filter(Boolean);
  const platforms = platformsFromUrl.length
    ? platformsFromUrl
    : Array.isArray(CLIENT_CONFIG.platforms) ? CLIENT_CONFIG.platforms : [];

  const reviewLinks = { ...(CLIENT_CONFIG.reviewLinks || {}) };
  platforms.forEach(plat => {
    const link = p.get(`review_${plat}`);
    if (link) reviewLinks[plat] = link;
  });

  // Interview questions shown on the video screen + record modal. Clients set a
  // plain array of strings in config.js; numbering/markup is added by the script.
  const defaultInterviewQuestions = [
    `Why did you choose ${providerName}?`,
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ];
  const interviewQuestions = (
    Array.isArray(CLIENT_CONFIG.interviewQuestions) && CLIENT_CONFIG.interviewQuestions.length
      ? CLIENT_CONFIG.interviewQuestions
      : defaultInterviewQuestions
  ).map((q) => String(q == null ? '' : q).trim()).filter(Boolean);

  return {
    clientSlug: CLIENT_CONFIG.clientSlug || window.location.pathname.split('/').filter(Boolean)[0] || 'default',
    name,
    firstName: name.split(' ')[0] || 'there',
    providerName,
    customerCompany,
    company: customerCompany,
    visitorCompany: '',
    email: p.get('email') || '',
    platforms,
    reviewLinks,
    videoUrl: p.get('video_url') || CLIENT_CONFIG.videoUrl || '',
    welcomeVideoUrl: p.has('no-video') ? '' : (p.get('welcome_video_url') || CLIENT_CONFIG.welcomeVideoUrl || ''),
    welcomeVideoPoster: p.get('welcome_video_poster') || CLIENT_CONFIG.welcomeVideoPoster || '',
    interviewQuestions,
    thankYouUrl: (p.get('thank_you_url') || CLIENT_CONFIG.thankYouUrl || '').trim(),
    thankYouRedirectDelayMs: (() => {
      const fromUrl = p.get('thank_you_redirect_delay_ms');
      if (fromUrl != null && fromUrl !== '') {
        const n = Number(fromUrl);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      const fromConfig = Number(CLIENT_CONFIG.thankYouRedirectDelayMs);
      return Number.isFinite(fromConfig) && fromConfig >= 0 ? fromConfig : 5000;
    })(),
    allowedRedirectHosts: CLIENT_CONFIG.allowedRedirectHosts || [],
    supportEmail: (CLIENT_CONFIG.supportEmail || '').trim(),
  };
})();

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
let negativeFlagData = null;
let isWaitingForAgent = false;
let lastAgentMessage = '';
let notificationsSent = {};
let uploadedVideoMeta = null;
/** Per-platform: user tapped "Looks good" for that draft (required before Approve all). */
let draftLooksGood = {};
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
document.addEventListener('DOMContentLoaded', () => {
  applyCurrentYearTokens();
  applyVideoStepVisibility();

  try {
    sessionStorage.removeItem('rr_session');
  } catch (_) { }

  // Populate dynamic text
  $$('.company-name').forEach(el => { el.textContent = PARAMS.customerCompany; });
  $$('.provider-name').forEach(el => { el.textContent = PARAMS.providerName; });
  $$('.first-name').forEach(el => { el.textContent = PARAMS.firstName; });
  renderVideoScreenQuestions();
  document.title = `Reputation Rocket — ${PARAMS.customerCompany}`;

  // Optional welcome video. The element is injected only when a client provides a URL
  const welcomeVideoHost = $('#welcome-video-host');
  if (PARAMS.welcomeVideoUrl && welcomeVideoHost) {
    const vid = document.createElement('video');
    vid.id = 'welcome-video';
    vid.className = 'welcome-video';
    vid.controls = true;
    vid.playsInline = true;
    if (PARAMS.welcomeVideoPoster) {
      vid.poster = PARAMS.welcomeVideoPoster;
      vid.preload = 'none';
    }

    const src = document.createElement('source');
    src.id = 'welcome-video-source';
    src.src = PARAMS.welcomeVideoUrl;
    src.type = 'video/mp4';

    vid.appendChild(src);
    welcomeVideoHost.appendChild(vid);
  }

  $('#btn-start').addEventListener('click', startExperience);

  const startOverBtn = $('#btn-start-over');
  if (startOverBtn) {
    startOverBtn.addEventListener('click', () => {
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
    syncChatComposerState();
  });
  $('#chat-send').addEventListener('click', handleChatSend);

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
  $('#btn-view-draft').addEventListener('click', () => transitionTo('draft'));

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

  $('#btn-skip-video').addEventListener('click', () => transitionTo('complete'));
  $('#btn-record-video').addEventListener('click', openVideoCaptureModal);
  $('.video-powered')?.replaceChildren(document.createTextNode('Uploaded to HubSpot'));

  if (restoreSession()) return;
});

// ── State Machine ───────────────────────────────────────────
function transitionTo(state) {
  hideReviewCompleteOverlay();

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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Header title: "Review complete" on the final thank-you screen, default otherwise. */
function updateNavTitle(state) {
  const el = document.querySelector('.nav-title');
  if (!el) return;
  if (el.dataset.defaultTitle == null) el.dataset.defaultTitle = el.textContent;
  el.textContent = state === 'complete' ? 'Review complete' : el.dataset.defaultTitle;
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
function hasLeadCaptureFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const name = (p.get('name') || '').trim();
  const email = (p.get('email') || '').trim();
  return !!(name && email);
}

function shouldShowHubSpotLeadForm() {
  const portal = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  const formId = String(CLIENT_CONFIG.hubspotFormId || '').trim();
  if (!portal || !formId) return false;
  return !hasLeadCaptureFromUrl();
}

function refreshDynamicLabels() {
  $$('.company-name').forEach((el) => { el.textContent = PARAMS.customerCompany; });
  $$('.provider-name').forEach((el) => { el.textContent = PARAMS.providerName; });
  $$('.first-name').forEach((el) => { el.textContent = PARAMS.firstName; });
  document.title = `Reputation Rocket — ${PARAMS.customerCompany}`;
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
      <div id="hubspot-lead-form-target" class="hubspot-lead-modal__form"></div>
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

async function openHubSpotLeadModalAndMountForm(onSuccess) {
  const targetSelector = '#hubspot-lead-form-target';
  const targetEl = () => document.querySelector(targetSelector);
  showHubSpotLeadModal();
  const target = targetEl();
  if (target) target.innerHTML = '<p class="hubspot-lead-modal__loading muted">Loading form…</p>';

  try {
    await loadHubSpotFormsV2();
  } catch (err) {
    console.warn(err);
    hubspotLeadFlowBusy = false;
    if (target) {
      target.innerHTML =
        '<p class="hubspot-lead-modal__error" role="alert">We couldn’t load the form. Please check your connection or use the personalized link from your email.</p>';
    }
    return;
  }

  if (target) target.innerHTML = '';

  const portalId = String(CLIENT_CONFIG.hubspotPortalId || '').trim();
  const formId = String(CLIENT_CONFIG.hubspotFormId || '').trim();
  const region = String(CLIENT_CONFIG.hubspotFormRegion || 'na1').trim() || 'na1';

  try {
    window.hbspt.forms.create({
      portalId,
      formId,
      region,
      target: targetSelector,
      onFormSubmitted: ($form, data) => {
        const fromCallback = parseSubmissionValuesFromHubSpotData(data);

        let el = $form && $form.length ? $form[0] : $form;
        if (el && typeof el.querySelector === 'function' && !el.querySelector('input[name]')) {
          const innerForm = el.querySelector('form.hs-form, form');
          if (innerForm) el = innerForm;
        }

        let fromDom = [];
        if (el && typeof el.querySelectorAll === 'function') {
          fromDom = scrapeLeadFieldsFromHubSpotDom(el);
        }
        if (!fromDom.length) {
          const host = document.getElementById('hubspot-lead-form-target');
          if (host) {
            const inner = host.querySelector('form.hs-form, form') || host;
            fromDom = scrapeLeadFieldsFromHubSpotDom(inner);
          }
        }

        let values = mergeHubSpotSubmissionRows(fromCallback, fromDom);
        if (!values.length) {
          values = extractSubmissionFromHubSpotCallback($form, data);
        }
        applyHubSpotSubmissionToParams(values);
        saveSession();
        hideHubSpotLeadModal();
        if (typeof onSuccess === 'function') onSuccess();
      },
    });
  } catch (err) {
    console.warn(err);
    hubspotLeadFlowBusy = false;
    if (target) {
      target.innerHTML =
        '<p class="hubspot-lead-modal__error" role="alert">We couldn’t open the form. Check portal ID and form ID in your client config.</p>';
    }
  }
}

function beginSessionAfterLeadCapture() {
  sessionId = crypto.randomUUID();
  transitionTo('chat');
}

function startExperience() {
  if (shouldShowHubSpotLeadForm()) {
    if (hubspotLeadFlowBusy) return;
    hubspotLeadFlowBusy = true;
    openHubSpotLeadModalAndMountForm(beginSessionAfterLeadCapture);
    return;
  }
  beginSessionAfterLeadCapture();
}

// ── Chat Logic ──────────────────────────────────────────────
function initChat() {
  const chatInput = $('#chat-input');
  if (chatInput) chatInput.focus();

  if (chatHistory.length === 0) {
    sendMessage('Please start the review process.', true);
  }
  syncChatDraftPromptVisibility();
}

function isChatDraftPromptVisible() {
  const el = $('#chat-draft-prompt');
  return !!(el && el.classList.contains('visible'));
}

function setChatDraftPromptVisible(visible) {
  const el = $('#chat-draft-prompt');
  if (!el) return;
  el.classList.toggle('visible', !!visible);
  syncChatComposerState();
}

function syncChatComposerState() {
  const inputBar = $('.chat-input-bar');
  const chatInput = $('#chat-input');
  const chatSend = $('#chat-send');
  if (!chatInput || !chatSend) return;

  const promptVisible = isChatDraftPromptVisible();
  if (inputBar) {
    inputBar.hidden = promptVisible;
    inputBar.setAttribute('aria-hidden', promptVisible ? 'true' : 'false');
  }

  if (promptVisible) {
    chatInput.disabled = true;
    chatSend.disabled = true;
    return;
  }

  chatInput.disabled = !!isWaitingForAgent;
  chatSend.disabled = !chatInput.value.trim() || !!isWaitingForAgent;
}

async function sendMessage(text, isHidden = false) {
  if (isWaitingForAgent) return;

  if (!isHidden) {
    addChatBubble('user', text);
    chatHistory.push({ role: 'user', content: text });
  }

  const chatInput = $('#chat-input');
  chatInput.value = '';
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

    showTypingIndicator(false);
    addChatBubble('agent', displayText);
    chatHistory.push({ role: 'agent', content: displayText });
    agentMessageCount++;

    // Handle transitions
    // Route negative when the agent flags it (covers the sentiment override:
    // high rating + negative text) OR when the decimal rating is below the 4.1
    // cutoff. The agent flag always wins; the cutoff is a decimal-aware safety net.
    const ratingBelowCutoff = agentRating != null && agentRating < RATING_POSITIVE_CUTOFF;
    if (negativeFlagData || ratingBelowCutoff) {
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
    if (!isChatDraftPromptVisible()) {
      chatInput.focus();
    }
    saveSession();
  }
}

function handleChatSend() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || isWaitingForAgent) return;
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
}

const PLATFORM_FAVICON_HOST = {
  hubspot: 'hubspot.com',
  g2: 'g2.com',
  google: 'google.com',
  trustpilot: 'trustpilot.com',
  clutch: 'clutch.co',
  capterra: 'capterra.com',
  gartner: 'gartner.com',
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

  const canonical = PLATFORM_FAVICON_HOST[key];
  const fromLink = platformFaviconHost(plat);

  const s2host = canonical || fromLink;
  if (s2host) add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s2host)}&sz=128`);

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
    const body = {
      prompt: `Please regenerate ONLY the ${platform} draft with a slightly different angle. Wrap the new draft in <drafts><draft platform="${platform}">...</draft></drafts>. Do not include any other platforms.`,
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

    const res = await fetchWithStickyRetry(body, undefined);
    if (!res.ok) throw new Error('API error');

    const data = await res.json();
    if (data.machine_id) {
      machineId = data.machine_id;
    }
    const resultText = data.result || '';

    const draftsMatch = resultText.match(/<drafts>([\s\S]*?)<\/drafts>/);
    if (draftsMatch) {
      const parsed = parseDraftsBlock(draftsMatch[1]);
      if (parsed[platform]) {
        drafts[platform] = parsed[platform];
        delete draftLooksGood[platform];
        if (platform === activeDraftPlatform) {
          $('#draft-textarea').value = parsed[platform];
        }
        renderDraftTabs();
        updateDraftScreenChrome();
        saveSession();
        return;
      }
    }
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
  }
}

// ── Screen 4: Post ──────────────────────────────────────────
const PLATFORM_META = {
  hubspot:    { name: 'HubSpot',         desc: 'B2B marketplace reviews',        icon: 'globe',  flow: 'paste'  },
  g2:         { name: 'G2',              desc: 'Where buyers compare software',  icon: 'star',   flow: 'fields' },
  trustpilot: { name: 'Trustpilot',      desc: 'Trusted by millions of consumers', icon: 'shield', flow: 'paste' },
  google:     { name: 'Google Business', desc: 'Your most visible review',       icon: 'globe',  flow: 'paste'  },
  capterra:   { name: 'Capterra',        desc: 'Software reviews for businesses', icon: 'star',  flow: 'paste'  },
  gartner:    { name: 'Gartner',         desc: 'Enterprise buyer reviews',       icon: 'star',   flow: 'fields' },
};

function isRichPostLayout() {
  const el = $('#screen-post');
  return String((el && el.dataset.postLayout) || CLIENT_CONFIG.postScreenLayout || '') === 'rich';
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
    <p class="platform-card-snippet">${escapeHtml(truncatePostSnippet(drafts[plat] || reviewDraft || ''))}</p>
    <p class="platform-card-confirmed-meta">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
      Confirmed on ${escapeHtml(whenLabel)}
    </p>
    <div class="platform-card-actions platform-card-actions--split">
      <button type="button" class="btn btn-secondary btn-sm" data-action="view-review-link" data-platform="${escapeHtml(plat)}">
        View my review ${iconExternalLink()}
      </button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="post-another" data-platform="${escapeHtml(plat)}">
        Post another review
      </button>
    </div>`;
  const wrap = card.querySelector('.platform-card-logo-wrap');
  if (wrap) wrap.appendChild(createPlatformCardLogo(plat));
}

function mountRichPasteUnpostedCard(card, plat, index1, meta) {
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
    <p class="platform-card-snippet">${escapeHtml(truncatePostSnippet(drafts[plat] || reviewDraft || ''))}</p>
    <div class="platform-card-actions platform-card-actions--stack">
      <button type="button" class="btn btn-primary btn-md" data-action="post-paste" data-platform="${escapeHtml(plat)}">
        Open ${escapeHtml(meta.name)} review form ${iconExternalLink()}
      </button>
    </div>
    <p class="platform-card-foot-hint">${iconLockSmall()}<span>We'll ask you to confirm once the review site opens</span></p>`;
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

function mountRichG2UnpostedCard(card, plat, index1, meta) {
  const draft = drafts[plat] || reviewDraft || '';
  const fields = parseG2Fields(draft);

  if (fields.length === 0) {
    mountRichPasteUnpostedCard(card, plat, index1, meta);
    return;
  }

  const fieldRows = fields
    .map(
      (f) => `
    <div class="field-row">
      <div class="field-row-head">
        <span class="field-label">${escapeHtml(f.label)}</span>
        <button type="button" class="btn-copy" data-action="copy-section" data-text="${escapeAttr(f.body)}">Copy</button>
      </div>
      <p class="field-body">${escapeHtml(f.body)}</p>
    </div>`,
    )
    .join('');

  const g2Hint = `Open the ${meta.name} form with the button below, then copy each answer.`;

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
      <button type="button" class="btn btn-primary btn-md" data-action="open-form" data-platform="${escapeHtml(plat)}">
        Open ${escapeHtml(meta.name)} review form ${iconExternalLink()}
      </button>
    </div>
    <p class="platform-card-foot-hint">${iconLockSmall()}<span>${escapeHtml(g2Hint)}</span></p>
    <details class="card-details card-details--rich" open>
      <summary>Your answers for ${escapeHtml(meta.name)} (${fields.length})</summary>
      <div class="card-details-body">${fieldRows}</div>
    </details>`;

  const wrap = card.querySelector('.platform-card-logo-wrap');
  if (wrap) wrap.appendChild(createPlatformCardLogo(plat));
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

function showReviewCompleteOverlay(platform) {
  const overlay = $('#review-complete-overlay');
  if (!overlay || platform == null || platformsPosted[platform]) return;
  if (currentState !== 'post') return;
  const meta = PLATFORM_META[platform] || { name: platform };
  const titleEl = $('#review-complete-title');
  const draftWrap = $('#review-complete-draft-wrap');
  const draftEl = $('#review-complete-draft');
  const rawDraftText = String((drafts[platform] || reviewDraft || '')).trim();
  const draftText = formatDraftForOverlay(platform, rawDraftText);
  if (titleEl) titleEl.textContent = `Finished on ${meta.name}?`;
  if (draftWrap && draftEl) {
    draftWrap.hidden = !draftText;
    draftEl.textContent = draftText;
  }
  overlay.dataset.platform = platform;
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  $('#btn-review-complete-confirm')?.focus();
}

/**
 * Opens a review-site URL in a new browser tab. Must be called from a user
 * gesture (click). Uses a temporary anchor with target="_blank" for reliable,
 * popup-blocker-friendly behavior (no popup window sizing/quirks).
 */
function openReviewPlatform(url) {
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
        card.innerHTML = header + '<span class="platform-status done">Posted!</span>';
      } else if (flow === 'fields') {
        card.innerHTML = header + renderG2CardBody(plat);
      } else {
        card.innerHTML = header + `
        <span class="platform-status ready" data-action="post-paste" data-platform="${plat}">Copy &amp; open ${meta.name} →</span>
        <p class="platform-hint">We'll ask you to confirm once the review site opens</p>
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
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    });
  });
  grid.querySelectorAll('[data-action="post-another"]').forEach(btn => {
    btn.addEventListener('click', () => resetPlatformPostProgress(btn.dataset.platform));
  });
  // open-form: multi-field flows (G2) — open URL; rich layout also prompts confirm overlay.
  grid.querySelectorAll('[data-action="open-form"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      // Only open the tab when a link is configured, but ALWAYS surface the
      // confirm overlay (matching the post-paste flow) so an empty/missing
      // reviewLink can never silently swallow the click.
      if (link) {
        openReviewPlatform(link);
      }
      reviewFormOpened[plat] = true;
      saveSession();
      initPostScreen();
      showReviewCompleteOverlay(plat);
    });
  });
  grid.querySelectorAll('[data-action="open-only"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) {
        openReviewPlatform(link);
        showReviewCompleteOverlay(plat);
      }
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
      <p class="platform-hint">We'll ask you to confirm once the review site opens</p>
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

  if (link) {
    openReviewPlatform(link);
  }

  if (!skipOverlay) {
    showReviewCompleteOverlay(platform);
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
    sub.hidden = false;
    sub.textContent = "You're all set — we'll wrap up on the next screen.";
  }
}

function updatePostProgress() {
  const total = PARAMS.platforms.length;
  const posted = Object.values(platformsPosted).filter(Boolean).length;
  const pct = total ? Math.round((posted / total) * 100) : 0;
  const fill = $('#post-progress-fill');
  const text = $('#post-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${posted} of ${total} posted`;
  const headline = $('#post-progress-headline');
  if (headline) headline.textContent = `${posted} of ${total} reviews confirmed`;
}

function handleContinueAfterPost() {
  if (isVideoStepEnabled()) {
    transitionTo('video');
  } else {
    transitionTo('complete');
  }
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
  $('#stat-reviews').textContent = posted;
  const videoStat = document.getElementById('stat-video-container');
  if (videoStat) {
    videoStat.style.display = uploadedVideoMeta ? '' : 'none';
  }
  triggerConfetti();
  sendLifecycleNotification('completed');
  maybeRedirectToThankYou();
}

function maybeRedirectToThankYou() {
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
}

async function sendLifecycleNotification(event) {
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
  };
  if (PARAMS.supportEmail) {
    payload.support_email = PARAMS.supportEmail;
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
    gartner: 'Gartner',
  };
  return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

// ── Session Persistence ─────────────────────────────────────
function saveSession() {
  try {
    sessionStorage.setItem(
      getSessionStorageKey(),
      JSON.stringify({
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
        negativeFlagData,
        lastAgentMessage,
        notificationsSent,
        uploadedVideoMeta,
        draftLooksGood,
        leadIdentity: {
          name: PARAMS.name,
          firstName: PARAMS.firstName,
          email: PARAMS.email,
          visitorCompany: PARAMS.visitorCompany,
        },
      }),
    );
  } catch (_) { /* quota exceeded — ignore */ }
}

function restoreSession() {
  try {
    const saved = sessionStorage.getItem(getSessionStorageKey());
    if (!saved) return false;

    const data = JSON.parse(saved);
    if (data.clientSlug !== PARAMS.clientSlug) return false;

    // Only restore if same session (user didn't get a new link)
    if (!data.sessionId) return false;

    sessionId = data.sessionId;
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
    negativeFlagData = data.negativeFlagData || null;
    lastAgentMessage = data.lastAgentMessage || '';
    notificationsSent = data.notificationsSent || {};
    uploadedVideoMeta = data.uploadedVideoMeta && typeof data.uploadedVideoMeta === 'object'
      ? data.uploadedVideoMeta
      : null;
    draftLooksGood = data.draftLooksGood && typeof data.draftLooksGood === 'object'
      ? data.draftLooksGood
      : {};

    applyLeadIdentityFromStorage(data.leadIdentity);

    chatHistory.forEach(msg => addChatBubble(msg.role, msg.content));

    let resumeState = data.currentState || 'welcome';
    if (resumeState === 'video' && !isVideoStepEnabled()) resumeState = 'complete';
    transitionTo(resumeState);
    return true;
  } catch (_) {
    return false;
  }
}

window.rrReset = () => {
  hideReviewCompleteOverlay();
  try {
    sessionStorage.removeItem(getSessionStorageKey());
  } catch (_) {}
  window.location.reload();
};
