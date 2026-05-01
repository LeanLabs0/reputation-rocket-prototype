/* ============================================================
   Reputation Rocket — app.js
   State machine + API integration + chat logic
   ============================================================ */

const CLIENT_CONFIG = window.CLIENT_CONFIG || {};

/** Default visual tokens align with Lean Labs Figma style guide; override per client via `CLIENT_CONFIG.theme`. */
const DEFAULT_CLIENT_THEME = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  googleFontQuery: 'Plus+Jakarta+Sans:wght@400;500;600;700',
  headingColor: '#0d0d0d',
  bodyColor: 'rgba(43, 43, 43, 0.5)',
  mutedColor: '#93949f',
  primary: '#5b2ee6',
  primaryDark: '#4f25d1',
  accent: '#25c196',
  pageBackground:
    'radial-gradient(ellipse 85% 72% at 50% 30%, rgb(233, 239, 255) 0%, rgb(255, 255, 255) 48%, rgb(243, 237, 255) 100%)',
  navBackground: 'transparent',
  stepperGradient: 'linear-gradient(270deg, #E9EFFF -105%, #FFF 25.81%)',
  stepperShadow: '6px 8px 28px rgba(29, 0, 68, 0.08)',
  stepperRadius: '16px',
  brandGradient:
    'radial-gradient(120% 120% at 80% 20%, rgba(117, 47, 239, 1) 0%, rgb(13, 13, 13) 55%, rgb(42, 42, 42) 100%)',
  brandBorder: '#2b2b2b',
  gradient: 'linear-gradient(135deg, #752fef 0%, #9333ea 52%, #c026d3 100%)',
  primaryButtonStyle: 'solid',
  buttonRadius: '10px',
  cardRadiusChat: '20px',
  purpleTint: 'rgba(117, 47, 239, 0.09)',
  purpleBorder: 'rgba(117, 47, 239, 0.22)',
  chatMessageArea: '#f7f8fc',
  chatMessageAvatarBg: 'rgba(117, 47, 239, 0.08)',
  pendingBadgeBg: '#f0f0f2',
  pendingBadgeText: '#93949f',
  activeBadgeBg: 'rgba(117, 47, 239, 0.12)',
  activeBadgeText: '#5b2ee6',
  doneBadgeBg: 'rgba(37, 193, 150, 0.12)',
  doneBadgeText: '#25c196',
  starGradientStops: ['#752fef', '#a855f7', '#ec4899'],
};

