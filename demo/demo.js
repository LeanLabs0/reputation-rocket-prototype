/*
 * Demo runtime. Two responsibilities:
 *   1. A fetch shim that stubs only the side-effecting endpoints. The chat uses
 *      the REAL agent (/api/agent passes straight through), but the demo never
 *      sends real Slack notifications (/api/notify) or uploads real videos
 *      (/api/upload-video).
 *   2. An interactive guided tour (coach-marks) that walks the user through each
 *      stage of the Reputation Rocket flow.
 *
 * Loaded BEFORE ../app.js so the fetch override is in place before any request.
 */
(function () {
  'use strict';

  // ============================================================
  // 1. Fetch shim — stub side effects only; real agent passes through
  // ============================================================
  const originalFetch = window.fetch.bind(window);

  function jsonResponse(payload, delayMs) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }, delayMs || 0);
    });
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';

    // /api/agent is intentionally NOT intercepted — the demo talks to the real
    // Reputation Rocket agent. We only stub the side-effecting endpoints so the
    // demo never posts to Slack or uploads a real video.
    if (url.indexOf('/api/notify') !== -1) {
      return jsonResponse({ ok: true, delivered_to: 'demo' }, 200);
    }
    if (url.indexOf('/api/upload-video') !== -1) {
      return jsonResponse({ ok: true, id: 'demo-video', url: '#' }, 500);
    }

    return originalFetch(input, init);
  };

  // ============================================================
  // 2. Guided tour (coach-marks)
  // ============================================================
  const TOUR_DISMISSED_KEY = 'rr_demo_tour_dismissed';

  // One coach-mark per stage, keyed by the app's screen state. `target` is the
  // element to spotlight (null = centered intro). Shown the first time each
  // screen becomes active.
  const STEPS = {
    welcome: {
      target: '#btn-start',
      count: 'Step 1 of 6',
      title: 'Welcome',
      body: 'Every review starts here. Click <strong>Begin</strong> to kick off the guided flow — go ahead, we’ll follow along.',
    },
    chat: {
      target: '.chat-input-bar',
      count: 'Step 2 of 6',
      title: 'Quick chat',
      body: 'A friendly AI assistant asks a few questions about your experience. Answer naturally and hit send. These replies are powered by the real assistant.',
    },
    draft: {
      target: '.draft-card',
      count: 'Step 3 of 6',
      title: 'Your review draft',
      body: 'We turn the chat into a ready-to-post review for each platform. Edit it or switch tabs, then click <strong>Looks Good</strong>.',
    },
    post: {
      target: '#platform-grid',
      count: 'Step 4 of 6',
      title: 'Post it',
      body: 'Open each platform, paste the copied review, then confirm. Don\'t worry, nothing is posted for real.',
    },
    video: {
      target: '.video-card',
      count: 'Step 5 of 6',
      title: 'Optional video',
      body: 'Customers can add a short video testimonial. Feel free to <strong>Skip for Now</strong> to see the finish line.',
    },
    complete: {
      target: '.stats-row',
      count: 'Step 6 of 6',
      title: 'All done!',
      body: 'That’s the whole flow. In a real run this is where the review gets celebrated and the team is notified. Thanks for trying the demo!',
    },
    negative: {
      target: '#empathy-card',
      count: 'Alternate path',
      title: 'Not every review is glowing, and that’s OK',
      body: 'Because your answers signalled some frustration, Reputation Rocket took the <strong>private feedback path</strong> instead of asking for a public review. The customer feels heard, and the team gets a private Slack alert to follow up within 1–2 business days. <strong>No negative review is ever posted publicly.</strong> (In this demo, nothing is actually sent.)',
    },
  };

  const INTRO = {
    title: 'Welcome to the Reputation Rocket demo',
    body: 'You’re about to walk through exactly what your happy customers experience using a fictional company and dummy review sites. We’ll pop in with a quick tip at each step.',
  };

  let root = null;
  let spotlightEl = null;
  let popoverEl = null;
  let currentTarget = null;
  let tourActive = false;
  let introPending = false;
  const shownSteps = new Set();
  let repositionRaf = 0;

  function isDismissed() {
    try {
      return localStorage.getItem(TOUR_DISMISSED_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setDismissed(v) {
    try {
      if (v) localStorage.setItem(TOUR_DISMISSED_KEY, '1');
      else localStorage.removeItem(TOUR_DISMISSED_KEY);
    } catch (_) { /* ignore */ }
  }

  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'rr-tour-root';
    root.hidden = true;

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'rr-tour-spotlight';

    popoverEl = document.createElement('div');
    popoverEl.className = 'rr-tour-popover';

    root.appendChild(spotlightEl);
    root.appendChild(popoverEl);
    document.body.appendChild(root);

    window.addEventListener('resize', scheduleReposition, { passive: true });
    window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
  }

  function hideOverlay() {
    if (root) root.hidden = true;
    currentTarget = null;
  }

  function endTour(dismiss) {
    if (dismiss) setDismissed(true);
    tourActive = false;
    introPending = false;
    hideOverlay();
  }

  function scheduleReposition() {
    if (!root || root.hidden || !currentTarget) return;
    if (repositionRaf) cancelAnimationFrame(repositionRaf);
    repositionRaf = requestAnimationFrame(() => positionTo(currentTarget));
  }

  function positionTo(target) {
    const rect = target.getBoundingClientRect();
    const pad = 8;
    const top = Math.max(rect.top - pad, 6);
    const left = Math.max(rect.left - pad, 6);
    const width = Math.min(rect.width + pad * 2, window.innerWidth - 12);
    const height = rect.height + pad * 2;

    spotlightEl.className = 'rr-tour-spotlight';
    spotlightEl.style.top = `${top}px`;
    spotlightEl.style.left = `${left}px`;
    spotlightEl.style.width = `${width}px`;
    spotlightEl.style.height = `${height}px`;

    popoverEl.className = 'rr-tour-popover';

    // Measure popover, then place below target if room, else above.
    const popH = popoverEl.offsetHeight || 180;
    const popW = popoverEl.offsetWidth || 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    let popTop;
    let arrow;
    if (spaceBelow >= popH + 18 || spaceBelow >= rect.top) {
      popTop = rect.bottom + 14;
      arrow = 'top';
    } else {
      popTop = Math.max(rect.top - popH - 14, 8);
      arrow = 'bottom';
    }
    let popLeft = rect.left;
    if (popLeft + popW > window.innerWidth - 8) {
      popLeft = window.innerWidth - popW - 8;
    }
    popLeft = Math.max(popLeft, 8);

    popoverEl.style.top = `${popTop}px`;
    popoverEl.style.left = `${popLeft}px`;
    popoverEl.setAttribute('data-arrow', arrow);
    const arrowX = Math.min(Math.max(rect.left - popLeft + rect.width / 2 - 6, 14), popW - 24);
    popoverEl.style.setProperty('--arrow-x', `${arrowX}px`);
  }

  function renderPopover(step, opts) {
    const isCenter = !!(opts && opts.center);
    const nextLabel = (opts && opts.nextLabel) || 'Got it';
    popoverEl.innerHTML = `
      ${step.count ? `<span class="rr-tour-step-count">${step.count}</span>` : ''}
      <h3 class="rr-tour-title">${step.title}</h3>
      <p class="rr-tour-body">${step.body}</p>
      <div class="rr-tour-actions">
        <button type="button" class="rr-tour-skip">Skip tour</button>
        <button type="button" class="rr-tour-next">${nextLabel}</button>
      </div>`;
    popoverEl.querySelector('.rr-tour-skip').addEventListener('click', () => endTour(true));
    popoverEl.querySelector('.rr-tour-next').addEventListener('click', () => {
      if (opts && typeof opts.onNext === 'function') opts.onNext();
      else hideOverlay();
    });

    if (isCenter) {
      popoverEl.classList.add('rr-tour-popover--center');
      popoverEl.removeAttribute('data-arrow');
    } else {
      popoverEl.classList.remove('rr-tour-popover--center');
    }
  }

  function showIntro() {
    ensureRoot();
    root.hidden = false;
    introPending = true;
    currentTarget = null;
    spotlightEl.className = 'rr-tour-spotlight rr-tour-spotlight--center';
    spotlightEl.removeAttribute('style');
    renderPopover(INTRO, {
      center: true,
      nextLabel: 'Start the tour',
      onNext: () => {
        introPending = false;
        // Immediately show the step for whatever screen is active now.
        const active = currentActiveState();
        if (active && STEPS[active]) showStep(active, true);
        else hideOverlay();
      },
    });
  }

  function showStep(state, force) {
    const step = STEPS[state];
    if (!step) return;
    if (!force && shownSteps.has(state)) return;
    shownSteps.add(state);

    const target = step.target ? document.querySelector(step.target) : null;
    if (!target) {
      // Target not in DOM yet (e.g. grid still rendering) — retry shortly.
      requestAnimationFrame(() => {
        const t2 = step.target ? document.querySelector(step.target) : null;
        if (!t2) return;
        ensureRoot();
        root.hidden = false;
        currentTarget = t2;
        renderPopover(step, {});
        positionTo(t2);
      });
      return;
    }

    ensureRoot();
    root.hidden = false;
    currentTarget = target;
    renderPopover(step, {});
    positionTo(target);
  }

  function currentActiveState() {
    const el = document.querySelector('.screen.active');
    if (!el) return '';
    const m = String(el.id || '').match(/^screen-(.+)$/);
    return m ? m[1] : '';
  }

  function onScreenActivated(state) {
    // The negative-path explainer always shows when the demo routes a customer
    // there, even if the guided tour was skipped or already finished — it's a
    // key thing to demonstrate.
    if (state === 'negative') {
      if (introPending) return;
      showStep('negative', false);
      return;
    }
    if (!tourActive || introPending) return;
    if (!STEPS[state]) return;
    showStep(state, false);
  }

  function watchScreens() {
    const screens = document.querySelectorAll('.screen');
    if (!screens.length) return;
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        const el = mut.target;
        if (el.classList && el.classList.contains('active')) {
          const m = String(el.id || '').match(/^screen-(.+)$/);
          if (m) onScreenActivated(m[1]);
        }
      }
    });
    screens.forEach((s) => observer.observe(s, { attributes: true, attributeFilter: ['class'] }));
  }

  function replayFromStart() {
    // Re-arm the tour so it auto-plays on load, then reset the whole flow back
    // to the welcome screen. rrReset() reloads the page; on reload initTour()
    // sees the tour is no longer dismissed and shows the intro from step 1.
    setDismissed(false);
    if (typeof window.rrReset === 'function') {
      window.rrReset();
    } else {
      try {
        sessionStorage.removeItem('rr_session_demo');
      } catch (_) { /* ignore */ }
      window.location.reload();
    }
  }

  function initTour() {
    watchScreens();

    const replayBtn = document.getElementById('rr-demo-replay-tour');
    if (replayBtn) replayBtn.addEventListener('click', replayFromStart);

    if (!isDismissed()) {
      tourActive = true;
      // Defer so app.js has finished its initial render/transition.
      requestAnimationFrame(() => showIntro());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTour);
  } else {
    initTour();
  }
})();
