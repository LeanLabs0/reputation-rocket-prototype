const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'pages/previews/v2');
const D = require(path.join(V2, 'drafts.js'));
const BRANDS = ['eimmigration', 'lean-labs'];

function loadPreview(slug) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(V2, slug, 'script.js'), 'utf8'), sandbox);
  return sandbox.window.V2_PREVIEW;
}

// V1's own G2/Gartner splitter, so V2 drafts are checked against the parser
// the post screen really uses.
function loadParseG2Fields() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = src.indexOf('function parseG2Fields(');
  assert.notEqual(start, -1, 'missing parseG2Fields in app.js');
  const end = src.indexOf('\n}\n', start);
  const sandbox = {};
  vm.runInNewContext(src.slice(start, end + 2), sandbox);
  return sandbox.parseG2Fields;
}

function step(preview, id) {
  return preview.steps.find((s) => s.id === id);
}

// Own words the way people really type them.
const OWN = [
  'Case management!',
  'Clio..',
  'A lifesaver.',
  'our old system kept crashing!!',
  'paper files, mostly',
  'FileVine',
  'too many {braces} and [FIELD: fake] labels',
  'we had a freelancer and then nobody at all for a long while honestly it was rough',
];
const LONG_TEXT = 'Support was slow to answer and the forms broke twice. We are still deciding whether to stay, honestly, because the price went up again this year and nobody told us before the renewal date.';

// Random but repeatable answers inside each step's limits. Any step can be
// skipped, own words count toward a step's max, and every rating can show up.
function randomAnswers(preview, rand) {
  const a = {};
  const one = (list) => list[Math.floor(rand() * list.length)];
  preview.steps.forEach((s) => {
    // A filtered step only offers what the customer would see on screen.
    const ids = D.visibleOptions(preview, s, a).map((o) => o.id);
    if (s.type === 'multi') {
      const own = s.ownWords && rand() < 0.3 ? one(OWN) : '';
      const room = (s.max || ids.length) - (own ? 1 : 0);
      let picked = ids.filter(() => rand() < 0.4).slice(0, room);
      if (s.id === 'services' && !picked.length && !own) picked = [ids[0]];
      a[s.id] = picked;
      if (own) a[`${s.id}Other`] = own;
    } else if (s.type === 'single') {
      const r = rand();
      if (s.ownWords && r < 0.2) {
        a[s.id] = null;
        a[`${s.id}Other`] = one(OWN);
      } else {
        a[s.id] = r < 0.4 ? null : one(ids);
      }
    } else if (s.type === 'text') {
      const r = rand();
      a[s.id] = r < 0.3 ? '' : r < 0.65 ? s.sample || 'It would help to edit invoices.' : LONG_TEXT;
    } else if (s.type === 'stars') {
      a[s.id] = 1 + Math.floor(rand() * 5);
    }
  });
  const grid = step(preview, 'grid');
  if (!grid) return a;
  const dims = D.gridDims(preview, grid, a);
  const row = () => {
    const r = {};
    dims.forEach((d) => { if (rand() >= 0.2) r[d] = 1 + Math.floor(rand() * 5); });
    return r;
  };
  a.grid = {};
  if (grid.perService) (a.services || []).slice(0, grid.maxServices || 3).forEach((id) => { a.grid[id] = row(); });
  else a.grid.all = row();
  return a;
}

function gridScores(a) {
  return Object.values(a.grid || {}).flatMap((r) => Object.values(r));
}

function eachRandomDraft(count, seed, fn) {
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    const rand = D.mulberry32(seed);
    for (let i = 0; i < count; i += 1) {
      const a = randomAnswers(p, rand);
      fn(slug, p, a, D.buildDrafts(p, a, i));
    }
  }
}

function withoutLabels(text) {
  return text.replace(/\[FIELD: [^\]\n]*\]\n?/g, '');
}

test('picked phrases show up and unpicked ones never do', () => {
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    const drafts = D.buildDrafts(p, p.persona, 7);
    const all = Object.values(drafts).map((d) => d.text).join('\n').toLowerCase();
    const services = step(p, 'services').options;
    const picked = services.filter((o) => p.persona.services.includes(o.id));
    const named = picked.filter((o) => all.includes(o.phrase.toLowerCase()));
    // V3 drafts name two picks at most; V2 names every pick.
    if (p.draftStyle === 'their-words') assert.ok(named.length >= 1 && named.length <= 2, `${slug}: named ${named.length} picks`);
    else assert.equal(named.length, picked.length, `${slug}: a picked service is missing`);
    services.filter((o) => !p.persona.services.includes(o.id)).forEach((o) => {
      assert.ok(!all.includes(o.phrase.toLowerCase()), `${slug}: unpicked "${o.phrase}" leaked into a draft`);
    });
  }
});

