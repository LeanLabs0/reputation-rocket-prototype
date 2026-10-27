/*
 * RepRocket V2 preview engine (non-working).
 *
 * Plays the V2 interview from window.V2_PREVIEW using the real portal markup
 * and styles, then shows the drafts and a V1 vs V2 comparison. There is no
 * agent and no network: answers live in memory only and drafts come from
 * window.V2Drafts templates.
 *
 * URL options: ?fast=1 (no typing delays), ?seed=N (repeatable wording),
 * ?jump=compare (fill the sample customer and open V1 vs V2 directly).
 */
(function () {
  'use strict';

  const P = window.V2_PREVIEW;
  const D = window.V2Drafts;
  if (!P || !D) return;

  const qs = new URLSearchParams(window.location.search);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FAST = qs.get('fast') === '1' || reduceMotion;
  const PLATFORM_NAMES = { gartner: 'Gartner', g2: 'G2', trustpilot: 'Trustpilot', hubspot: 'HubSpot', google: 'Google' };
  // Which interview this page shows (eimmigration runs V3 since 10/26).
  const VERSION = P.versionLabel || 'V2';
  // Letter marks instead of the live favicons, so the preview loads nothing from other hosts.
  const PLATFORM_MARKS = { gartner: 'Ga', g2: 'G2', trustpilot: 'Tp', hubspot: 'HS', google: 'G' };

  const state = {
    answers: {},
    stepIndex: -1,
    gridQueue: [],
    seed: qs.has('seed') ? Number(qs.get('seed')) >>> 0 : Math.floor(Math.random() * 4294967295),
    platformSeeds: {},
    drafts: null,
    edits: {},
    approved: {},
    active: null,
    comparePlatform: null,
    fromSample: false,
    started: false,
    // First half of an answer while its one follow-up is on screen.
    partial: {},
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, FAST ? 0 : ms));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  // ── Screens and progress ──────────────────────────────────────────
  // The honesty screen is not a numbered step. The live portal marks the chat
  // done and leaves "Your Review" unlit, because that customer is not posting.
  const STEP_OF = { welcome: 1, chat: 2, draft: 3, compare: 4 };

  // A step whose skipIf matches earlier answers is not asked. V3: a yes to
  // "publish as a 5-star rating" skips the star question. An empty rule
  // skips nothing.
  function stepSkipped(step, answers) {
    const rule = step && step.skipIf;
    if (!rule) return false;
    const keys = Object.keys(rule);
    if (!keys.length) return false;
    return keys.every((k) => (answers || {})[k] === rule[k]);
  }

  // The follow-up is a second sentence, not a tail glued onto the first.
  function joinFollowUp(first, second) {
    let a = String(first || '').trim();
    const b = String(second || '').trim();
    if (!a) return b;
    if (!b) return a;
    a = a.replace(/[,;:]+$/, '');
    if (!/[.!?]$/.test(a)) a += '.';
    return `${a} ${b}`;
  }

  function lowRatingBelow(lowRating) {
    if (!lowRating || lowRating.below == null) return 5;
    return Number(lowRating.below);
  }

  // Gate only a real 1 to N star answer. A blank is not "under 5": that screen
  // is for a number the customer actually gave, and a blank still reaches the
  // drafts. A gated star step must leave `skip` off (eimmigration). Lean Labs
  // has no gate, so its Skip still reaches the drafts.
  function ratingIsGated(rating, lowRating) {
    if (!lowRating || !lowRating.gate) return false;
    const n = Number(rating);
    return n >= 1 && n < lowRatingBelow(lowRating);
  }

  function previewProgress(name, stepNumber, stepOf) {
    const negative = name === 'negative';
    const active = negative ? 0 : ((stepOf && stepOf[name]) || 1);
    return {
      done: negative ? stepNumber <= 2 : stepNumber < active,
      active: negative ? false : stepNumber === active,
    };
  }

  // Step bar under the welcome button (P.progressBelowWelcome), like the live
  // portal: it previews the steps on Step 1, then goes back to the top.
  // Move it before the welcome screen hides, or it would hide with it.
  function isParkedAfter(node, anchor) {
    if (!node || !anchor) return false;
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && !String(prev.textContent || '').trim()) prev = prev.previousSibling;
    return prev === anchor;
  }

  function placeProgress(name) {
    if (!P.progressBelowWelcome) return;
    const shell = $('.progress-shell');
    const cta = $('#screen-welcome .welcome-cta');
    const home = $('#progress-shell-home');
    if (!shell || !cta || !home) return;
    const below = name === 'welcome';
    const anchor = below ? cta : home;
    // Moving a bar that is already in place restarts its layout. The welcome
    // page puts it under the button, so the first show must leave it there.
    if (!isParkedAfter(shell, anchor)) anchor.after(shell);
    shell.classList.toggle('progress-shell--below-welcome', below);
  }

  function show(name) {
    placeProgress(name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    $$('.progress-step').forEach((step) => {
      const mark = previewProgress(name, Number(step.dataset.step), STEP_OF);
      step.classList.toggle('done', mark.done);
      step.classList.toggle('active', mark.active);
      const dot = $('.progress-dot', step);
      if (dot) dot.dataset.state = mark.done ? 'done' : mark.active ? 'active' : 'pending';
      const badge = $('.progress-badge', step);
      if (badge) badge.textContent = mark.done ? 'Completed' : mark.active ? 'In progress' : 'Pending';
    });
    window.scrollTo(0, 0);
  }

  // ── Chat ──────────────────────────────────────────────────────────
  const messages = () => $('#chat-messages');

  // The chat uses smooth scrolling for the finger. Programmatic jumps have
  // to be instant: a smooth scroll to the bottom and a second smooth scroll
  // back to the question land on whichever animation finishes last, which
  // hides the question the choices belong to.
  function setScrollTop(node, top) {
    if (!node) return;
    const previous = node.style.scrollBehavior;
    node.style.scrollBehavior = 'auto';
    node.scrollTop = top;
    node.style.scrollBehavior = previous;
  }

  function scrollChat() {
    const m = messages();
    if (m) setScrollTop(m, m.scrollHeight);
  }

  function appendAgentRow(bubble) {
    const row = el('div', { class: 'chat-message-row agent' }, [el('div', { class: 'chat-message-avatar', 'aria-hidden': 'true' }), bubble]);
    // Choices sit in this same scroller. A live region on the whole scroller
    // would announce every chip again each time a score is tapped.
    if (P.inlineChoices) row.setAttribute('role', 'status');
    messages().appendChild(row);
    return row;
  }

  async function agentSay(text) {
    const typing = $('#typing-indicator');
    if (typing) typing.classList.add('visible');
    await wait(450 + Math.min(600, String(text).length * 4));
    if (typing) typing.classList.remove('visible');
    const bubble = el('div', { class: 'chat-bubble agent' });
    String(text).split('\n').forEach((line, i) => {
      if (i > 0) bubble.appendChild(el('br'));
      bubble.appendChild(document.createTextNode(line));
    });
    appendAgentRow(bubble);
    scrollChat();
  }

  function userSay(text) {
    messages().appendChild(el('div', { class: 'chat-bubble user', text }));
    scrollChat();
  }

  // With P.inlineChoices the choices sit inside the chat, right under the
  // question, and scroll with it. Otherwise they sit in a bar under the chat.
  function choiceBar() {
    let bar = $('#chat-choice-bar');
    if (!bar) {
      bar = el('div', { id: 'chat-choice-bar', class: `chat-choice-bar${P.inlineChoices ? ' is-inline' : ''}` });
      if (P.inlineChoices) bar.setAttribute('aria-live', 'off');
      if (P.inlineChoices) messages().appendChild(bar);
      else {
        const input = $('.chat-input-bar');
        input.parentNode.insertBefore(bar, input);
      }
    }
    return bar;
  }

  function mode(which) {
    const input = $('.chat-input-bar');
    input.hidden = which !== 'text';
    if (P.inlineChoices) {
      const old = $('#chat-choice-bar');
      if (old && which !== 'choices') old.remove();
      if (which === 'choices') choiceBar();
    } else {
      const bar = choiceBar();
      bar.hidden = which !== 'choices';
      if (which !== 'choices') bar.innerHTML = '';
    }
    // The chat shrinks once the text box shows, so scroll after layout.
    // Without this the last answer can end up half hidden under the box.
    // Inline choices scroll in reveal(), which keeps the question in view
    // instead of jumping to the bottom of a tall list.
    if (!(P.inlineChoices && which === 'choices')) requestAnimationFrame(scrollChat);
  }

  // Show the new question and its choices together. When both don't fit,
  // keep the question in view; the choices are a scroll away.
  function reveal(bar) {
    if (!P.inlineChoices) return requestAnimationFrame(scrollChat);
    requestAnimationFrame(() => {
      const m = messages();
      const row = bar.previousElementSibling;
      const base = m.getBoundingClientRect().top - m.scrollTop;
      const top = (row || bar).getBoundingClientRect().top - base - 12;
      const bottom = bar.getBoundingClientRect().bottom - base + 20 - m.clientHeight;
      setScrollTop(m, Math.max(0, Math.min(top, bottom)));
    });
  }

  // Keyboard users land on the new question's first control.
  function focusFirst(root) {
    const first = $('button:not([disabled]), input:not([hidden]), textarea', root);
    if (first) first.focus({ preventScroll: true });
  }

  // ── Steps ─────────────────────────────────────────────────────────
  function optionLabel(step, id) {
    const o = (step.options || []).find((x) => x.id === id);
    return o ? o.label : '';
  }

  function serviceShort(id) {
    const s = P.steps.find((x) => x.id === 'services');
    const o = (s.options || []).find((x) => x.id === id);
    return o ? o.short || o.label : '';
  }

  function sampleFor(step) {
    return P.persona ? P.persona[step.id] : undefined;
  }

  function actionsRow(left, right) {
    return el('div', { class: 'v2-choice-actions' }, [el('div', {}, left), el('div', {}, right)]);
  }

  async function runStep(i) {
    state.stepIndex = i;
    const step = P.steps[i];
    if (!step) return finishChat();
    if (stepSkipped(step, state.answers)) {
      if (step.skipValue !== undefined) state.answers[step.id] = step.skipValue;
      // A filled-in rating still has to hit the reach-out gate. Yes maps to 5,
      // so this does not fire on the V3 skip. A value under the threshold would.
      if (step.type === 'stars' && ratingIsGated(state.answers[step.id], P.lowRating)) return runLowRating();
      return runStep(i + 1);
    }
    if (step.type === 'grid' && step.perService) {
      state.gridQueue = (state.answers.services || []).slice(0, step.maxServices || 3);
      if (!state.gridQueue.length) return runStep(i + 1);
      state.answers.grid = {};
      return runGridQueue(step);
    }
    // A grid built from earlier picks has nothing to rate when nothing was picked.
    const dims = step.type === 'grid' ? D.gridDims(P, step, state.answers) : null;
    if (dims && !dims.length) return runStep(i + 1);
    // A filtered step with no options left for these picks is skipped too.
    if ((step.type === 'multi' || step.type === 'single') && !step.ownWords && !D.visibleOptions(P, step, state.answers).length) return runStep(i + 1);
    await agentSay(step.ask);
    if (step.type === 'multi') renderChoices(step, true);
    else if (step.type === 'single') renderChoices(step, false);
    else if (step.type === 'stars') renderStars(step);
    else if (step.type === 'grid') renderGrid(step, 'all', null, dims);
    else if (step.type === 'text') renderText(step);
  }

  const next = () => runStep(state.stepIndex + 1);

  // Multi- and single-select chips, with optional own words and Skip.
  // Own words count toward the step's max, so nothing typed gets dropped.
  function renderChoices(step, multi) {
    mode('choices');
    const bar = choiceBar();
    const picked = new Set();
    const max = multi ? step.max || Infinity : 1;
    const grid = el('div', { class: 'v2-chip-grid', role: 'group', 'aria-label': step.ask });
    const own = el('input', { class: 'v2-own-input', type: 'text', placeholder: 'In your own words', 'aria-label': 'In your own words', maxlength: '120', hidden: true });
    const hintText = step.max ? `Pick up to ${step.max}` : 'Pick all that apply';
    const hint = multi ? el('span', { class: 'v2-choice-hint', text: hintText }) : null;
    const ownOpen = () => !own.hidden;
    const ownText = () => (ownOpen() ? own.value.trim() : '');
    const used = () => picked.size + (ownOpen() ? 1 : 0);

    function flashLimit() {
      if (!hint) return;
      hint.textContent = `Up to ${step.max}. Unpick one first.`;
      hint.classList.add('is-flash');
    }

    function clearFlash() {
      if (!hint) return;
      hint.textContent = hintText;
      hint.classList.remove('is-flash');
    }

    function chip(label, attrs, onClick) {
      const b = el('button', Object.assign({ type: 'button', class: `v2-chip${multi ? '' : ' v2-chip--single'}`, 'aria-pressed': 'false' }, attrs), [el('span', { class: 'v2-chip-box', 'aria-hidden': 'true' }), el('span', { text: label })]);
      b.addEventListener('click', () => onClick(b));
      return b;
    }

    const cont = el('button', { type: 'button', class: 'btn btn-primary btn-md', disabled: true, text: 'Continue' });
    const min = step.min == null ? 1 : step.min;
    const sync = () => {
      const count = picked.size + (ownText() ? 1 : 0);
      // Continue means at least one answer. Skip is the way to leave a step blank.
      cont.disabled = multi ? count < Math.max(min, 1) : !ownText();
    };

    D.visibleOptions(P, step, state.answers).forEach((o) => {
      grid.appendChild(chip(o.label, { 'data-option': o.id }, (b) => {
        if (!multi) return submit([o.id], '');
        if (picked.has(o.id)) picked.delete(o.id);
        else if (used() < max) picked.add(o.id);
        else return flashLimit();
        clearFlash();
        b.setAttribute('aria-pressed', String(picked.has(o.id)));
        sync();
      }));
    });
    if (step.ownWords) {
      grid.appendChild(chip('Something else', { class: 'v2-chip v2-chip--ghost', 'data-option': 'other' }, (b) => {
        if (!ownOpen() && multi && used() >= max) return flashLimit();
        own.hidden = ownOpen();
        if (own.hidden) own.value = '';
        b.setAttribute('aria-pressed', String(ownOpen()));
        if (!multi) cont.hidden = !ownOpen();
        if (ownOpen()) own.focus();
        sync();
      }));
    }
    own.addEventListener('input', sync);
    own.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !cont.disabled) cont.click();
    });

    function submit(ids, text) {
      if (multi) state.answers[step.id] = ids;
      else state.answers[step.id] = ids[0] || null;
      if (text) state.answers[`${step.id}Other`] = text;
      else delete state.answers[`${step.id}Other`];
      const labels = ids.map((id) => optionLabel(step, id)).concat(text ? [text] : []);
      mode('none');
      userSay(labels.length ? labels.join(', ') : 'Skip');
      next();
    }

    cont.addEventListener('click', () => submit(multi ? [...picked] : [], ownText()));

    const left = [];
    if (hint) left.push(hint);
    let sample = sampleFor(step);
    // On a filtered step the sample only offers options that are on screen.
    if (step.filterBy && sample != null) {
      const shown = new Set(D.visibleOptions(P, step, state.answers).map((o) => o.id));
      sample = [].concat(sample).filter((id) => shown.has(id));
    }
    if (sample != null && sample !== '' && !(Array.isArray(sample) && !sample.length)) {
      const sb = el('button', { type: 'button', class: 'v2-sample-btn', text: 'Use the sample answer' });
      sb.addEventListener('click', () => submit(Array.isArray(sample) ? sample : [sample], ''));
      left.push(sb);
    }

    const right = [];
    if (step.skip) {
      const skip = el('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: 'Skip' });
      skip.addEventListener('click', () => submit([], ''));
      right.push(skip);
    }
    if (multi || step.ownWords) right.push(cont);
    if (!multi) cont.hidden = true;

    bar.appendChild(el('div', { class: 'v2-choice-scroll' }, [grid, own]));
    bar.appendChild(actionsRow(left, right));
    sync();
    reveal(bar);
    focusFirst(bar);
  }

  function starIcon() {
    return '<svg class="rating-choice-star" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><polygon fill="currentColor" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  }

  function renderStars(step) {
    mode('choices');
    const bar = choiceBar();
    const row = el('div', { class: 'rating-choice-row', role: 'group', 'aria-label': 'Your rating from 1 to 5' });
    [1, 2, 3, 4, 5].forEach((n) => {
      const b = el('button', { type: 'button', class: 'rating-choice', 'data-rating': String(n), 'aria-label': `${n} star${n === 1 ? '' : 's'}`, html: `<span class="rating-choice-num">${n}</span>${starIcon()}` });
      b.addEventListener('click', async () => {
        state.answers[step.id] = n;
        mode('none');
        userSay(`${n} star${n === 1 ? '' : 's'}`);
        if (P.lowRating && n < lowRatingBelow(P.lowRating)) return runLowRating();
        if (!P.lowRating && n < 5) await agentSay('(Preview note) The live flow sends ratings under 5 down a different path today. This preview asks the same questions at every rating and drafts with the rating you gave.');
        next();
      });
      row.appendChild(b);
    });
    bar.appendChild(row);
    bar.appendChild(el('div', { class: 'rating-choice-legend', 'aria-hidden': 'true', html: '<span>Poor</span><span>Excellent</span>' }));
    // A star step without `skip` needs a number, so the under-5 check always
    // has one (eimmigration V3, after a no to "publish as a 5-star rating").
    if (step.skip) {
      const skip = el('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: 'Skip' });
      skip.addEventListener('click', () => {
        state.answers[step.id] = null;
        mode('none');
        userSay('Skip');
        next();
      });
      bar.appendChild(actionsRow([], [skip]));
    }
    reveal(bar);
    focusFirst(bar);
  }

  // Under the threshold (P.lowRating): offer to fix things first, then carry
  // on with the questions. With gate, the chat ends without drafts or review
  // links (see finishChat).
  function starsAnswer() {
    const step = (P.steps || []).find((s) => s.type === 'stars');
    return step ? state.answers[step.id] : state.answers.rating;
  }

  function isGated() {
    return ratingIsGated(starsAnswer(), P.lowRating);
  }

  async function runLowRating() {
    const L = P.lowRating;
    await agentSay(L.ask);
    mode('choices');
    const bar = choiceBar();
    const row = el('div', { class: 'v2-chip-grid', role: 'group', 'aria-label': L.ask });
    L.options.forEach((o) => {
      const b = el('button', { type: 'button', class: 'v2-chip v2-chip--single', 'aria-pressed': 'false', 'data-option': o.id }, [el('span', { class: 'v2-chip-box', 'aria-hidden': 'true' }), el('span', { text: o.label })]);
      b.addEventListener('click', async () => {
        state.answers.fixFirst = o.id;
        mode('none');
        userSay(o.label);
        if (o.reply) await agentSay(o.reply);
        if (L.note) await agentSay(L.note);
        next();
      });
      row.appendChild(b);
    });
    bar.appendChild(el('div', { class: 'v2-choice-scroll' }, [row]));
    reveal(bar);
    focusFirst(bar);
  }

  async function runGridQueue(step) {
    const service = state.gridQueue.shift();
    if (!service) return next();
    await agentSay(step.ask.replace('{service}', serviceShort(service)));
    renderGrid(step, service, () => runGridQueue(step));
  }

  // Rate what applies. Rows left blank say nothing in the draft. Rows are the
  // step's dims unless the caller passes the rows built from earlier picks.
  function renderGrid(step, key, done, rows) {
    mode('choices');
    const bar = choiceBar();
    const dims = rows || step.dims;
    const values = {};
    const wrap = el('div', { class: 'v2-grid' });
    const cont = el('button', { type: 'button', class: 'btn btn-primary btn-md', disabled: true, text: 'Continue' });
    dims.forEach((dim) => {
      const scale = el('div', { class: 'v2-scale', role: 'group', 'aria-label': dim });
      [1, 2, 3, 4, 5].forEach((n) => {
        const b = el('button', { type: 'button', class: 'rating-choice', 'aria-pressed': 'false', 'aria-label': `${dim} ${n}`, text: String(n) });
        b.addEventListener('click', () => {
          if (values[dim] === n) delete values[dim];
          else values[dim] = n;
          $$('.rating-choice', scale).forEach((x) => x.setAttribute('aria-pressed', String(values[dim] != null && x === b)));
          cont.disabled = !dims.some((d) => values[d]);
        });
        scale.appendChild(b);
      });
      wrap.appendChild(el('div', { class: 'v2-grid-row' }, [el('span', { class: 'v2-grid-label', text: dim }), scale]));
    });
    const submit = (vals) => {
      const rated = dims.filter((d) => vals[d]);
      state.answers.grid = state.answers.grid || {};
      if (rated.length) state.answers.grid[key] = vals;
      mode('none');
      userSay(rated.length ? rated.map((d) => `${d} ${vals[d]}`).join(' · ') : 'Skip');
      if (done) done();
      else next();
    };
    cont.addEventListener('click', () => submit(Object.assign({}, values)));
    const skip = el('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: 'Skip' });
    skip.addEventListener('click', () => submit({}));
    // The sample only rates rows that are on screen.
    const full = P.persona && P.persona.grid && P.persona.grid[key];
    const sample = full && Object.keys(full).filter((d) => dims.includes(d)).reduce((o, d) => Object.assign(o, { [d]: full[d] }), {});
    const left = [];
    if (sample && Object.keys(sample).length) {
      const sb = el('button', { type: 'button', class: 'v2-sample-btn', text: 'Use the sample answer' });
      sb.addEventListener('click', () => submit(Object.assign({}, sample)));
      left.push(sb);
    }
    bar.appendChild(el('div', { class: 'v2-choice-scroll' }, [wrap, el('p', { class: 'v2-note', text: "Rate the ones that apply. Leave any you can't judge blank." })]));
    bar.appendChild(actionsRow(left, [skip, cont]));
    reveal(bar);
    focusFirst(bar);
  }

  // followUp: one friendly nudge when the first answer is very short, so
  // there are enough of their own words to build the review from.
  function renderText(step, isFollowUp) {
    mode('text');
    const input = $('#chat-input');
    const send = $('#chat-send');
    input.value = '';
    input.placeholder = isFollowUp
      ? 'Add one more sentence, or leave it here'
      : (step.required ? 'Type your answer...' : 'Type your answer, or skip');
    send.disabled = true;

    const tools = [];
    if (step.sample && !isFollowUp) {
      const sb = el('button', { type: 'button', class: 'v2-sample-btn', text: 'Use the sample answer' });
      sb.addEventListener('click', () => { input.value = step.sample; send.disabled = false; input.focus(); });
      tools.push(sb);
    }
    const skipLabel = isFollowUp ? (step.followUp && step.followUp.skipLabel) || "That's it" : step.skipLabel || 'Skip';
    if (!step.required || isFollowUp) {
      const skip = el('button', { type: 'button', class: 'btn btn-tertiary btn-md', text: skipLabel });
      skip.addEventListener('click', () => finish('', skipLabel));
      tools.push(skip);
    }
    let toolbar = $('.v2-text-tools');
    if (!toolbar) {
      toolbar = el('div', { class: 'v2-text-tools' });
      $('.chat-input-bar').insertBefore(toolbar, $('.chat-composer'));
    }
    toolbar.innerHTML = '';
    tools.forEach((t) => toolbar.appendChild(t));
    toolbar.hidden = !tools.length;

    const onInput = () => { send.disabled = input.value.trim().split(/\s+/).filter(Boolean).length < (step.required ? 3 : 1); };
    const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !send.disabled) { e.preventDefault(); finish(input.value.trim()); } };
    const onSend = () => { if (!send.disabled) finish(input.value.trim()); };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    send.addEventListener('click', onSend);
    input.focus({ preventScroll: true });

    function finish(text, label) {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      send.removeEventListener('click', onSend);
      input.value = '';
      send.disabled = true;
      mode('none');
      userSay(label || text);
      const first = state.partial[step.id];
      const f = step.followUp;
      const minWords = f && f.minWords == null ? 8 : f && f.minWords;
      if (f && !isFollowUp && text && D.words(text) < minWords) {
        state.partial[step.id] = text;
        agentSay(f.ask).then(() => renderText(step, true));
        return;
      }
      delete state.partial[step.id];
      state.answers[step.id] = joinFollowUp(first, text);
      next();
    }
  }

  // ── Drafts ────────────────────────────────────────────────────────
  function buildDrafts() {
    state.drafts = D.buildDrafts(P, state.answers, state.seed);
    state.edits = {};
    state.approved = {};
    state.active = P.platforms[0];
  }

  async function finishChat() {
    mode('none');
    buildDrafts();
    // Gated: the review is saved, not offered for posting. The drafts stay
    // reachable from the preview-only note on the end screen. Without that
    // screen, keep the draft ending so the page cannot go blank.
    if (isGated() && $('#screen-negative')) {
      const saved = P.lowRating.saved && String(P.lowRating.saved).trim();
      if (saved) await agentSay(saved);
      await wait(1200);
      show('negative');
      // The chat hides with the screen. The live portal keeps the closing
      // line on the empathy card, as text, not HTML.
      const empathy = $('#empathy-message');
      if (empathy && saved) empathy.textContent = saved;
      const heading = $('h2', $('#screen-negative'));
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      return;
    }
    if (P.draftsReady) {
      const [first, ...rest] = P.draftsReady.split('\n\n');
      const link = el('a', { href: '#', role: 'button', class: 'chat-draft-inline__link', text: 'Read the drafts.' });
      link.addEventListener('click', (e) => { e.preventDefault(); openDrafts(); });
      const bubble = el('div', { class: 'chat-bubble agent' }, [el('p', { text: first })].concat(rest.map((r) => el('p', { text: r })), [el('p', {}, [link])]));
      const typing = $('#typing-indicator');
      if (typing) typing.classList.add('visible');
      await wait(700);
      if (typing) typing.classList.remove('visible');
      const row = appendAgentRow(bubble);
      row.id = 'chat-draft-inline';
      row.classList.add('chat-draft-inline');
      scrollChat();
      link.focus({ preventScroll: true });
    } else {
      await agentSay("Thanks! I've put together drafts for each platform. Take a look and edit anything you like.");
      const prompt = $('#chat-draft-prompt');
      const sub = $('#chat-draft-prompt-subhead');
      const list = $('#chat-draft-prompt-platforms');
      if (sub) sub.textContent = `We drafted ${P.platforms.length} reviews, one for each platform.`;
      if (list) {
        list.innerHTML = '';
        P.platforms.forEach((p) => list.appendChild(el('div', { class: 'chat-draft-prompt__mini' }, [el('span', { class: 'chat-draft-prompt__mini-name', text: PLATFORM_NAMES[p] || p })])));
      }
      if (prompt) {
        prompt.classList.add('visible');
        prompt.setAttribute('aria-hidden', 'false');
      }
      const view = $('#btn-view-draft');
      if (view) {
        view.addEventListener('click', openDrafts, { once: true });
        view.focus({ preventScroll: true });
      }
    }
  }

  // The star row above the draft shows the rating they actually gave.
  // A skipped or missing rating stays empty. It is never filled in as 5.
  function renderDraftStars() {
    const n = Number(starsAnswer());
    const rated = n >= 1 && n <= 5;
    $$('#draft-stars .star').forEach((star) => {
      const v = Number(star.dataset.value);
      star.classList.toggle('filled', rated && v <= n);
      star.classList.toggle('empty', !rated || v > n);
    });
    const row = $('#draft-stars');
    if (row) {
      row.setAttribute('role', 'img');
      row.setAttribute('aria-label', rated ? `${n} out of 5 stars` : 'No overall rating given');
    }
  }

  // A 5-star visit leaves the draft header as authored. A gated visit says
  // the reviews are saved and not posted, and a later 5-star visit puts the
  // original wording back from a copy of those nodes. Nothing is parsed as HTML.
  function applyDraftIntro(gated) {
    const header = $('#screen-draft .screen-header');
    if (!header) return;
    const title = $('h3', header);
    if (title) {
      if (title.dataset.ready == null) title.dataset.ready = title.textContent;
      title.textContent = gated ? 'Saved reviews, not posted yet.' : title.dataset.ready;
    }
    const paras = $$('p', header);
    const restore = (p) => {
      if (!p._readyClone) return;
      p.replaceChildren(...Array.from(p._readyClone.childNodes, (n) => n.cloneNode(true)));
      p.hidden = false;
    };
    if (gated) {
      paras.forEach((p, i) => {
        if (!p._readyClone) p._readyClone = p.cloneNode(true);
        if (i === 0) {
          p.hidden = false;
          p.textContent = 'Saved for the team, not posted. The customer is not sent to the review sites. In this preview, click Compare with V1 to see what changed.';
        } else p.hidden = true;
      });
    } else {
      paras.forEach(restore);
    }
    const whatNext = $('#draft-what-next-desc');
    if (!whatNext) return;
    if (whatNext.dataset.ready == null) whatNext.dataset.ready = whatNext.textContent;
    if (gated) {
      whatNext.textContent = 'These drafts stay with the team. The customer is not sent on to post them. In this preview, Compare with V1 shows what changed.';
    } else if (!whatNext.dataset.ready.trim()) {
      whatNext.textContent = 'In the live portal, the next screen helps the customer post each review. In this preview, "Compare with V1" shows what changed.';
    } else {
      whatNext.textContent = whatNext.dataset.ready;
    }
  }

  function openDrafts() {
    renderDraftStars();
    renderDraftTabs();
    renderDraft();
    applyDraftIntro(isGated());
    show('draft');
  }

  function renderDraftTabs() {
    const tabs = $('#draft-tabs');
    tabs.innerHTML = '';
    P.platforms.forEach((p) => {
      const b = el('button', {
        type: 'button',
        class: `draft-tab${p === state.active ? ' active' : ''}${state.approved[p] ? ' is-approved' : ''}`,
        role: 'tab',
        'aria-selected': String(p === state.active),
        'data-platform': p,
      }, [
        el('span', { class: 'draft-tab-icon draft-tab-icon--empty v2-tab-mark', 'aria-hidden': 'true', text: PLATFORM_MARKS[p] || '' }),
        el('span', { class: 'draft-tab-label', text: PLATFORM_NAMES[p] || p }),
      ]);
      b.addEventListener('click', () => { state.active = p; renderDraftTabs(); renderDraft(); });
      tabs.appendChild(b);
    });
  }

  function renderDraft() {
    const ta = $('#draft-textarea');
    const p = state.active;
    ta.value = state.edits[p] != null ? state.edits[p] : state.drafts[p].text;
    const hint = $('#draft-copy-hint-text');
    if (hint) hint.textContent = `Preview only. Edits are kept while you switch tabs, and the V1 vs ${VERSION} view uses the original draft.`;
  }

  function wireDraftButtons() {
    const ta = $('#draft-textarea');
    if (ta) ta.addEventListener('input', () => { state.edits[state.active] = ta.value; });
    const editHint = $('#btn-edit-hint');
    if (editHint && ta) editHint.addEventListener('click', () => ta.focus());
    const regen = $('#btn-regenerate');
    if (regen) regen.addEventListener('click', () => {
      state.platformSeeds[state.active] = Math.floor(Math.random() * 4294967295);
      const fresh = D.buildDrafts(P, state.answers, state.platformSeeds[state.active]);
      state.drafts[state.active] = fresh[state.active];
      delete state.edits[state.active];
      renderDraft();
    });
    const all = $('#btn-approve-all');
    const ok = $('#btn-approve');
    if (ok) ok.addEventListener('click', () => {
      state.approved[state.active] = true;
      const nextUp = P.platforms.find((p) => !state.approved[p]);
      if (nextUp) state.active = nextUp;
      renderDraftTabs();
      renderDraft();
      if (!nextUp && all) {
        all.scrollIntoView({ block: 'center' });
        all.focus({ preventScroll: true });
      }
    });
    if (all) {
      all.disabled = false;
      const label = $('.v2-approve-label', all);
      if (label) label.textContent = 'Compare with V1';
      all.addEventListener('click', openCompare);
    }
  }

  // ── V1 vs V2 ──────────────────────────────────────────────────────
  const SLOT_NAMES = { X: 'Category or service', Y: 'Who it is for', Z: 'Switched from or problem' };

  function askText(step) {
    return step.ask.replace('the {service}', 'each service').replace('{service}', 'each service');
  }

  function scoreRow(score, notAsked) {
    const row = el('div', { class: 'v2-score' });
    row.appendChild(el('span', { class: 'v2-score-total', text: `${score.score} of 3` }));
    ['X', 'Y', 'Z'].forEach((slot) => {
      const hit = score[slot] && score[slot].hit;
      const text = hit ? `${SLOT_NAMES[slot]}: "${score[slot].term}"` : `${SLOT_NAMES[slot]}: ${notAsked ? 'never asked' : 'missing'}`;
      row.appendChild(el('span', { class: `v2-score-chip ${hit ? 'is-hit' : 'is-miss'}`, text }));
    });
    return row;
  }

  // Every marked phrase in the draft on screen, with the pick it came from.
  function provenanceRows(platform) {
    const rows = [];
    const seen = new Set();
    state.drafts[platform].segments.forEach((sg) => {
      if (!sg.slot || sg.slot === 'R' || !sg.src) return;
      const key = `${sg.src.step}|${sg.src.option}|${sg.t}`;
      if (seen.has(key)) return;
      seen.add(key);
      const step = P.steps.find((s) => s.id === sg.src.step);
      const o = step && (step.options || []).find((x) => x.id === sg.src.option);
      if (step && o) rows.push([sg.t, sg.slot, askText(step), o.label]);
    });
    return rows;
  }

  function provenanceTable(platform) {
    const rows = provenanceRows(platform);
    const box = el('div', { class: 'v2-section' });
    if (!rows.length) return box;
    const table = el('table', { class: 'v2-table' }, [
      el('thead', {}, [el('tr', {}, ['Phrase in the draft', 'Type', 'Question', 'What the customer picked'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows.map((r) => el('tr', {}, [el('td', { text: r[0] }), el('td', { text: SLOT_NAMES[r[1]] }), el('td', { text: r[2] }), el('td', { text: r[3] })]))),
    ]);
    box.appendChild(el('h4', { text: `Where every marked phrase in the ${PLATFORM_NAMES[platform] || platform} draft came from` }));
    box.appendChild(el('div', { class: 'v2-table-wrap' }, [table]));
    return box;
  }

  function openCompare() {
    const host = $('#compare-host');
    host.innerHTML = '';
    const ow = D.ourWordsFrom(P);
    const v1 = P.v1;
    const best = D.bestFor(P, state.answers);
    if (best) host.appendChild(el('div', { class: 'v2-bestfor' }, [el('small', { text: 'The AI answer this review now backs up' }), best]));

    // V1 card
    const v1Text = (v1.sampleAnswers || []).join(' ');
    const v1Score = v1Text ? D.scoreOurWords(v1Text, ow) : { score: 0 };
    const v1Card = el('div', { class: 'v2-card' }, [
      el('div', { class: 'v2-card-label', text: v1.label }),
      el('h4', { text: v1.sampleTitle }),
      scoreRow(v1Score, !v1Text),
    ]);
    if (v1.scoreCaption) v1Card.appendChild(el('p', { class: 'v2-note', text: v1.scoreCaption }));
    if (v1Text) {
      v1Card.appendChild(el('h5', { text: 'Their answers' }));
      v1.sampleAnswers.forEach((a) => v1Card.appendChild(el('blockquote', { text: a })));
    }
    if (v1.sampleNote) v1Card.appendChild(el('p', { text: v1.sampleNote }));
    if (v1.draftNotes && v1.draftNotes.length) {
      v1Card.appendChild(el('h5', { text: 'What their V1 drafts said (paraphrased)' }));
      v1Card.appendChild(el('ul', {}, v1.draftNotes.map((n) => el('li', { text: n }))));
    }
    if (v1.published) {
      v1Card.appendChild(el('h5', { text: `A published V1 review (${v1.published.site})` }));
      v1Card.appendChild(el('blockquote', { text: v1.published.title }));
    }
    v1Card.appendChild(el('h5', { text: 'What V1 asks' }));
    v1Card.appendChild(el('ol', {}, v1.questions.map((q) => el('li', { text: q }))));

    // V2 card
    const v2Card = el('div', { class: 'v2-card' });
    const plats = el('div', { class: 'v2-platforms', role: 'group', 'aria-label': 'Platform' });
    const scoreHost = el('div');
    const textHost = el('div', { class: 'v2-draft-text' });
    const tableHost = el('div');
    const renderV2 = (p) => {
      state.comparePlatform = p;
      $$('button', plats).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.platform === p)));
      const d = state.drafts[p];
      scoreHost.innerHTML = '';
      scoreHost.appendChild(scoreRow(D.scoreOurWords(d.text, ow), false));
      textHost.innerHTML = d.html;
      tableHost.innerHTML = '';
      tableHost.appendChild(provenanceTable(p));
    };
    P.platforms.forEach((p) => {
      const b = el('button', { type: 'button', 'data-platform': p, text: PLATFORM_NAMES[p] || p });
      b.addEventListener('click', () => renderV2(p));
      plats.appendChild(b);
    });
    v2Card.appendChild(el('div', { class: 'v2-card-label', text: `${VERSION} preview` }));
    v2Card.appendChild(el('h4', { text: state.fromSample ? P.personaLabel : 'Drafted from the answers you gave' }));
    v2Card.appendChild(scoreHost);
    v2Card.appendChild(plats);
    v2Card.appendChild(textHost);
    v2Card.appendChild(el('div', { class: 'v2-legend', html: '<span><mark class="v2-mark v2-mark--x" data-slot="X">category or service</mark></span><span><mark class="v2-mark v2-mark--y" data-slot="Y">who it is for</mark></span><span><mark class="v2-mark v2-mark--z" data-slot="Z">switched from or problem</mark></span><span>Unmarked text is the customer\'s own words or plain glue.</span>' }));
    v2Card.appendChild(el('h5', { text: `What ${VERSION} asks` }));
    v2Card.appendChild(el('ol', {}, P.steps.map((s) => el('li', { text: askText(s) }))));
    renderV2(P.platforms.includes('g2') ? 'g2' : P.platforms[0]);

    host.appendChild(el('div', { class: 'v2-compare' }, [v1Card, v2Card]));
    host.appendChild(tableHost);

    // V1 evidence
    if (v1.stats && v1.stats.length) {
      const stats = el('div', { class: 'v2-stats' }, v1.stats.map((s) => el('div', { class: 'v2-stat' }, [el('div', { class: 'v2-stat-big', text: s.big }), el('div', { class: 'v2-stat-text', text: s.text })])));
      host.appendChild(el('div', { class: 'v2-section' }, [el('h4', { text: 'What V1 is collecting today' }), stats, el('p', { class: 'v2-source', text: v1.statsSource || '' })]));
    }
    show('compare');
  }

  // ── Start ─────────────────────────────────────────────────────────
  function fillBrand() {
    $$('.company-name, .provider-name').forEach((n) => { n.textContent = P.company; });
  }

  // Same intro video as the live welcome screen: the play overlay shows the
  // native controls and starts playback.
  function wireWelcomeVideo() {
    const wrap = $('.welcome-video-wrap');
    const vid = $('#welcome-video');
    const play = $('.welcome-video-play');
    if (!wrap || !vid || !play) return;
    play.addEventListener('click', () => {
      vid.controls = true;
      wrap.classList.add('is-playing');
      const p = vid.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    });
  }

  function start() {
    // Begin is a big button. A second click would ask the first question twice.
    if (state.started) return;
    state.started = true;
    const vid = $('#welcome-video');
    if (vid) vid.pause();
    const m = messages();
    if (m && !P.inlineChoices) {
      m.setAttribute('role', 'log');
      m.setAttribute('aria-live', 'polite');
    }
    show('chat');
    mode('none');
    runStep(0);
  }

  function jumpToCompare() {
    state.answers = JSON.parse(JSON.stringify(P.persona));
    state.fromSample = true;
    buildDrafts();
    openCompare();
  }

  document.addEventListener('DOMContentLoaded', () => {
    fillBrand();
    wireWelcomeVideo();
    wireDraftButtons();
    const savedDrafts = $('#btn-saved-drafts');
    if (savedDrafts) savedDrafts.addEventListener('click', openDrafts);
    const begin = $('#btn-start');
    if (begin) begin.addEventListener('click', start);
    $$('[data-v2-restart]').forEach((b) => b.addEventListener('click', () => {
      window.location.href = window.location.pathname;
    }));
    const startOver = $('#btn-start-over');
    if (startOver) startOver.addEventListener('click', () => { window.location.href = window.location.pathname; });
    if (qs.get('jump') === 'compare') jumpToCompare();
    else show('welcome');
  });
})();
