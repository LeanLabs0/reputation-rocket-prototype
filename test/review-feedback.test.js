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

test('Lean Labs uses the shared star-rating and 4-star chat switches', () => {
  const configSrc = fs.readFileSync(
    path.join(__dirname, '../pages/clients/lean-labs/config.js'),
    'utf8',
  );
  const sandbox = { window: {} };
  vm.runInNewContext(configSrc, sandbox, { timeout: 1000 });
  const config = sandbox.window.CLIENT_CONFIG;
  assert.equal(config.clientSlug, 'lean-labs');
  assert.equal(config.ratingButtons, true);
  assert.equal(config.murkyMiddle, true);
  assert.equal(config.providerName, 'Lean Labs');
});

test('questionPart drops the leading acknowledgment and keeps the question', () => {
  assert.equal(
    questionPart("That's wonderful to hear! What's the best part of working with us?"),
    "What's the best part of working with us?",
  );
  assert.equal(questionPart('No question here.'), 'No question here.');
});
