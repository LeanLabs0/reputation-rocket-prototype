const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

function extractConst(name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = src.indexOf(';', start);
  // vm sandbox only sees `this.*` / function declarations, not `const`.
  return src.slice(start, end + 1).replace(/^const /, 'this.');
}

const sandbox = {};
vm.runInNewContext(
  [
    extractConst('MURKY_CHOICE_LABELS'),
    extractConst('MURKY_IMPROVE_QUESTION'),
    extractConst('MURKY_REVIEW_INTRO'),
    extractFunction('isImprovementQuestion'),
    extractFunction('isRatingOrChoiceAnswer'),
    extractFunction('questionPart'),
  ].join('\n'),
  sandbox,
);

const {
  isImprovementQuestion,
  isRatingOrChoiceAnswer,
  questionPart,
  MURKY_CHOICE_LABELS,
  MURKY_IMPROVE_QUESTION,
} = sandbox;

test('closing improvements phrases match, early survey questions do not', () => {
  assert.equal(
    isImprovementQuestion('Is there any area where we could remove friction or improve the experience? Put "no" if nothing.'),
    true,
  );
  assert.equal(isImprovementQuestion(MURKY_IMPROVE_QUESTION), true);
  assert.equal(isImprovementQuestion('Where could we improve from here?'), true);
  assert.equal(isImprovementQuestion("That's wonderful to hear! What's the best part of working with us?"), false);
  assert.equal(isImprovementQuestion('How did we deliver on your expectations?'), false);
  assert.equal(isImprovementQuestion('Why did you choose eimmigration?'), false);
});

test('rating and 4-star choice labels are recognized so the first review question is not intercepted', () => {
  assert.equal(isRatingOrChoiceAnswer('5 stars'), true);
  assert.equal(isRatingOrChoiceAnswer('1 star'), true);
  assert.equal(isRatingOrChoiceAnswer(MURKY_CHOICE_LABELS[5]), true);
  assert.equal(isRatingOrChoiceAnswer(MURKY_CHOICE_LABELS[3]), true);
  assert.equal(isRatingOrChoiceAnswer('The onboarding was smooth'), false);
});

function loadClientConfig(relativePath) {
  const configSrc = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(configSrc, sandbox, { timeout: 1000 });
  return sandbox.window.CLIENT_CONFIG;
}

test('Lean Labs uses the shared star-rating and 4-star chat switches', () => {
  const config = loadClientConfig('../pages/clients/lean-labs/config.js');
  assert.equal(config.clientSlug, 'lean-labs');
  assert.equal(config.ratingButtons, true);
  assert.equal(config.murkyMiddle, true);
  assert.equal(config.providerName, 'Lean Labs');
});

test('Lean Labs demo uses the same star switches and stays off live notification targets', () => {
  const config = loadClientConfig('../pages/clients/lean-labs/demo/config.js');
  assert.equal(config.clientSlug, 'demo');
  assert.equal(config.providerName, 'Acme Co');
  assert.equal(config.ratingButtons, true);
  assert.equal(config.murkyMiddle, true);
  assert.equal(config.hubspotFormId, undefined);
  assert.equal(config.hubspotPortalId, undefined);
  assert.equal(config.notifyEmails, undefined);
  assert.equal(config.slackChannel, undefined);
  assert.equal(config.supportEmail, 'hello@acme.example');
  for (const link of Object.values(config.reviewLinks)) {
    assert.match(String(link), /^review-sandbox\.html/);
  }
});

test('Lean Labs demo tour follows the star buttons and leaves voice transcription live', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../pages/clients/lean-labs/demo/demo.js'),
    'utf8',
  );
  assert.match(src, /tap a star from 1 to 5/i);
  assert.match(src, /microphone/i);
  assert.match(src, /function pickChatTourTarget\(/);
  assert.match(src, /\/api\/notify/);
  assert.match(src, /\/api\/upload-video/);
  assert.match(src, /\/api\/transcribe is also left alone/);
  assert.doesNotMatch(src, /indexOf\('\/api\/transcribe'\)/);

  const start = src.indexOf('function pickChatTourTarget(');
  const end = src.indexOf('function resolveStepTarget(');
  const picker = src.slice(start, end);
  const choice = { id: 'choice', hidden: false };
  const input = { id: 'input', hidden: true };
  const container = { id: 'container' };
  const document = {
    getElementById(id) {
      return id === 'chat-choice-bar' ? choice : null;
    },
    querySelector(sel) {
      if (sel === '#screen-chat .chat-input-bar') return input;
      if (sel === '#screen-chat .chat-container') return container;
      return null;
    },
  };
  const sandbox = { document };
  vm.runInNewContext(`${picker}\nthis.pickChatTourTarget = pickChatTourTarget;`, sandbox);
  assert.equal(sandbox.pickChatTourTarget(), choice);
  input.hidden = false;
  assert.equal(sandbox.pickChatTourTarget(), container);
  choice.hidden = true;
  assert.equal(sandbox.pickChatTourTarget(), input);
});

test('questionPart drops the leading acknowledgment and keeps the question', () => {
  assert.equal(
    questionPart("That's wonderful to hear! What's the best part of working with us?"),
    "What's the best part of working with us?",
  );
  assert.equal(questionPart('No question here.'), 'No question here.');
});
