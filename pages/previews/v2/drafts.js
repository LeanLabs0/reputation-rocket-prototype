/*
 * RepRocket V2 preview: draft builder and "our words" scorer.
 *
 * Preview only (non-working). Nothing here calls the agent, the network or
 * storage. Drafts are filled from fixed templates using only what the
 * customer picked or typed, so a phrase we want (the category, who it is for,
 * what they switched from) shows up in a draft only when the customer chose it.
 * The same goes for opinions: a draft recommends, praises or says "nothing to
 * add" only when the customer's own answers say so.
 *
 * Loads in the browser as window.V2Drafts and in node tests via require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V2Drafts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Seeded randomness so a given set of answers is repeatable ──────
  function hashString(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rand, list) {
    return list[Math.floor(rand() * list.length) % list.length];
  }

  // ── Text helpers ───────────────────────────────────────────────────
  function words(text) {
    const t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function clipWords(text, max) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= max) return parts.join(' ');
    return parts.slice(0, max).join(' ').replace(/[,;:]$/, '');
  }

  // Customer text, cleaned up. Brackets and braces go (they would read as a
  // template slot or a V1 "[FIELD: ...]" label), and so does doubled
  // punctuation.
  function tidy(text) {
    return String(text || '')
      .replace(/[[\]{}]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/([.!?])[.!?]+/g, '$1')
      .replace(/([,;:])[,;:.!?]+/g, '$1')
      .replace(/([.!?]),/g, '$1')
      .trim();
  }

  function capFirst(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Lowercase the first letter unless the first word is an acronym (AEO).
  function lowerFirst(s) {
    const first = s.split(' ')[0];
    if (first.length > 1 && first === first.toUpperCase()) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  // Common words a customer capitalizes only because they start the box.
  // Anything else (Clio, Excel, HubSpot) keeps its capital.
  const COMMON_FIRST = new Set(('a an the our my we it its they their this that these those too no not some lots lot ' +
    'many much all every each one two three just mostly only very really nothing none another other old new manual ' +
    'slow hard paper spreadsheets case cases client clients form forms keeping tracking managing getting finding ' +
    'filling using having being re-typing retyping time money budget data people staff email emails court deadlines ' +
    'reports reporting billing invoices agency agencies freelancer freelancers website websites software tool tools ' +
    'system systems lifesaver game game-changer').split(' '));

  // A short phrase the customer typed, ready to drop into a sentence.
  function ownPhrase(text, maxWords) {
    let t = clipWords(tidy(text).replace(/[\s.,;:!?]+$/, ''), maxWords || 12).replace(/[\s.,;:!?]+$/, '');
    if (!t) return '';
    const bare = t.split(' ')[0].replace(/[^A-Za-z-]/g, '');
    const acronym = bare.length > 1 && bare === bare.toUpperCase();
    if (bare && !acronym && bare !== 'I' && COMMON_FIRST.has(bare.toLowerCase())) t = lowerFirst(t);
    return t;
  }

  function asSentence(text) {
    let t = tidy(text);
    if (!t) return '';
    t = capFirst(t);
    if (!/[.!?]$/.test(t)) t += '.';
    return t;
  }

  // Whole sentences while they fit, else the first clause, else a clip.
  function shortenCustomer(text, budget) {
    const t = tidy(text);
    if (!t || budget < 1) return '';
    const sentences = t.split(/(?<=[.!?])\s+/);
    let out = '';
    for (const s of sentences) {
      const next = out ? `${out} ${s}` : s;
      if (words(next) > budget) break;
      out = next;
    }
    if (!out) {
      const clause = sentences[0].split(/[,;]\s+/)[0];
      out = words(clause) <= budget ? clause : clipWords(clause, budget);
    }
    return asSentence(out);
  }

  function firstClause(text, maxWords) {
    const t = tidy(text);
    if (!t) return '';
    const sentence = t.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
    const clause = sentence.split(/[,;]\s+/)[0];
    return clipWords(clause, maxWords);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Segments: text pieces, some tagged with the slot they came from ─
  // slot X = category / service, Y = who it is for, Z = switched from or
  // problem, R = the customer's own words. Untagged pieces are template text.
  // src says which step and option a tagged piece came from.
  function seg(t, slot, src) {
    const s = { t: String(t) };
    if (slot) s.slot = slot;
    if (src) s.src = src;
    return s;
  }

  function listSegments(items) {
    const out = [];
    items.forEach((item, i) => {
      if (i > 0) out.push(seg(i < items.length - 1 ? ', ' : items.length > 2 ? ', and ' : ' and '));
      out.push(item);
    });
    return out;
  }

  function segmentsToText(segs) {
    return segs.map((s) => s.t).join('');
  }

  function segmentsToHtml(segs) {
    return segs
      .map((s) => {
        const text = escapeHtml(s.t).replace(/\n/g, '<br>');
        if (!s.slot || s.slot === 'R') return text;
        return `<mark class="v2-mark v2-mark--${s.slot.toLowerCase()}" data-slot="${s.slot}">${text}</mark>`;
      })
      .join('');
  }

  // Fill one template. Returns null when a placeholder has no value, so a
  // sentence never goes out half-filled or with a default we made up.
  function fill(template, vals) {
    const out = [];
    const parts = String(template).split(/(\{[a-zA-Z]+\})/);
    for (const part of parts) {
      if (!part) continue;
      const m = part.match(/^\{([a-zA-Z]+)\}$/);
      if (!m) {
        out.push(seg(part));
        continue;
      }
      const v = vals[m[1]];
      if (!v || !v.length) return null;
      v.forEach((s) => out.push(s));
    }
    return out;
  }

  function placeholders(template) {
    return (String(template).match(/\{[a-zA-Z]+\}/g) || []).map((p) => p.slice(1, -1));
  }

  // Prefer the templates that use the most of what the customer gave us,
  // then pick one of those at random.
  function sentence(kind, vals, preview, rand) {
    const pool = (preview.templates && preview.templates[kind]) || [];
    const usable = pool.filter((tpl) => placeholders(tpl).every((p) => vals[p] && vals[p].length));
    if (!usable.length) return null;
    const most = Math.max(...usable.map((tpl) => placeholders(tpl).length));
    const best = usable.filter((tpl) => placeholders(tpl).length === most);
    return fill(pick(rand, best), vals);
  }

  // ── Answers → placeholder values ───────────────────────────────────
  function stepById(preview, id) {
    return (preview.steps || []).find((s) => s.id === id) || null;
  }

  function optionById(step, id) {
    if (!step || !id) return null;
    return (step.options || []).find((o) => o.id === id) || null;
  }

  function pickedOptions(preview, stepId, answers) {
    const step = stepById(preview, stepId);
    const ans = answers[stepId];
    if (!step || ans == null) return [];
    const ids = Array.isArray(ans) ? ans : [ans];
    return ids.map((id) => optionById(step, id)).filter(Boolean);
  }

  // The options a step shows. With filterBy, only the options tied (via
  // `for`) to what the customer picked on that step, plus any tied to
  // nothing. Nothing picked there shows them all.
  function visibleOptions(preview, step, answers) {
    const opts = (step && step.options) || [];
    if (!step || !step.filterBy) return opts;
    const ans = (answers || {})[step.filterBy];
    const picked = ans == null ? [] : [].concat(ans);
    if (!picked.length) return opts;
    return opts.filter((o) => !o.for || o.for.some((id) => picked.includes(id)));
  }

  // A row label made from the customer's own words.
  function ownDim(text) {
    const t = ownPhrase(text, 6);
    return t ? capFirst(t) : '';
  }

  // Grid rows: the step's fixed dims, or with dimsFrom one row per pick on
  // that step (own words too), so customers rate what they said they got.
  function gridDims(preview, step, answers) {
    if (!step) return [];
    if (!step.dimsFrom) return step.dims || [];
    const safe = answers || {};
    const rows = pickedOptions(preview, step.dimsFrom, safe).map((o) => o.dim || o.label);
    const own = ownDim(safe[`${step.dimsFrom}Other`]);
    if (own && !rows.includes(own)) rows.push(own);
    return rows;
  }

  // Ratings the customer actually gave. A tied top score of 4 or 5 is
  // "strong", a lone top score among several is "the standout", and a 1 or
  // 2 is something that could be better. Every service keeps its own highs
  // and lows. Unrated rows say nothing.
  function gridSummary(preview, answers) {
    const grid = answers && answers.grid && typeof answers.grid === 'object' ? answers.grid : {};
    const step = stepById(preview, 'grid');
    const keys = step && step.perService ? (Array.isArray(answers.services) ? answers.services : []) : ['all'];
    // Row order, not the order the customer tapped the scores. A tied "strong"
    // list then reads the same way the question was shown.
    const dimOrder = gridDims(preview, step, answers);
    const byRow = (a, b) => {
      const ia = dimOrder.indexOf(a);
      const ib = dimOrder.indexOf(b);
      return (ia === -1 ? dimOrder.length : ia) - (ib === -1 ? dimOrder.length : ib);
    };
    const strongs = [];
    const low = [];
    keys.forEach((key) => {
      const dims = grid[key] || {};
      const rated = Object.keys(dims).filter((d) => Number(dims[d]) >= 1 && Number(dims[d]) <= 5).sort(byRow);
      if (!rated.length) return;
      const top = Math.max(...rated.map((d) => Number(dims[d])));
      if (top >= 4) {
        const tops = rated.filter((d) => Number(dims[d]) === top);
        strongs.push({ key, dims: tops, unique: tops.length === 1 && rated.length > 1 });
      }
      rated.filter((d) => Number(dims[d]) <= 2).forEach((d) => low.push({ key, dim: d }));
    });
    return { strongs, low };
  }

  function serviceSeg(preview, key) {
    const svc = optionById(stepById(preview, 'services'), key);
    return svc ? seg(svc.short || svc.phrase, 'X', { step: 'services', option: svc.id }) : null;
  }

  // One grid row's placeholders, without changing the shared answer values.
  function focusGrid(base, preview, entry, kind) {
    const vals = Object.assign({}, base);
    if (kind === 'strong') {
      const dims = entry.dims;
      vals.dims = listSegments(dims.map((d, i) => seg(i === 0 ? d : lowerFirst(d))));
      vals.dim = [seg(dims[0])];
      vals.dimLower = [seg(lowerFirst(dims[0]))];
      vals.strongKind = entry.unique ? 'standout' : dims.length === 1 ? 'strongOne' : 'strongMany';
      const service = serviceSeg(preview, entry.key);
      if (service) vals.service = [service];
      else delete vals.service;
    } else {
      vals.lowDim = [seg(entry.dim)];
      const service = serviceSeg(preview, entry.key);
      if (service) vals.lowService = [service];
      else delete vals.lowService;
    }
    return vals;
  }

  function buildValues(preview, answers) {
    const vals = { co: [seg(preview.company)] };
    const from = (step, o) => ({ step, option: o.id });

    const serviceOpts = pickedOptions(preview, 'services', answers);
    const services = serviceOpts.map((o) => seg(o.phrase, 'X', from('services', o)));
    const otherService = ownPhrase(answers.servicesOther);
    if (otherService) services.push(seg(otherService, 'R'));
    if (services.length) {
      vals.services = listSegments(services);
      vals.firstService = [services[0]];
    }

    const org = pickedOptions(preview, 'orgType', answers)[0];
    if (org) {
      vals.org = [seg(org.phrase, 'Y', from('orgType', org))];
      if (org.plural) vals.orgPlural = [seg(org.plural, 'Y', from('orgType', org))];
    }
    const role = pickedOptions(preview, 'role', answers)[0];
    if (role) vals.role = [seg(role.phrase, 'Y', from('role', role))];
    const industry = pickedOptions(preview, 'industry', answers)[0];
    if (industry) {
      vals.industry = [seg(industry.phrase, 'Y', from('industry', industry))];
      if (industry.plural) vals.industryPlural = [seg(industry.plural, 'Y', from('industry', industry))];
    }

    const before = pickedOptions(preview, 'before', answers)[0];
    if (before && before.firstSystem) vals.firstSystem = [seg('')];
    else if (before) vals.before = [seg(before.phrase, 'Z', from('before', before))];
    const otherBefore = ownPhrase(answers.beforeOther);
    if (!before && otherBefore) vals.beforeOwn = [seg(otherBefore, 'R')];

    const pains = pickedOptions(preview, 'pain', answers).map((o) => seg(o.phrase, 'Z', from('pain', o)));
    if (pains.length) vals.pain = listSegments(pains);
    const otherPain = ownPhrase(answers.painOther);
    if (otherPain) vals.painOwn = [seg(otherPain, 'R')];

    const category = pickedOptions(preview, 'category', answers)[0];
    if (category) {
      vals.category = [seg(category.phrase, 'X', from('category', category))];
      const bare = category.phrase.replace(/^(an?|the)\s+/i, '');
      vals.categoryCap = [seg(capFirst(bare), 'X', from('category', category))];
    }
    const otherCategory = ownPhrase(answers.categoryOther);
    if (!category && otherCategory) vals.category = [seg(otherCategory, 'R')];

    // No "what would you call it" step: the first picked service that names
    // a category gives the headline its category.
    if (!stepById(preview, 'category')) {
      const svc = serviceOpts.find((o) => o.bestAs);
      if (svc) vals.categoryCap = [seg(capFirst(svc.bestAs), 'X', from('services', svc))];
    }

    return vals;
  }

  // ── Platform assembly ──────────────────────────────────────────────
  const FIELDS = {
    g2: (co) => [
      `What do you like best about ${co}?`,
      `What do you dislike about ${co}?`,
      `What problems is ${co} solving and how is that benefiting you?`,
      `Recommendations to others considering ${co}:`,
    ],
    gartner: () => [
      'Please provide comments on your overall experience',
      'What do you like most about the product or service?',
      'What do you dislike most about the product or service?',
      'Create a headline summary of your review',
    ],
  };

  const LIMITS = {
    hubspot: [60, 100],
    google: [50, 100],
    trustpilot: [40, 80],
  };

  const RECOMMEND_KINDS = { yes: 'recommendYes', 'not-sure': 'recommendNotSure', no: 'recommendNo' };

  function joinSentences(list) {
    const out = [];
    list.filter(Boolean).forEach((s, i) => {
      if (i > 0) out.push(seg(' '));
      s.forEach((x) => out.push(x));
    });
    return out;
  }

  // The customer's first clause as a title, only when it reads whole.
  function customerHeadline(text) {
    const clause = firstClause(text, 40);
    if (!clause || words(clause) > 12) return null;
    return [seg(asSentence(clause).replace(/\.$/, ''), 'R')];
  }

  function customerSentence(text, budget) {
    const t = shortenCustomer(text, budget);
    return t ? [seg(t, 'R')] : null;
  }

  // The improve step's skip button is labeled "Nothing to add" and stores "".
  // A missing answer is not that choice.
  function choseNothingToAdd(answers) {
    return Object.prototype.hasOwnProperty.call(answers, 'improve') && !tidy(answers.improve);
  }

  function buildParts(preview, answers, rand) {
    const safe = answers && typeof answers === 'object' ? answers : {};
    const vals = buildValues(preview, safe);
    const s = (kind) => sentence(kind, vals, preview, rand);
    const resultRaw = tidy(safe.result);
    const improveRaw = tidy(safe.improve);
    const recommendKind = RECOMMEND_KINDS[safe.recommend];
    const services = s('services');
    const grid = gridSummary(preview, safe);
    const strongSentences = grid.strongs.map((entry) => {
      const focused = focusGrid(vals, preview, entry, 'strong');
      return sentence(focused.strongKind, focused, preview, rand);
    }).filter(Boolean);
    // Results they picked. A result rated high or low already has its own
    // sentence, so this one only names the rest.
    const rated = new Set(grid.strongs.flatMap((e) => e.dims).concat(grid.low.map((e) => e.dim)));
    const pickedOutcomes = pickedOptions(preview, 'outcomes', safe);
    const outcomeSegs = pickedOutcomes
      .filter((o) => !rated.has(o.dim || o.label))
      .map((o) => seg(o.phrase));
    const ownOutcome = ownPhrase(safe.outcomesOther);
    const ownDimLabel = ownDim(safe.outcomesOther);
    const sameWords = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
    // A typed result that repeats a picked row (or was rated high or low)
    // already has a sentence. Leaving it in would say that result twice.
    const ownRepeatsPick = pickedOutcomes.some((o) => sameWords(o.dim || o.label, ownDimLabel) || sameWords(o.phrase, ownOutcome));
    if (ownOutcome && !rated.has(ownDimLabel) && !ownRepeatsPick) outcomeSegs.push(seg(ownOutcome, 'R'));
    const outcomes = outcomeSegs.length
      ? sentence('outcomes', Object.assign({}, vals, { outcomes: listSegments(outcomeSegs) }), preview, rand)
      : null;
    let before = null;
    if (vals.firstSystem) before = s('firstSystem');
    else if (vals.before) before = s('before');
    else if (vals.beforeOwn) before = s('beforeOwn');
    const who = s('who');
    const pain = s('pain');
    const painOwn = s('painOwn');
    const category = s('category');
    const recommend = recommendKind ? s(recommendKind) : null;
    const lowSentences = grid.low.map((entry) => sentence('low', focusGrid(vals, preview, entry, 'low'), preview, rand)).filter(Boolean);
    return {
      services,
      outcomes,
      strong: strongSentences.length ? joinSentences(strongSentences) : null,
      who,
      before,
      pain,
      painOwn,
      resultRaw,
      result: resultRaw ? customerSentence(resultRaw, 40) : null,
      category,
      recommend,
      recommendIsYes: safe.recommend === 'yes',
      // Only a 4 or 5 overall lets the customer's result stand in as what they like.
      positive: Number(safe.rating) >= 4,
      improveRaw,
      improve: improveRaw ? customerSentence(improveRaw, 40) : null,
      low: lowSentences.length ? joinSentences(lowSentences) : null,
      nothingToAdd: choseNothingToAdd(safe) ? s('nothingToAdd') : null,
      customerHeadline: resultRaw ? customerHeadline(resultRaw) : null,
      categoryHeadline: s('headlineCategory'),
      serviceHeadline: s('headlineService'),
    };
  }

  // Middle sentences can trade places so two customers never read the same.
  function shuffledMiddle(parts, rand) {
    const mid = [parts.who, parts.before, parts.pain, parts.painOwn].filter(Boolean);
    for (let i = mid.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [mid[i], mid[j]] = [mid[j], mid[i]];
    }
    return mid;
  }

  // Keep a single-text draft under the platform's word limit. Praise and a
  // "yes" are dropped first, then extra context. The customer's own sentences
  // are shortened at a sentence or clause break. A "no" or "not sure" stays.
  // A low rating stays unless the draft is still over the limit after the
  // other cuts. G2 and Gartner do not use this trim, so those fields keep it.
  function fitToLimit(list, parts, max) {
    let out = list.filter(Boolean);
    const count = (l) => words(segmentsToText(joinSentences(l)));
    const drops = [parts.strong, parts.recommendIsYes ? parts.recommend : null, parts.outcomes, parts.painOwn, parts.pain, parts.who, parts.before, parts.low, parts.category];
    for (const d of drops) {
      if (count(out) <= max) break;
      if (d) out = out.filter((x) => x !== d);
    }
    [['result', 'resultRaw'], ['improve', 'improveRaw']].forEach(([key, raw]) => {
      if (count(out) <= max || !parts[key] || !out.includes(parts[key])) return;
      const budget = max - count(out.filter((x) => x !== parts[key]));
      const shorter = customerSentence(parts[raw], budget);
      out = out.map((x) => (x === parts[key] ? shorter : x)).filter(Boolean);
    });
    return out;
  }

  function narrativeList(parts, rand) {
    return [parts.services, parts.outcomes, parts.strong].concat(shuffledMiddle(parts, rand), [parts.result, parts.category, parts.improve, parts.low, parts.recommend]);
  }

  function narrative(platform, parts, rand) {
    const max = (LIMITS[platform] || [60, 100])[1];
    return joinSentences(fitToLimit(narrativeList(parts, rand), parts, max));
  }

  function trustpilot(parts, rand) {
    const body = joinSentences(fitToLimit(narrativeList(parts, rand), parts, LIMITS.trustpilot[1]));
    // The category headline first: a title made from the customer's own
    // answer would repeat a line the body already carries.
    const title = parts.categoryHeadline || parts.customerHeadline || parts.serviceHeadline;
    return title ? title.concat([seg('\n')], body) : body;
  }

  function fieldsDraft(labels, bodies) {
    const out = [];
    labels.forEach((label, i) => {
      const body = joinSentences(bodies[i] || []);
      if (i > 0) out.push(seg('\n\n'));
      out.push(seg(`[FIELD: ${label}]\n`));
      body.forEach((x) => out.push(x));
    });
    return out;
  }

  // A field needs a body. Prefer real sentences, then one spare fact, and only
  // then the company name. That last line adds no opinion.
  function fieldBody(preferred, spare, preview) {
    const clean = (preferred || []).filter((p) => p && p.length);
    if (clean.length) return clean;
    if (spare && spare.length) return [spare];
    return [[seg(`${preview.company}.`)]];
  }

  function g2(preview, parts, rand) {
    const labels = FIELDS.g2(preview.company);
    const dislike = [parts.improve, parts.low].filter(Boolean);
    let problems = shuffledMiddle(parts, rand).concat([parts.result]).filter(Boolean);
    let recommend = [parts.recommend, parts.category].filter(Boolean);
    if (!recommend.length) {
      // Nothing said about recommending: hand others a fact the customer gave.
      const moved = [parts.before, parts.who, parts.pain, parts.painOwn, parts.result].find((x) => x && problems.includes(x) && problems.length > 1);
      if (moved) {
        recommend = [moved];
        problems = problems.filter((x) => x !== moved);
      }
    }
    const likeSpare = parts.who || parts.before || (parts.positive ? parts.result : null) || parts.category;
    return fieldsDraft(labels, [
      fieldBody([parts.services, parts.outcomes, parts.strong], likeSpare, preview),
      fieldBody(dislike.length ? dislike : [parts.nothingToAdd], null, preview),
      fieldBody(problems, parts.services, preview),
      fieldBody(recommend, parts.services || parts.who || parts.before, preview),
    ]);
  }

  function gartner(preview, parts) {
    const labels = FIELDS.gartner();
    const dislike = [parts.improve, parts.low].filter(Boolean);
    const resultIsLike = !parts.strong && !parts.outcomes && parts.positive && parts.result;
    const likes = [parts.outcomes, parts.strong].filter(Boolean);
    const like = likes.length ? likes : [(resultIsLike ? parts.result : null) || parts.services || parts.who || parts.before || parts.category].filter(Boolean);
    const headline = parts.categoryHeadline || parts.customerHeadline || parts.serviceHeadline || [seg(preview.company)];
    return fieldsDraft(labels, [
      fieldBody([parts.who, parts.services, parts.before, parts.pain, parts.painOwn, resultIsLike ? null : parts.result, parts.recommend], parts.services, preview),
      fieldBody(like, null, preview),
      fieldBody(dislike.length ? dislike : [parts.nothingToAdd], null, preview),
      [headline],
    ]);
  }

  function buildDrafts(preview, answers, seed) {
    const safe = answers && typeof answers === 'object' ? answers : {};
    const out = {};
    (preview.platforms || []).forEach((platform, i) => {
      const rand = mulberry32((seed >>> 0) ^ hashString(platform) ^ (i * 2654435761));
      const parts = buildParts(preview, safe, rand);
      let segs;
      if (platform === 'g2') segs = g2(preview, parts, rand);
      else if (platform === 'gartner') segs = gartner(preview, parts);
      else if (platform === 'trustpilot') segs = trustpilot(parts, rand);
      else segs = narrative(platform, parts, rand);
      const text = segmentsToText(segs);
      const counted = platform === 'trustpilot' && text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text;
      out[platform] = {
        text,
        html: segmentsToHtml(segs),
        segments: segs,
        words: words(counted.replace(/\[FIELD:[^\]]*\]/g, '')),
      };
    });
    return out;
  }

  // ── "Our words" score: does a text name the category (X), who it is for
  // (Y) and what they switched from or the problem (Z)? ───────────────
  function termRegex(term) {
    const esc = String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i');
  }

  function ourWordsFrom(preview) {
    const slots = { X: new Set(), Y: new Set(), Z: new Set() };
    (preview.steps || []).forEach((step) => {
      if (!step.slot || !slots[step.slot]) return;
      (step.options || []).forEach((o) => (o.terms || []).forEach((t) => slots[step.slot].add(t.toLowerCase())));
    });
    return { X: [...slots.X], Y: [...slots.Y], Z: [...slots.Z] };
  }

  function scoreOurWords(text, ourWords) {
    const t = String(text || '');
    const res = { score: 0 };
    ['X', 'Y', 'Z'].forEach((slot) => {
      const terms = (ourWords && ourWords[slot]) || [];
      const hit = terms.find((term) => termRegex(term).test(t)) || null;
      res[slot] = { hit: Boolean(hit), term: hit };
      if (hit) res.score += 1;
    });
    return res;
  }

  // "Best X for Y with Z", built only from what was picked. X needs an
  // option that names a category; a feature alone is not one.
  function bestFor(preview, answers) {
    const category = pickedOptions(preview, 'category', answers)[0];
    const service = pickedOptions(preview, 'services', answers).find((o) => o.bestAs);
    const x = (category && category.bestAs) || (service && service.bestAs) || '';
    if (!x) return '';
    const who = pickedOptions(preview, 'orgType', answers)[0] || pickedOptions(preview, 'industry', answers)[0];
    const whoName = who && (who.plural || who.phrase);
    const before = pickedOptions(preview, 'before', answers)[0];
    const pain = pickedOptions(preview, 'pain', answers).find((o) => o.bestAs);
    let line = `Best ${x.replace(/^(an?|our|the)\s+/i, '')}`;
    if (whoName) line += ` for ${whoName}`;
    if (before && !before.firstSystem && before.bestAs) line += `${whoName ? '' : ` for ${preview.bestForWho || 'teams'}`} ${before.bestAs}`;
    else if (pain) line += ` ${pain.bestAs}`;
    return line;
  }

  return {
    hashString,
    mulberry32,
    words,
    tidy,
    ownPhrase,
    segmentsToText,
    segmentsToHtml,
    buildDrafts,
    ourWordsFrom,
    scoreOurWords,
    bestFor,
    visibleOptions,
    gridDims,
    FIELDS,
    LIMITS,
  };
});
