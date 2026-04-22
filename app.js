/* ============================================================
   Reputation Rocket — app.js
   State machine + API integration + chat logic
   ============================================================ */

const CONFIG = {
  // Use relative path when proxied (localhost or Netlify), direct URL otherwise
  API_URL: (window.location.hostname === 'localhost' || window.location.hostname.includes('netlify'))
    ? '/api/v1/brand-slug/test/query'
    : 'https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query',
  API_KEY: '594aa935e360c9bf28f97437c1dddea9',
  AGENT: 'reputation-rocket',
  TIMEOUT_MS: 60000,
};

// ── URL Params ──────────────────────────────────────────────
const PARAMS = (() => {
  const p = new URLSearchParams(window.location.search);
  const name = p.get('name') || '';
  const platforms = (p.get('platforms') || '').split(',').map(s => s.trim()).filter(Boolean);

  // Build review_links from review_{platform} params
  const reviewLinks = {};
  platforms.forEach(plat => {
    const link = p.get(`review_${plat}`);
    if (link) reviewLinks[plat] = link;
  });

  return {
    name,
    firstName: name.split(' ')[0] || 'there',
    company: p.get('company') || 'our team',
    email: p.get('email') || '',
    platforms,
    reviewLinks,
    videoUrl: p.get('video_url') || '',
    welcomeVideoUrl: p.get('welcome_video_url') || '',
    thankYouUrl: p.get('thank_you_url') || '',
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
let negativeFlagData = null;
let isWaitingForAgent = false;
let lastAgentMessage = '';

// ── Fetch with sticky routing ───────────────────────────────
async function fetchWithStickyRetry(body, signal) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': CONFIG.API_KEY,
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
      'X-API-Key': CONFIG.API_KEY,
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

// ── DOM refs ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Populate dynamic text
  $$('.company-name').forEach(el => { el.textContent = PARAMS.company; });
  $$('.first-name').forEach(el => { el.textContent = PARAMS.firstName; });
  document.title = `Reputation Rocket — ${PARAMS.company}`;

  // Optional welcome video
  if (PARAMS.welcomeVideoUrl) {
    const src = $('#welcome-video-source');
    const vid = $('#welcome-video');
    if (src && vid) {
      src.src = PARAMS.welcomeVideoUrl;
      vid.load();
      vid.style.display = '';
    }
  }

  // Try to restore session
  if (restoreSession()) return;

  // Wire up welcome
  $('#btn-start').addEventListener('click', startExperience);

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

  // Video screen
  $('#btn-skip-video').addEventListener('click', () => transitionTo('complete'));
  $('#btn-record-video').addEventListener('click', () => {
    if (PARAMS.videoUrl) window.open(PARAMS.videoUrl, '_blank');
  });
});

// ── State Machine ───────────────────────────────────────────
function transitionTo(state) {
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
    const num = parseInt(step.dataset.step);
    step.classList.remove('active', 'done');

    if (state === 'negative') {
      // Negative: steps 1-2 done, rest grayed
      if (num <= 2) step.classList.add('done');
    } else if (state === 'complete') {
      step.classList.add('done');
    } else if (num < activeStep) {
      step.classList.add('done');
    } else if (num === activeStep) {
      step.classList.add('active');
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
        client_name: PARAMS.company,
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
      throw new Error(`API error: ${res.status} ${res.statusText}`);
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
  return text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>');
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
        client_name: PARAMS.company,
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
        <p class="platform-hint">You'll come back here to confirm</p>
      `;
    }
    grid.appendChild(card);
  });

  // Wire paste-flow buttons (auto-mark after 2s)
  grid.querySelectorAll('[data-action="post-paste"]').forEach(btn => {
    btn.addEventListener('click', () => handlePastePost(btn.dataset.platform));
  });
  // Wire open-only buttons (no clipboard, user opens the site and does the work there)
  grid.querySelectorAll('[data-action="open-only"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const link = PARAMS.reviewLinks[plat];
      if (link) window.open(link, '_blank');
    });
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
  // Wire manual "I posted it" confirm buttons
  grid.querySelectorAll('[data-action="confirm-posted"]').forEach(btn => {
    btn.addEventListener('click', () => markPlatformPosted(btn.dataset.platform));
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
      <p class="platform-hint">You'll come back here to confirm</p>
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

  return `
    <span class="platform-status ready" data-action="open-only" data-platform="${plat}">Open G2 review form →</span>
    <p class="platform-hint">G2 asks you 4 questions — copy each answer below as you fill the form.</p>
    <details class="card-details">
      <summary>Show answers (${fields.length})</summary>
      <div class="card-details-body">
        ${fieldRows}
      </div>
    </details>
    <button type="button" class="btn-confirm" data-action="confirm-posted" data-platform="${plat}">I posted it →</button>
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

  // Open platform in new tab
  if (link) {
    window.open(link, '_blank');
  }

  // Mark as posted after a short delay (simulates user returning)
  // In production, use visibilitychange. For prototype, mark after 2s.
  setTimeout(() => {
    markPlatformPosted(platform);
  }, 2000);
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
  maybeRedirectToThankYou();
}

function maybeRedirectToThankYou() {
  if (!PARAMS.thankYouUrl) return;
  // Avoid duplicate hint if re-entered
  if (!document.getElementById('ty-hint')) {
    const host = document.querySelector('.screen.active .screen-content');
    if (host) {
      const hint = document.createElement('p');
      hint.id = 'ty-hint';
      hint.className = 'muted text-center mt-md';
      hint.textContent = `Taking you back to ${PARAMS.company} in a moment…`;
      host.appendChild(hint);
    }
  }
  setTimeout(() => { window.location.href = PARAMS.thankYouUrl; }, 5000);
}

function triggerConfetti(opts = {}) {
  const { count = 70, duration = 3 } = opts;
  const container = $('#confetti-container');
  container.innerHTML = '';

  const colors = ['#7612fa', '#c109af', '#ff6221', '#6bc950', '#0c63ff', '#eadafd'];

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

  // Log negative flag data (in production, POST to notification webhook)
  if (negativeFlagData) {
    console.log('[Reputation Rocket] NEGATIVE FLAG:', negativeFlagData);
  }

  maybeRedirectToThankYou();
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
    sessionStorage.setItem('rr_session', JSON.stringify({
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
      negativeFlagData,
      lastAgentMessage,
    }));
  } catch (_) { /* quota exceeded — ignore */ }
}

function restoreSession() {
  try {
    const saved = sessionStorage.getItem('rr_session');
    if (!saved) return false;

    const data = JSON.parse(saved);
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
    negativeFlagData = data.negativeFlagData || null;
    lastAgentMessage = data.lastAgentMessage || '';

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
  sessionStorage.removeItem('rr_session');
  window.location.reload();
};