test('nothing half-filled or mangled leaks into drafts', () => {
  eachRandomDraft(300, 99, (slug, p, a, drafts) => {
    for (const [plat, d] of Object.entries(drafts)) {
      const body = withoutLabels(d.text);
      const where = `${slug}/${plat}: ${d.text}`;
      assert.doesNotMatch(body, /\{|\}|\[|\]|undefined|null|NaN| {2}|\.\.|[.!?,;:][.,;:]|\s[.,!?;:]/, where);
      const starts = /(?:^|[.!?]\s+|\n)([a-z]\S*)/g;
      let m;
      while ((m = starts.exec(body))) assert.ok(m[1].startsWith('eimmigration'), `${where}\nstarts lowercase: ${m[1]}`);
    }
  });
});

test('word counts stay inside V1 limits', () => {
  eachRandomDraft(300, 5, (slug, p, a, drafts) => {
    for (const [plat, d] of Object.entries(drafts)) {
      const lim = D.LIMITS[plat];
      if (lim) assert.ok(d.words <= lim[1], `${slug}/${plat} has ${d.words} words (max ${lim[1]}): ${d.text}`);
    }
  });
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    for (const [plat, d] of Object.entries(D.buildDrafts(p, p.persona, 1))) {
      const lim = D.LIMITS[plat];
      if (lim) assert.ok(d.words >= lim[0] && d.words <= lim[1], `${slug}/${plat} sample has ${d.words} words`);
    }
  }
});

test('G2 and Gartner drafts split into the same four fields V1 uses', () => {
  const parseG2Fields = loadParseG2Fields();
  eachRandomDraft(150, 11, (slug, p, a, drafts) => {
    for (const plat of ['g2', 'gartner'].filter((x) => drafts[x])) {
      const fields = parseG2Fields(drafts[plat].text);
      const want = plat === 'g2' ? D.FIELDS.g2(p.company) : D.FIELDS.gartner();
      assert.deepEqual(Array.from(fields, (f) => f.label), want, `${slug}/${plat}`);
      fields.forEach((f) => assert.ok(f.body.trim().length > 0, `${slug}/${plat} field "${f.label}" is empty`));
    }
  });
});

test('same answers and seed repeat, different seeds vary', () => {
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    const a = D.buildDrafts(p, p.persona, 42);
    const b = D.buildDrafts(p, p.persona, 42);
    assert.deepEqual(a, b);
    const plat = p.platforms[p.platforms.length - 1];
    const seen = new Set();
    for (let seed = 0; seed < 50; seed += 1) seen.add(D.buildDrafts(p, p.persona, seed)[plat].text);
    // V3 is mostly the customer's own words, so only our one sentence varies.
    const want = p.draftStyle === 'their-words' ? 2 : 20;
    assert.ok(seen.size >= want, `${slug}/${plat}: only ${seen.size} different drafts in 50 seeds`);
  }
});

test('V2 sample drafts name all three slots, and each V1 sample scores only what it says', () => {
  const expectV1 = { eimmigration: 0, 'lean-labs': 1 };
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    const ow = D.ourWordsFrom(p);
    const drafts = D.buildDrafts(p, p.persona, 3);
    Object.entries(drafts).forEach(([plat, d]) => {
      assert.equal(D.scoreOurWords(d.text, ow).score, 3, `${slug}/${plat} should name X, Y and Z`);
    });
    if (p.v1.sampleAnswers.length) {
      const v1 = D.scoreOurWords(p.v1.sampleAnswers.join(' '), ow);
      assert.equal(v1.score, expectV1[slug], `${slug}: the V1 sample names ${v1.score} of 3`);
      if (slug === 'lean-labs') assert.equal(v1.Z.term, 'ai search');
    }
    if (p.v1.draftNotes && p.v1.draftNotes.length) {
      const notes = D.scoreOurWords(p.v1.draftNotes.join(' '), ow);
      assert.equal(notes.score, 1, `${slug}: draft notes should score the same 1 of 3`);
      assert.equal(notes.Z.term, 'ai search');
    }
    assert.match(D.bestFor(p, p.persona), /^Best .+ for .+/);
  }
});