function applyClientTheme() {
  const t = { ...DEFAULT_CLIENT_THEME, ...(CLIENT_CONFIG.theme || {}) };
  const root = document.documentElement;

  if (t.googleFontQuery && !document.getElementById('rr-theme-font')) {
    const link = document.createElement('link');
    link.id = 'rr-theme-font';
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${t.googleFontQuery}&display=swap`;
    document.head.appendChild(link);
  }

  const btnPrimaryBg = t.primaryButtonStyle === 'gradient' ? t.gradient : t.primary;

  root.style.setProperty('--font-family', t.fontFamily);
  root.style.setProperty('--ll-heading', t.headingColor);
  root.style.setProperty('--ll-body', t.bodyColor);
  root.style.setProperty('--ll-muted', t.mutedColor);
  root.style.setProperty('--ll-purple', t.primary);
  root.style.setProperty('--ll-purple-dark', t.primaryDark);
  root.style.setProperty('--ll-accent', t.accent);
  root.style.setProperty('--ll-success', t.accent);
  root.style.setProperty('--ll-page-bg', t.pageBackground);
  root.style.setProperty('--ll-nav-bg', t.navBackground);
  root.style.setProperty('--ll-stepper-bg', t.stepperGradient);
  root.style.setProperty('--ll-stepper-shadow', t.stepperShadow);
  root.style.setProperty('--ll-stepper-radius', t.stepperRadius);
  root.style.setProperty('--ll-brand-gradient', t.brandGradient);
  root.style.setProperty('--ll-brand-border', t.brandBorder);
  root.style.setProperty('--ll-gradient', t.gradient);
  root.style.setProperty('--ll-btn-primary-bg', btnPrimaryBg);
  root.style.setProperty('--radius-md', t.buttonRadius);
  root.style.setProperty('--radius-chat-card', t.cardRadiusChat);
  root.style.setProperty('--ll-purple-tint', t.purpleTint);
  root.style.setProperty('--ll-purple-border', t.purpleBorder);
  root.style.setProperty('--ll-chat-messages-bg', t.chatMessageArea);
  root.style.setProperty('--ll-chat-message-avatar-bg', t.chatMessageAvatarBg);
  root.style.setProperty('--ll-pending-badge-bg', t.pendingBadgeBg);
  root.style.setProperty('--ll-pending-badge-text', t.pendingBadgeText);
  root.style.setProperty('--ll-active-badge-bg', t.activeBadgeBg);
  root.style.setProperty('--ll-active-badge-text', t.activeBadgeText);
  root.style.setProperty('--ll-done-badge-bg', t.doneBadgeBg);
  root.style.setProperty('--ll-done-badge-text', t.doneBadgeText);

  const stops = Array.isArray(t.starGradientStops) ? t.starGradientStops : DEFAULT_CLIENT_THEME.starGradientStops;
  ['a', 'b', 'c'].forEach((id, i) => {
    const el = document.getElementById(`star-stop-${id}`);
    if (el) el.setAttribute('stop-color', stops[i] || stops[stops.length - 1]);
  });
}

const CONFIG = {
  // V1 production calls should go through a Vercel serverless proxy so the
  // Factor8 API key is never shipped to the browser.
  API_URL: CLIENT_CONFIG.agentEndpoint || '/api/agent',
  NOTIFY_URL: CLIENT_CONFIG.notificationEndpoint || '/api/notify',
  AGENT: 'reputation-rocket',
  TIMEOUT_MS: 60000,
};

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

  // Build review_links from review_{platform} params
  const reviewLinks = { ...(CLIENT_CONFIG.reviewLinks || {}) };
  platforms.forEach(plat => {
    const link = p.get(`review_${plat}`);
    if (link) reviewLinks[plat] = link;
  });

  return {
    clientSlug: CLIENT_CONFIG.clientSlug || window.location.pathname.split('/').filter(Boolean)[0] || 'default',
    name,
    firstName: name.split(' ')[0] || 'there',
    providerName,
    customerCompany,
    company: customerCompany,
    email: p.get('email') || '',
    platforms,
    reviewLinks,
    videoUrl: p.get('video_url') || CLIENT_CONFIG.videoUrl || '',
    welcomeVideoUrl: p.get('welcome_video_url') || CLIENT_CONFIG.welcomeVideoUrl || '',
    thankYouUrl: p.get('thank_you_url') || CLIENT_CONFIG.thankYouUrl || '',
    allowedRedirectHosts: CLIENT_CONFIG.allowedRedirectHosts || [],
    supportEmail: (CLIENT_CONFIG.supportEmail || '').trim(),
  };
})();

// ── State ───────────────────────────────────────────────────
let currentState = 'welcome';
let sessionId = '';
let machineId = '';
let chatHistory = [];       // {role: 'agent'|'user', content: string}
let agentMessageCount = 0;
let reviewDraft = '';
let drafts = {};            // {platformSlug: draftText}
let activeDraftPlatform = '';
let currentPlatformIndex = 0;
let starRating = 5;
let platformsPosted = {};
/** Platforms where user has clicked "Open … review form" (fields flow / G2); unlocks inline confirm. */
let reviewFormOpened = {};
let negativeFlagData = null;
let isWaitingForAgent = false;
let lastAgentMessage = '';
let notificationsSent = {};

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
    // Home machine is gone (rotated, stopped, or replaced). Drop the sticky
    // header and retry once on whatever machine Fly routes us to. The
    // fallback machine will read the session from Supabase and become the
    // new home on first save.
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
  applyClientTheme();

  try {
    sessionStorage.removeItem('rr_session');
  } catch (_) { /* legacy global key — prevented cross-client state bleed */ }

  // Populate dynamic text
  $$('.company-name').forEach(el => { el.textContent = PARAMS.customerCompany; });
  $$('.provider-name').forEach(el => { el.textContent = PARAMS.providerName; });
  $$('.first-name').forEach(el => { el.textContent = PARAMS.firstName; });
  document.title = `Reputation Rocket — ${PARAMS.customerCompany}`;

  // Optional welcome video. The element is injected only when a client provides
  // a URL so the welcome screen matches the Figma one-column layout by default.
  const welcomeVideoHost = $('#welcome-video-host');
  if (PARAMS.welcomeVideoUrl && welcomeVideoHost) {
    const vid = document.createElement('video');
    vid.id = 'welcome-video';
    vid.className = 'welcome-video';
    vid.controls = true;
    vid.playsInline = true;

    const src = document.createElement('source');
    src.id = 'welcome-video-source';
    src.src = PARAMS.welcomeVideoUrl;
    src.type = 'video/mp4';

    vid.appendChild(src);
    welcomeVideoHost.appendChild(vid);
  }

  // Wire up welcome
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

  // Wire up chat input
  $('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });
  $('#chat-input').addEventListener('input', () => {
    $('#chat-send').disabled = !$('#chat-input').value.trim() || isWaitingForAgent;
  });
  $('#chat-send').addEventListener('click', handleChatSend);

  // Wire up draft screen
  $('#btn-regenerate').addEventListener('click', handleRegenerate);
  $('#btn-approve').addEventListener('click', handleApproveDraft);
  $('#btn-view-draft').addEventListener('click', () => transitionTo('draft'));

  // Star rating clicks
  $$('#draft-stars .star').forEach(star => {
    star.addEventListener('click', () => {
      starRating = parseInt(star.dataset.value);
      updateStarDisplay();
    });
  });

  // Edit hint focuses the textarea
  const editHint = $('#btn-edit-hint');
  if (editHint) {
    editHint.addEventListener('click', () => $('#draft-textarea').focus());
  }

  // Post screen
  $('#btn-continue-post').addEventListener('click', handleContinueAfterPost);
  $('#skip-remaining').addEventListener('click', handleContinueAfterPost);

  const reviewOverlay = $('#review-complete-overlay');
  const confirmReviewBtn = $('#btn-review-complete-confirm');
  const laterReviewBtn = $('#btn-review-complete-later');
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

  // Video screen
  $('#btn-skip-video').addEventListener('click', () => transitionTo('complete'));
  $('#btn-record-video').addEventListener('click', () => {
    if (PARAMS.videoUrl) window.open(PARAMS.videoUrl, '_blank');
  });

  // Try to restore after handlers are wired so resumed sessions remain usable.
  if (restoreSession()) return;
});

// ── State Machine ───────────────────────────────────────────
function transitionTo(state) {
  hideReviewCompleteOverlay();

  // Hide all screens
  $$('.screen').forEach(s => s.classList.remove('active'));

  currentState = state;

  // Show target screen
  const screenEl = $(`#screen-${state}`);
  if (screenEl) screenEl.classList.add('active');

  // Update progress bar
  updateProgressBar(state);

  // State-specific entry actions
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
      // Skip video if no URL configured
      if (!PARAMS.videoUrl) {
        transitionTo('complete');
        return;
      }
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

function updateProgressBar(state) {
  const stateToStep = {
    welcome: 1, chat: 2, draft: 3, post: 4, video: 5, complete: 6, negative: -1
  };
  const activeStep = stateToStep[state] || 1;

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
function startExperience() {
  sessionId = crypto.randomUUID();
  transitionTo('chat');
}

// ── Chat Logic ──────────────────────────────────────────────
function initChat() {
  const chatInput = $('#chat-input');
  chatInput.focus();

  // Only auto-send first message if chat is empty (hidden — user shouldn't see it).
  // Server prepends config from request.config; do NOT also embed it in the prompt.
  if (chatHistory.length === 0) {
    sendMessage('Please start the review process.', true);
  }
}

async function sendMessage(text, isHidden = false) {
  if (isWaitingForAgent) return;

  // Add user message to UI (unless hidden like the initial config message)
  if (!isHidden) {
    addChatBubble('user', text);
    chatHistory.push({ role: 'user', content: text });
  }

  // Clear input
  const chatInput = $('#chat-input');
  chatInput.value = '';
  chatInput.disabled = true;
  $('#chat-send').disabled = true;
  isWaitingForAgent = true;

  // Show typing indicator
  showTypingIndicator(true);

  try {
    const body = {
      prompt: text,
      agent: CONFIG.AGENT,
      session_id: sessionId,
      config: {
        client_name: PARAMS.customerCompany,
        customer_name: PARAMS.name,
        customer_email: PARAMS.email,
        platforms: PARAMS.platforms,
        review_links: PARAMS.reviewLinks,
        // video_testimonial_url intentionally omitted — frontend handles Screen 5
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

    // Check for negative flag (server-side extraction)
    if (data.data && data.data.negative_flag) {
      negativeFlagData = data.data.negative_flag;
    }

    // Fallback: check for NEGATIVE_FLAG HTML comment
    if (!negativeFlagData) {
      const flagMatch = resultText.match(/<!--NEGATIVE_FLAG:([\s\S]*?)-->/);
      if (flagMatch) {
        try {
          negativeFlagData = JSON.parse(flagMatch[1]);
        } catch (_) { /* ignore parse error */ }
      }
    }

    // Also check structured_output fallback
    if (!negativeFlagData) {
      const soMatch = resultText.match(/<structured_output>([\s\S]*?)<\/structured_output>/);
      if (soMatch) {
        try {
          const parsed = JSON.parse(soMatch[1]);
          if (parsed.negative_flag) negativeFlagData = parsed.negative_flag;
        } catch (_) { /* ignore */ }
      }
    }

    // Parse multi-platform <drafts> block (new flow)
    const draftsMatch = resultText.match(/<drafts>([\s\S]*?)<\/drafts>/);
    let draftsParsed = false;
    if (draftsMatch) {
      const parsed = parseDraftsBlock(draftsMatch[1]);
      if (Object.keys(parsed).length > 0) {
        drafts = parsed;
        activeDraftPlatform = Object.keys(drafts)[0];
        reviewDraft = drafts[activeDraftPlatform];
        draftsParsed = true;
      }
    }

    // Clean the display text
    let displayText = resultText
      .replace(/<!--NEGATIVE_FLAG:[\s\S]*?-->/g, '')
      .replace(/<structured_output>[\s\S]*?<\/structured_output>/g, '')
      .replace(/<drafts>[\s\S]*?<\/drafts>/g, '')
      .trim();

    // Add agent message to chat
    showTypingIndicator(false);
    addChatBubble('agent', displayText);
    chatHistory.push({ role: 'agent', content: displayText });
    agentMessageCount++;

    // Handle transitions
    if (negativeFlagData) {
      // Negative path: show empathy message, then transition after delay
      setTimeout(() => transitionTo('negative'), 2500);
    } else if (draftsParsed) {
      // Multi-platform drafts ready: show "View Your Draft" button
      $('#chat-draft-prompt').classList.add('visible');
    } else if (detectDraft(displayText)) {
      // Backwards-compat fallback: legacy single-draft text
      reviewDraft = extractDraft(displayText);
      $('#chat-draft-prompt').classList.add('visible');
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
    chatInput.disabled = false;
    chatInput.focus();
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
  // Must have at least 4 agent messages (survey is done)
  if (agentMessageCount < 4) return false;

  // Check for draft signal phrases
  return DRAFT_SIGNALS.some(re => re.test(text));
}

function extractDraft(text) {
  // Try to extract text between quotes
  const quoteMatch = text.match(/"([^"]{40,})"/);
  if (quoteMatch) return quoteMatch[1].trim();

  // Try blockquote extraction
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
  // Backwards-compat: if no structured drafts captured, treat the legacy single
  // draft as the first platform's draft so the UI still has something to show.
  if (Object.keys(drafts).length === 0 && reviewDraft) {
    const fallbackPlat = PARAMS.platforms[0] || 'review';
    drafts = { [fallbackPlat]: reviewDraft };
    activeDraftPlatform = fallbackPlat;
  }
  if (!activeDraftPlatform) {
    activeDraftPlatform = Object.keys(drafts)[0] || PARAMS.platforms[0] || 'review';
  }
  renderDraftTabs();
  setActiveDraft(activeDraftPlatform);
  updateStarDisplay();
}

function renderDraftTabs() {
  const tabsEl = $('#draft-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  const platformList = Object.keys(drafts);
  platformList.forEach(plat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'draft-tab' + (plat === activeDraftPlatform ? ' active' : '');
    btn.textContent = platformDisplayName(plat);
    btn.dataset.platform = plat;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      // persist current edits before switching
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
  saveSession();
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
  btn.textContent = 'Regenerating...';

  // persist current edits first
  drafts[activeDraftPlatform] = $('#draft-textarea').value;

  sendRegenerateRequest(activeDraftPlatform).finally(() => {
    btn.disabled = false;
    btn.textContent = 'Regenerate this draft';
  });
}

async function sendRegenerateRequest(platform) {
  try {
    const body = {
      prompt: `Please regenerate ONLY the ${platform} draft with a slightly different angle. Wrap the new draft in <drafts><draft platform="${platform}">...</draft></drafts>. Do not include any other platforms.`,
      agent: CONFIG.AGENT,
      session_id: sessionId,
      config: {
        client_name: PARAMS.customerCompany,
        customer_name: PARAMS.name,
        customer_email: PARAMS.email,
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
        if (platform === activeDraftPlatform) {
          $('#draft-textarea').value = parsed[platform];
        }
        saveSession();
        return;
      }
    }
    // Fallback: legacy single-draft extraction
    const newDraft = extractDraft(resultText);
    if (newDraft && newDraft.length > 30) {
      drafts[platform] = newDraft;
      if (platform === activeDraftPlatform) {
        $('#draft-textarea').value = newDraft;
      }
      saveSession();
    }
  } catch (err) {
    console.error('Regenerate failed:', err);
  }
}

function handleApproveDraft() {
  // Save current tab edits before transitioning
  drafts[activeDraftPlatform] = $('#draft-textarea').value.trim();
  reviewDraft = drafts[activeDraftPlatform];
  transitionTo('post');
}

// ── Screen 4: Post ──────────────────────────────────────────
// flow: how users actually submit on each platform
//   'paste'  — simple single-field paste (HubSpot, Google, Trustpilot)
//   'fields' — question-by-question form, needs per-field copy (G2)
// Platforms that require a 3rd-party interview (e.g. Clutch, PeerSpot) are
// intentionally excluded — they don't fit a draft-and-deliver model.
const PLATFORM_META = {
  hubspot:    { name: 'HubSpot',         desc: 'B2B marketplace reviews',        icon: 'globe',  flow: 'paste'  },
  g2:         { name: 'G2',              desc: 'Where buyers compare software',  icon: 'star',   flow: 'fields' },
  trustpilot: { name: 'Trustpilot',      desc: 'Trusted by millions of consumers', icon: 'shield', flow: 'paste' },
  google:     { name: 'Google Business', desc: 'Your most visible review',       icon: 'globe',  flow: 'paste'  },
};

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

function hideReviewCompleteOverlay() {
  const overlay = $('#review-complete-overlay');
  if (!overlay) return;
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
  if (titleEl) titleEl.textContent = `Finished on ${meta.name}?`;
  overlay.dataset.platform = platform;
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  $('#btn-review-complete-confirm')?.focus();
}

/**
 * Opens a review-site URL in a smaller popup window. Must be called from a user
 * gesture (click); falls back to a new tab if popups are blocked.
 */
function openReviewPlatform(url, windowName = 'reputationRocketReview') {
  if (!url) return null;

  const width = Math.min(960, window.screen.availWidth - 80);
  const height = Math.min(820, window.screen.availHeight - 80);
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'scrollbars=yes',
    'resizable=yes',
    'noopener=yes',
    'noreferrer=yes',
  ].join(',');

  const w = window.open(url, windowName, features);
  if (w) {
    try { w.opener = null; } catch (_) { /* ignore */ }
    try { w.focus(); } catch (_) { /* ignore */ }
    return w;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
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

function initPostScreen() {
  const grid = $('#platform-grid');
  grid.innerHTML = '';

  PARAMS.platforms.forEach(plat => {
    const meta = PLATFORM_META[plat] || { name: plat, desc: 'Post your review', icon: 'globe', flow: 'paste' };
    const isPosted = platformsPosted[plat] || false;
    const flow = meta.flow || 'paste';

    const card = document.createElement('div');
    card.className = `platform-card flow-${flow}${isPosted ? ' posted' : ''}`;
    card.dataset.platform = plat;

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
      // paste flow — unchanged behavior
      card.innerHTML = header + `
        <span class="platform-status ready" data-action="post-paste" data-platform="${plat}">Copy &amp; open ${meta.name} →</span>
        <p class="platform-hint">We'll ask you to confirm once the review site opens</p>
      `;
    }
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-action="post-paste"]').forEach(btn => {
    btn.addEventListener('click', () => handlePastePost(btn.dataset.platform));
  });
  // open-form: multi-field flows (G2) — open URL only, no modal (user keeps page for copy/paste).
  grid.querySelectorAll('[data-action="open-form"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) {
        openReviewPlatform(link, `rr-review-${plat}`);
        reviewFormOpened[plat] = true;
        saveSession();
        initPostScreen();
      }
    });
  });
  grid.querySelectorAll('[data-action="open-only"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) {
        openReviewPlatform(link, `rr-review-${plat}`);
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

  if (fields.length === 0) {
    // backwards-compat fallback: no markers found, treat as paste flow
    return `
      <span class="platform-status ready" data-action="post-paste" data-platform="${plat}">Copy &amp; open G2 →</span>
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

  const showG2Confirm = !!reviewFormOpened[plat];
  const g2Hint = showG2Confirm
    ? 'Copy each answer below into the matching G2 question. When you have submitted the form on G2, confirm below.'
    : 'Open the G2 form first (button above). Then copy each answer below into G2. A confirmation button will appear after you open the form.';

  return `
    <span class="platform-status ready" data-action="open-form" data-platform="${plat}">Open G2 review form →</span>
    <p class="platform-hint">${g2Hint}</p>
    <details class="card-details" open>
      <summary>Your answers for G2 (${fields.length})</summary>
      <div class="card-details-body">
        ${fieldRows}
      </div>
    </details>
    ${showG2Confirm ? `<button type="button" class="btn-confirm" data-action="confirm-posted" data-platform="${plat}">I have completed my G2 review</button>` : ''}
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

async function handlePastePost(platform) {
  const link = PARAMS.reviewLinks[platform];
  const draftText = drafts[platform] || reviewDraft || '';

  // Copy review to clipboard
  try {
    await navigator.clipboard.writeText(draftText);
    showToast();
  } catch (_) {
    // Fallback: select text in a temp textarea
    const tmp = document.createElement('textarea');
    tmp.value = draftText;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showToast();
  }

  // Open platform in a smaller window (popup); fallback to new tab if blocked
  if (link) {
    openReviewPlatform(link, `rr-review-${platform}`);
  }

  showReviewCompleteOverlay(platform);
}

function markPlatformPosted(platform) {
  platformsPosted[platform] = true;
  triggerConfetti({ count: 25, duration: 2 });
  initPostScreen(); // Re-render (also updates progress bar)
  saveSession();
}

function updatePostContinueButton() {
  const postedCount = Object.values(platformsPosted).filter(Boolean).length;
  $('#btn-continue-post').disabled = postedCount === 0;
}

function updatePostProgress() {
  const total = PARAMS.platforms.length;
  const posted = Object.values(platformsPosted).filter(Boolean).length;
  const pct = total ? Math.round((posted / total) * 100) : 0;
  const fill = $('#post-progress-fill');
  const text = $('#post-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${posted} of ${total} posted`;
}

function handleContinueAfterPost() {
  if (PARAMS.videoUrl) {
    transitionTo('video');
  } else {
    transitionTo('complete');
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
      const hint = document.createElement('p');
      hint.id = 'ty-hint';
      hint.className = 'muted text-center mt-md';
      hint.textContent = `Taking you back to ${PARAMS.customerCompany} in a moment…`;
      host.appendChild(hint);
    }
  }
  setTimeout(() => { window.location.href = PARAMS.thankYouUrl; }, 5000);
}

function triggerConfetti(opts = {}) {
  const { count = 70, duration = 3 } = opts;
  const container = $('#confetti-container');
  container.innerHTML = '';

  const cs = getComputedStyle(document.documentElement);
  const pick = (v, fallback) => (v && v.trim()) || fallback;
  const colors = [
    pick(cs.getPropertyValue('--ll-purple'), '#752fef'),
    pick(cs.getPropertyValue('--ll-accent'), '#22c55e'),
    '#0c63ff',
    '#9333ea',
    '#ec4899',
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
  // Show the last agent empathy message
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

  const payload = {
    event,
    client_slug: PARAMS.clientSlug,
    provider: PARAMS.providerName,
    client: PARAMS.customerCompany,
    customer_name: PARAMS.name,
    customer_email: PARAMS.email,
    rating: starRating,
    posted: Object.keys(platformsPosted).filter(platform => platformsPosted[platform]),
    platforms: PARAMS.platforms,
    session_id: sessionId,
    ts: new Date().toISOString(),
    negative_flag: event === 'negative' ? negativeFlagData : null,
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
    // Do not block the customer flow if Slack/email delivery fails.
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
    clutch: 'Clutch', google: 'Google Business',
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
        platformsPosted,
        reviewFormOpened,
        negativeFlagData,
        lastAgentMessage,
        notificationsSent,
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
    platformsPosted = data.platformsPosted || {};
    reviewFormOpened = data.reviewFormOpened || {};
    negativeFlagData = data.negativeFlagData || null;
    lastAgentMessage = data.lastAgentMessage || '';
    notificationsSent = data.notificationsSent || {};

    // Replay chat messages into the UI
    chatHistory.forEach(msg => addChatBubble(msg.role, msg.content));

    // Transition to saved state
    transitionTo(data.currentState || 'welcome');
    return true;
  } catch (_) {
    return false;
  }
}

// Clear session (for dev/testing)
window.rrReset = () => {
  hideReviewCompleteOverlay();
  try {
    sessionStorage.removeItem(getSessionStorageKey());
  } catch (_) {}
  window.location.reload();
};
