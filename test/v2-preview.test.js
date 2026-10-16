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
    const ids = (s.options || []).map((o) => o.id);
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
  const row = () => {
    const r = {};
    grid.dims.forEach((d) => { if (rand() >= 0.2) r[d] = 1 + Math.floor(rand() * 5); });
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
    services.filter((o) => p.persona.services.includes(o.id)).forEach((o) => {
      assert.ok(all.includes(o.phrase.toLowerCase()), `${slug}: picked "${o.phrase}" missing`);
    });
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
    assert.ok(seen.size >= 20, `${slug}/${plat}: only ${seen.size} different drafts in 50 seeds`);
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
    const where = `${slug} ${JSON.stringify(a)}\n${all}`;
    const scores = gridScores(a);
    assert.doesNotMatch(all, madeUp, where);
    if (a.recommend !== 'yes') assert.doesNotMatch(all, /(^|[.!?]\s+|\n)I'd recommend/, where);
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