test('drafts only recommend, praise or wave off complaints when the answers say so', () => {
  const madeUp = /worth a look|should check out|talk to|biggest win|rely on most|no real complaints|nothing major|give .+ a try/i;
  const parseG2Fields = loadParseG2Fields();
  eachRandomDraft(300, 21, (slug, p, a, drafts) => {
    const all = Object.values(drafts).map((d) => d.text).join('\n');
    // Our words only: what the customer typed can say anything.
    const ours = Object.values(drafts).map((d) => d.segments.filter((s) => s.slot !== 'R').map((s) => s.t).join('')).join('\n');
    const where = `${slug} ${JSON.stringify(a)}\n${all}`;
    const scores = gridScores(a);
    assert.doesNotMatch(ours, madeUp, where);
    if (a.recommend !== 'yes') assert.doesNotMatch(ours, /(^|[.!?]\s+|\n)I'd recommend/, where);
    if (a.recommend === 'no') assert.match(all, /wouldn't recommend/, where);
    if (a.recommend === 'not-sure') assert.match(all, /not sure yet whether/, where);
    if (!scores.some((n) => n >= 4)) assert.doesNotMatch(all, /standout|stood out|strong/i, where);
    if (scores.some((n) => n <= 2)) assert.match(all, /could (have been|be) better/, where);
    if (a.improve || scores.some((n) => n <= 2)) assert.doesNotMatch(all, /Nothing to add/, where);
    if (drafts.gartner && !(Number(a.rating) >= 4) && a.result) {
      const likeMost = parseG2Fields(drafts.gartner.text)[1].body;
      assert.ok(!likeMost.includes(D.tidy(a.result).slice(0, 30)), `${where}\nresult used as a like at ${a.rating} stars`);
    }
    const gridStep = step(p, 'grid');
    Object.entries(a.grid || {}).forEach(([key, row]) => {
      Object.entries(row || {}).forEach(([dim, n]) => {
        if (Number(n) <= 2) assert.ok(all.toLowerCase().includes(String(dim).toLowerCase()), `${where}\nmissing low rating "${dim}"`);
      });
      if (!gridStep || !gridStep.perService || !drafts.g2) return;
      const opt = step(p, 'services').options.find((o) => o.id === key);
      if (!opt) return;
      const nums = Object.values(row || {}).map(Number);
      if (nums.some((n) => n >= 4) || nums.some((n) => n <= 2)) {
        const name = String(opt.short || opt.phrase).toLowerCase();
        assert.ok(drafts.g2.text.toLowerCase().includes(name), `${where}\nmissing rated service "${name}"`);
      }
    });
  });
});

test('ratings on every service are kept, and nothing-to-add is a real choice', () => {
  const p = loadPreview('lean-labs');
  const a = {
    services: ['aeo', 'gdd'],
    grid: {
      aeo: { Strategy: 5, Delivery: 1, Communication: 3 },
      gdd: { Strategy: 2, Delivery: 4, Communication: 4 },
    },
    rating: null,
    improve: 'Waiting on a revision.',
    recommend: 'not-sure',
    result: 'Buyers still cannot tell what we sell.',
  };
  const drafts = D.buildDrafts(p, a, 2);
  const g2 = drafts.g2.text;
  assert.match(g2, /AEO program/);
  assert.match(g2, /growth-driven design work/);
  assert.match(g2, /Delivery on the AEO program could have been better/);
  assert.match(g2, /Strategy on the growth-driven design work could have been better/);
  assert.match(g2, /not sure yet whether/);
  assert.doesNotMatch(g2, /Nothing to add/);
  const like = loadParseG2Fields()(drafts.g2.text)[0].body;
  assert.ok(!like.includes('Buyers still cannot tell'), 'a low overall rating must not turn the result into praise');

  const eim = loadPreview('eimmigration');
  const dropped = Object.assign({}, eim.persona);
  delete dropped.improve;
  const withoutChoice = Object.values(D.buildDrafts(eim, dropped, 1)).map((d) => d.text).join('\n');
  assert.doesNotMatch(withoutChoice, /Nothing to add/);
  const chosen = Object.assign({}, eim.persona, { improve: '' });
  assert.match(D.buildDrafts(eim, chosen, 1).g2.text, /Nothing to add/);
});

test('eimmigration V3: three taps, the 5-star question, then their own words', () => {
  const p = loadPreview('eimmigration');
  assert.equal(p.versionLabel, 'V3');
  assert.equal(p.draftStyle, 'their-words');
  assert.deepEqual(Array.from(p.steps, (s) => s.id), ['orgType', 'before', 'services', 'fiveStar', 'rating', 'result', 'advice', 'improve']);
  assert.deepEqual(Array.from(p.steps.slice(0, 3), (s) => s.type), ['single', 'single', 'multi']);
  const five = step(p, 'fiveStar');
  assert.equal(five.ask, 'Would you be willing to publish your review as a 5-star rating?');
  assert.deepEqual(Array.from(five.options, (o) => o.id), ['yes', 'no']);
  const stars = step(p, 'rating');
  assert.equal(stars.type, 'stars');
  assert.deepEqual({ ...stars.skipIf }, { fiveStar: 'yes' });
  assert.equal(stars.skipValue, 5);
  ['result', 'advice', 'improve'].forEach((id) => assert.equal(step(p, id).type, 'text', id));
  assert.equal(step(p, 'result').followUp.minWords, 8);
  assert.ok(!step(p, 'pain') && !step(p, 'outcomes') && !step(p, 'grid') && !step(p, 'recommend'), 'V3 drops the extra tap steps');
  assert.equal(p.lowRating.below, 5);
  assert.equal(p.lowRating.gate, true);
});

test('a yes to the 5-star question skips the star question, anything else asks it', () => {
  const { stepSkipped } = extractPreviewFunctions(['stepSkipped']);
  const stars = step(loadPreview('eimmigration'), 'rating');
  assert.equal(stepSkipped(stars, { fiveStar: 'yes' }), true);
  assert.equal(stepSkipped(stars, { fiveStar: 'no' }), false);
  assert.equal(stepSkipped(stars, { fiveStar: null }), false, 'skipping the question still shows the stars');
  assert.equal(stepSkipped(stars, {}), false);
  assert.equal(stepSkipped({ id: 'x' }, { fiveStar: 'yes' }), false);
  assert.equal(stepSkipped(step(loadPreview('lean-labs'), 'rating'), { fiveStar: 'yes' }), false);
  assert.equal(stepSkipped({ skipIf: {} }, { fiveStar: 'yes' }), false, 'an empty rule skips nothing');
});

test('after a no to 5 stars the star question has no Skip, so under 5 always reaches the reach-out step', () => {
  const eim = loadPreview('eimmigration');
  const stars = step(eim, 'rating');
  assert.ok(eim.lowRating && eim.lowRating.gate, 'eimmigration holds back reviews under 5');
  assert.equal(stars.skipIf && stars.skipIf.fiveStar, 'yes');
  assert.ok(!stars.skip, 'a customer who would not publish 5 stars has to give a number');
  assert.equal(step(loadPreview('lean-labs'), 'rating').skip, true, 'Lean Labs keeps its Skip');
  const engine = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
  const start = engine.indexOf('function renderStars(');
  const render = engine.slice(start, engine.indexOf('\n  }\n', start));
  const guard = render.indexOf('if (step.skip) {');
  assert.notEqual(guard, -1, 'renderStars offers Skip only when the step allows it');
  assert.equal(render.split("text: 'Skip'").length - 1, 1);
  assert.ok(render.indexOf("text: 'Skip'") > guard);
});

test('every box ticked still reads like a person wrote it: two picks named at most, mostly their words', () => {
  const p = loadPreview('eimmigration');
  const options = step(p, 'services').options;
  const a = Object.assign({}, p.persona, { services: options.map((o) => o.id), servicesOther: 'court filings' });
  for (let seed = 0; seed < 20; seed += 1) {
    const drafts = D.buildDrafts(p, a, seed);
    for (const [plat, d] of Object.entries(drafts)) {
      const ours = d.segments.filter((s) => s.slot !== 'R').map((s) => s.t).join('');
      const named = options.filter((o) => ours.includes(o.phrase));
      assert.ok(named.length <= 2, `${plat} seed ${seed} names ${named.length} picks: ${d.text}`);
      assert.match(ours, /mainly for /, `${plat} seed ${seed} should say "mainly for" when picks are left out`);
      assert.ok(D.theirShare(d.segments) >= 0.6, `${plat} seed ${seed}: only ${Math.round(D.theirShare(d.segments) * 100)}% their words\n${d.text}`);
    }
    assert.ok(drafts.trustpilot.words <= D.LIMITS.trustpilot[1], `trustpilot seed ${seed}: ${drafts.trustpilot.words} words`);
  }
});

test('titles come from their own words, never a category plus a buyer', () => {
  const p = loadPreview('eimmigration');
  const drafts = D.buildDrafts(p, p.persona, 1);
  const title = drafts.trustpilot.text.split('\n')[0];
  assert.equal(title, 'No more re-typing client details');
  assert.ok(drafts.gartner.text.endsWith(title), drafts.gartner.text);
  assert.ok(!drafts.trustpilot.text.split('\n')[1].includes(title), 'the title is not repeated right under it');
  const none = Object.assign({}, p.persona, { result: '', advice: '' });
  assert.equal(D.buildDrafts(p, none, 1).trustpilot.text.split('\n')[0], 'Our experience with eimmigration');
  const rand = D.mulberry32(41);
  for (let i = 0; i < 100; i += 1) {
    const d = D.buildDrafts(p, randomAnswers(p, rand), i);
    const headline = d.gartner.text.split('\n').pop();
    [d.trustpilot.text.split('\n')[0], headline].forEach((t) => assert.doesNotMatch(t, /software for|teams$|firms$|attorneys$/i, t));
  }
});

test('our one sentence leaves out what they used before when their words already say it', () => {
  const p = loadPreview('eimmigration');
  const ours = (a) => D.buildDrafts(p, a, 2).g2.segments.filter((s) => s.slot !== 'R').map((s) => s.t).join('');
  assert.doesNotMatch(ours(p.persona), /spreadsheets/, 'the persona already says spreadsheets');
  assert.match(D.buildDrafts(p, p.persona, 2).g2.text, /spreadsheets/);
  const quiet = Object.assign({}, p.persona, { result: 'Our forms fill themselves now and nobody re-types a thing.' });
  assert.match(ours(quiet), /spreadsheets or paper files/);
  const first = Object.assign({}, p.persona, { before: 'first' });
  assert.match(ours(first), /first system/);
});

test('a typed service is kept, and a stem does not match inside another word', () => {
  const p = loadPreview('eimmigration');
  const ours = (a) => D.buildDrafts(p, a, 1).g2.segments.filter((s) => s.slot !== 'R').map((s) => s.t).join('');
  const typed = Object.assign({}, p.persona, {
    services: ['case-management', 'uscis-forms'],
    servicesOther: 'court filings',
  });
  assert.match(D.buildDrafts(p, typed, 1).g2.text, /court filings/);
  const repeated = Object.assign({}, p.persona, { servicesOther: 'case management' });
  assert.equal(D.buildDrafts(p, repeated, 1).g2.text.split('case management').length - 1, D.buildDrafts(p, p.persona, 1).g2.text.split('case management').length - 1);

  const talked = Object.assign({}, p.persona, {
    services: ['case-management', 'uscis-forms', 'billing', 'portal'],
    result: 'Billing is down to an hour and the client portal messages cut our phone calls in half.',
    advice: 'Tell your caseworkers to start with the inbox.',
    improve: 'The screens took a while to learn.',
  });
  const said = ours(talked);
  assert.match(said, /billing/);
  assert.match(said, /client portal/);
  assert.doesNotMatch(said, /case management/, said);

  const filed = Object.assign({}, p.persona, {
    services: ['billing', 'uscis-forms', 'portal'],
    result: 'We e-filed the last twenty petitions and the client portal messages are enough for us.',
    advice: 'Start with the inbox.',
    improve: 'Nothing major to change.',
  });
  const forms = ours(filed);
  assert.match(forms, /USCIS forms/);
  assert.doesNotMatch(forms, /\bbilling\b/);

  const before = Object.assign({}, p.persona, {
    before: null,
    beforeOther: 'cel',
    result: 'Excellent results on every form now.',
    advice: 'Give it a week.',
    improve: 'Nothing else.',
  });
  assert.match(D.buildDrafts(p, before, 2).g2.text, /from cel\b/);
});

test('a title keeps the rest of the sentence, and it is not repeated when it is the whole sentence', () => {
  const p = loadPreview('eimmigration');
  const clause = Object.assign({}, p.persona, {
    result: 'We switched, and filing dropped from two hours to twenty minutes. Support was great.',
    advice: 'Give the team a week to settle in.',
    improve: 'Reporting took a while to learn.',
  });
  const clauseBody = D.buildDrafts(p, clause, 1).trustpilot.text.split('\n').slice(1).join('\n');
  assert.match(clauseBody, /filing dropped from two hours to twenty minutes/);
  assert.match(clauseBody, /Support was great/);

  const one = Object.assign({}, p.persona, {
    result: 'Forms fill themselves now.',
    advice: 'Give the move a week and lean on support.',
    improve: 'Reporting took a while to learn.',
  });
  const oneParts = D.buildDrafts(p, one, 1).trustpilot.text.split('\n');
  assert.equal(oneParts[0], 'Forms fill themselves now');
  assert.ok(!oneParts.slice(1).join('\n').includes('Forms fill themselves now'), oneParts.join('\n'));

  const fromAdvice = Object.assign({}, p.persona, {
    result: 'Our caseworkers enter a client once and every related form fills itself without anyone retyping the old data.',
    advice: 'Give the move a week.',
    improve: 'Reporting took a while to learn.',
  });
  const adviceDraft = D.buildDrafts(p, fromAdvice, 1).trustpilot.text;
  assert.equal(adviceDraft.split('\n')[0], 'Give the move a week');
  assert.ok(!adviceDraft.split('\n').slice(1).join('\n').includes('Give the move a week'), adviceDraft);
  assert.match(adviceDraft, /caseworkers enter a client once/);
});

test('the facts sentence is not repeated to fill an empty field', () => {
  const p = loadPreview('eimmigration');
  const a = Object.assign({}, p.persona, { advice: '' });
  const g2 = D.buildDrafts(p, a, 2).g2.text;
  const marker = 'nonprofit immigration legal services team';
  assert.equal(g2.split(marker).length - 1, 1, g2);
});

test('a skipped answer never leaves a field that only says the company name', () => {
  const p = loadPreview('eimmigration');
  const parse = loadParseG2Fields();
  const check = (a, where) => {
    const drafts = D.buildDrafts(p, a, 3);
    ['g2', 'gartner'].forEach((plat) => parse(drafts[plat].text).forEach((f) => {
      assert.notEqual(f.body, `${p.company}.`, `${where} ${plat} "${f.label}"`);
    }));
  };
  check(Object.assign({}, p.persona, { advice: '' }), 'no advice');
  check(Object.assign({}, p.persona, { result: '' }), 'no result');
  check(Object.assign({}, p.persona, { result: '', advice: '', improve: '' }), 'nothing typed');
  const rand = D.mulberry32(29);
  for (let i = 0; i < 300; i += 1) check(randomAnswers(p, rand), `random ${i}`);
});

test('in G2 and Gartner every field has a sentence and no sentence is said twice', () => {
  const p = loadPreview('eimmigration');
  const parse = loadParseG2Fields();
  const norm = (s) => s.toLowerCase().replace(/[.!?]+$/, '').trim();
  const one = 'We stopped typing the same client details into every form, which saves our caseworkers hours a week.';
  const cases = {
    sample: {},
    'no advice': { advice: '' },
    'no result': { result: '' },
    'nothing typed': { result: '', advice: '', improve: '' },
    'two short sentences, no advice': { result: 'Saves us time. Forms that took an hour now take ten minutes.', advice: '' },
    'one sentence': { result: one },
    'one sentence, no advice': { result: one, advice: '' },
    'one sentence that is the title': { result: 'It saves our team hours on every single case.' },
    'one long sentence is not the headline': { result: one, advice: '' },
    'skip before, nothing typed': { before: null, result: '', advice: '', improve: '' },
    'skip org, nothing typed': { orgType: null, result: '', advice: '', improve: '' },
    'first system, nothing typed': { before: 'first', result: '', advice: '', improve: '' },
    'one service, skip before, nothing typed': { before: null, services: ['case-management'], result: '', advice: '', improve: '' },
    'rating skipped': { rating: null },
    'rating skipped, one sentence': { rating: null, result: 'It saves our team hours on every single case.' },
  };
  Object.entries(cases).forEach(([name, change]) => {
    const drafts = D.buildDrafts(p, Object.assign({}, p.persona, change), 4);
    ['g2', 'gartner'].forEach((plat) => {
      const seen = new Set();
      parse(drafts[plat].text).forEach((f) => {
        assert.ok(f.body.length, `${name} ${plat} "${f.label}" is empty`);
        f.body.split(/(?<=[.!?])\s+/).map(norm).forEach((s) => {
          assert.ok(!seen.has(s), `${name} ${plat} says "${s}" twice:\n${drafts[plat].text}`);
          seen.add(s);
        });
      });
      if (name === 'one long sentence is not the headline') {
        const g = parse(drafts.gartner.text);
        assert.equal(g[3].body, 'Our experience with eimmigration');
        assert.match(g[1].body, /We stopped typing the same client details/);
        assert.doesNotMatch(g[0].body, /We stopped typing/);
      }
      if (name === 'rating skipped' || name === 'rating skipped, one sentence') {
        const g = parse(drafts.gartner.text);
        const headline = g[3].body.toLowerCase().replace(/[.!?]+$/, '').trim();
        g.slice(0, 3).forEach((f) => {
          f.body.split(/(?<=[.!?])\s+/).forEach((s) => {
            assert.notEqual(norm(s), headline, `${name} repeats the headline:\n${drafts.gartner.text}`);
          });
        });
      }
    });
  });
});

test('G2 keeps an advice line that Gartner uses as the headline', () => {
  const p = loadPreview('eimmigration');
  const a = Object.assign({}, p.persona, {
    result: 'Our caseworkers enter a client once and every related form fills itself without anyone retyping the old data.',
    advice: 'Give the move a week.',
  });
  const drafts = D.buildDrafts(p, a, 4);
  assert.match(drafts.g2.text, /Give the move a week/);
  assert.equal(drafts.gartner.text.split('\n').pop(), 'Give the move a week');
  assert.ok(!drafts.gartner.text.slice(0, drafts.gartner.text.lastIndexOf('\n')).includes('Give the move a week'));
});

test('one tapped fact is not pasted into every empty G2 field', () => {
  const p = loadPreview('eimmigration');
  const parse = loadParseG2Fields();
  const a = Object.assign({}, p.persona, {
    orgType: null,
    before: null,
    services: ['billing'],
    result: '',
    advice: '',
    improve: '',
  });
  const fields = parse(D.buildDrafts(p, a, 4).g2.text);
  const fact = 'We use eimmigration for billing.';
  const copies = fields.filter((f) => f.body === fact).length;
  assert.ok(copies >= 1 && copies <= 2, fields.map((f) => f.body).join('\n'));
  assert.ok(fields.some((f) => f.body === 'Our experience with eimmigration.'));
  fields.forEach((f) => assert.notEqual(f.body, `${p.company}.`));
});

test('V3 sentences in our words never praise, recommend or rate', () => {
  const p = loadPreview('eimmigration');
  Object.entries(p.templates).forEach(([kind, list]) => list.forEach((tpl) => {
    assert.doesNotMatch(tpl, /recommend|great|love|amazing|easy|5-star|stars?\b/i, `${kind}: ${tpl}`);
  }));
});

test('eimmigration preview welcome matches the live portal welcome', () => {
  // Copy from the welcome screen up to the step bar, tags stripped.
  const welcome = (file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const start = html.indexOf('<div id="screen-welcome"');
    const end = html.indexOf('<div class="progress-shell', start);
    assert.ok(start >= 0 && end > start, `${file}: welcome screen or step bar missing`);
    return html.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  assert.equal(welcome('pages/previews/v2/eimmigration/index.html'), welcome('pages/clients/eimmigration/index.html'));
  assert.equal(loadPreview('eimmigration').progressBelowWelcome, true);
});

function extractPreviewFunctions(names) {
  const src = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
  const parts = names.map((name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing ${name}`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    assert.fail(`unclosed ${name}`);
  });
  const sandbox = {};
  vm.runInNewContext(parts.join('\n'), sandbox);
  return sandbox;
}

test('under 5 stars stays off the review step, and 5 stars still reach the drafts', () => {
  const { lowRatingBelow, ratingIsGated, previewProgress } = extractPreviewFunctions([
    'lowRatingBelow', 'ratingIsGated', 'previewProgress',
  ]);
  const rule = { below: 5, gate: true };
  assert.equal(lowRatingBelow(rule), 5);
  assert.equal(lowRatingBelow(undefined), 5);
  assert.equal(lowRatingBelow({ below: 4 }), 4);
  assert.equal(lowRatingBelow({ below: 0 }), 0);
  [1, 2, 3, 4].forEach((n) => assert.equal(ratingIsGated(n, rule), true, `${n} stars`));
  assert.equal(ratingIsGated(5, rule), false);
  assert.equal(ratingIsGated(null, rule), false, 'skip is not a low rating');
  assert.equal(ratingIsGated(4, { below: 5 }), false, 'the offer alone does not hide the drafts');
  assert.equal(ratingIsGated(4, undefined), false);
  const steps = { welcome: 1, chat: 2, draft: 3, compare: 4 };
  const pair = (name, n) => {
    const mark = previewProgress(name, n, steps);
    return [mark.done, mark.active];
  };
  assert.deepEqual([1, 2, 3, 4].map((n) => pair('negative', n)), [
    [true, false],
    [true, false],
    [false, false],
    [false, false],
  ]);
  assert.deepEqual(pair('draft', 3), [false, true]);
  assert.deepEqual(pair('welcome', 1), [false, true]);
  assert.equal(loadPreview('lean-labs').lowRating, undefined);
  const engine = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
  assert.match(engine, /empathy\.textContent = saved/);
  assert.doesNotMatch(engine, /empathy\.innerHTML/);
  const finish = engine.slice(engine.indexOf('async function finishChat'), engine.indexOf('function renderDraftStars'));
  const gate = finish.indexOf("if (isGated() && $('#screen-negative'))");
  const link = finish.indexOf('chat-draft-inline__link');
  assert.ok(gate !== -1 && link > gate, 'a gated visit returns before the review link is offered');
  assert.ok(finish.indexOf('return;', gate) < link);
  const draft = fs.readFileSync(path.join(V2, 'eimmigration/index.html'), 'utf8');
  assert.match(draft, /Here are your reviews, ready to publish\./);
  assert.match(draft, /id="btn-saved-drafts"/);
});

test('Lean Labs stays on the V2 interview', () => {
  const p = loadPreview('lean-labs');
  assert.equal(p.versionLabel, undefined);
  assert.equal(p.draftStyle, undefined);
  assert.notEqual(p.draftStyle, 'their-words');
  const html = fs.readFileSync(path.join(V2, 'lean-labs/index.html'), 'utf8');
  assert.match(html, /V2 preview \| Lean Labs/);
  assert.match(html, /Jump to V1 vs V2/);
  assert.doesNotMatch(html, /V3/);
  const engine = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
  assert.match(engine, /const VERSION = P\.versionLabel \|\| 'V2'/);
});

test('a short answer and its follow-up stay two sentences', () => {
  const { joinFollowUp } = extractPreviewFunctions(['joinFollowUp']);
  assert.equal(joinFollowUp('Forms are faster now', 'We file in 20 minutes.'), 'Forms are faster now. We file in 20 minutes.');
  assert.equal(joinFollowUp('Forms are faster now.', 'We file in 20 minutes.'), 'Forms are faster now. We file in 20 minutes.');
  assert.equal(joinFollowUp('Forms are faster now,', 'We file in 20 minutes.'), 'Forms are faster now. We file in 20 minutes.');
  assert.equal(joinFollowUp('Wow!', ''), 'Wow!');
  assert.equal(joinFollowUp('', 'We file in 20 minutes.'), 'We file in 20 minutes.');
});

test('eimmigration preview under-5 end screen uses the live portal copy', () => {
  // Heading and message of the "Thank you for your honesty" screen, tags stripped.
  const ending = (file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const start = html.indexOf('<div id="screen-negative"');
    const end = html.indexOf('<div id="empathy-card"', start);
    assert.ok(start >= 0 && end > start, `${file}: under-5 screen missing`);
    return html.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  assert.equal(ending('pages/previews/v2/eimmigration/index.html'), ending('pages/clients/eimmigration/index.html'));
});

test('preview noindex header stays on the preview path and the stage host', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const robots = (vercel.headers || []).filter((rule) => (rule.headers || []).some((h) => h.key === 'X-Robots-Tag'));
  assert.ok(robots.length >= 1);
  robots.forEach((rule) => {
    assert.ok(String(rule.source).startsWith('/pages/previews/v2'), `noindex source is too broad: ${rule.source}`);
    const host = (rule.has || []).find((h) => h.type === 'host');
    assert.equal(host && host.value, 'stage.reputationrocket.ai');
  });
});

test('every marked phrase traces back to a pick', () => {
  eachRandomDraft(200, 31, (slug, p, a, drafts) => {
    for (const [plat, d] of Object.entries(drafts)) {
      d.segments.filter((s) => s.slot && s.slot !== 'R').forEach((s) => {
        assert.ok(s.src, `${slug}/${plat}: "${s.t}" has no source`);
        const ans = a[s.src.step];
        const ids = Array.isArray(ans) ? ans : [ans];
        assert.ok(ids.includes(s.src.option), `${slug}/${plat}: "${s.t}" traces to ${s.src.step}/${s.src.option}, which was not picked`);
      });
    }
  });
});

test('own words are cleaned up before they reach a draft', () => {
  assert.equal(D.ownPhrase('A lifesaver.'), 'a lifesaver');
  assert.equal(D.ownPhrase('Case management!'), 'case management');
  assert.equal(D.ownPhrase('Clio..'), 'Clio');
  assert.equal(D.ownPhrase('AEO help'), 'AEO help');
  assert.equal(D.ownPhrase('I think so'), 'I think so');
  assert.equal(D.ownPhrase('[FIELD: fake] {x}'), 'FIELD: fake x');
  assert.equal(D.ownPhrase('one two three four five six seven eight nine ten eleven twelve thirteen'), 'one two three four five six seven eight nine ten eleven twelve');
  assert.equal(D.tidy('Great!!. Really ,fast'), 'Great! Really,fast');
  assert.match(D.segmentsToHtml([{ t: '<img src=x onerror=alert(1)>"', slot: 'X' }]), /&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  assert.doesNotMatch(D.segmentsToHtml([{ t: '<img src=x onerror=alert(1)>', slot: 'X' }]), /<img/);
});

test('interview, not script: every choice can be skipped or answered in own words', () => {
  const superlative = /\b(best|#1|leading|top-rated|number one|world-class)\b/i;
  for (const slug of BRANDS) {
    const p = loadPreview(slug);
    p.steps.filter((s) => s.type === 'single' || s.type === 'multi').forEach((s) => {
      assert.ok(s.skip || s.ownWords, `${slug}/${s.id} needs Skip or own words`);
    });
    p.steps.filter((s) => s.type === 'stars' || s.type === 'grid').forEach((s) => {
      // The one exception: after a no or a skip on "publish as a 5-star
      // rating", the star question needs a number. A yes still records 5,
      // so the drafts are never offered with a blank rating.
      if (s.type === 'stars' && p.lowRating && p.lowRating.gate && s.skipIf) {
        assert.equal(s.skipIf.fiveStar, 'yes', `${slug}/${s.id} may drop Skip only when a yes already means 5 stars`);
        assert.equal(s.skipValue, 5, `${slug}/${s.id} yes-path must record 5 stars`);
        assert.ok(!s.skip, `${slug}/${s.id} must not offer Skip once the under-5 gate needs a number`);
        return;
      }
      assert.equal(s.skip, true, `${slug}/${s.id} must be skippable`);
    });
    p.steps.filter((s) => s.type === 'text').forEach((s) => assert.ok(!s.required, `${slug}/${s.id} must be skippable`));
    Object.entries(p.templates).forEach(([kind, list]) => {
      list.forEach((tpl) => assert.doesNotMatch(tpl, superlative, `${slug} template ${kind}: ${tpl}`));
    });
  }
});

test('V2 preview copy has no client or staff names, emails, or phone numbers', () => {
  const banned = /\b(Krista|Tony|Kevin|Barber|Jonathan|Edward)\b/i;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phone = /\b(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
  const roots = [V2, path.join(ROOT, 'docs/v2-preview')];
  const files = [];
  roots.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else files.push(f);
      });
    })(dir);
  });
  assert.ok(files.length > 0, 'expected preview files to scan');
  files.forEach((f) => {
    const rel = path.relative(ROOT, f);
    assert.doesNotMatch(path.basename(f), banned, `${rel} filename`);
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(f)) return;
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, banned, rel);
    assert.doesNotMatch(text, email, rel);
    assert.doesNotMatch(text, phone, rel);
  });
});

test('previews stay offline, unlisted and free of em dashes', () => {
  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else files.push(f);
    });
  })(V2);
  const banned = /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|\/api\/|hs-scripts|\/app\.js|config\.js|localStorage|sessionStorage/;
  files.filter((f) => /\.(js|html|css)$/.test(f)).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, banned, `${path.relative(ROOT, f)} reaches outside the preview`);
    assert.doesNotMatch(src, /[–—]/, `${path.relative(ROOT, f)} has an em or en dash`);
  });
  const pages = files.filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 3, 'hub plus two brand pages expected');
  pages.forEach((f) => {
    assert.match(fs.readFileSync(f, 'utf8'), /<meta name="robots" content="noindex, nofollow">/, `${path.relative(ROOT, f)} must be noindex`);
  });
});
