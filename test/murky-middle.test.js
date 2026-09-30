const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MURKY_FEEDBACK_PROMPT,
  MURKY_FEEDBACK_THANKS,
  looksLikeFrictionQuestion,
  onFourStarChoice,
  onAgentMessage,
  onImprovementAnswer,
  murkyNotifyFields,
  applyImprovementToDrafts,
  normalizeMurkyMiddle,
  FRICTION_SKIP_REPLY,
} = require('../lib/murky-middle');

function session(overrides) {
  return {
    chose: null,
    feedback: '',
    feedbackAsked: false,
    phase: 'choosing',
    ...overrides,
  };
}

test('4 then 5 sends 5 to the assistant and starts review questions, not the support ask', () => {
  const result = onFourStarChoice(session(), 5);
  assert.equal(result.sendToAssistant, '5');
  assert.equal(result.phase, 'review');
  assert.equal(result.chose, 5);
  assert.equal(result.showSupportAsk, false);
  assert.equal(result.prompt, undefined);
});

test('4 then 3 sends 3 to the assistant and goes to the support path', () => {
  const result = onFourStarChoice(session(), 3);
  assert.equal(result.sendToAssistant, '3');
  assert.equal(result.phase, 'support');
  assert.equal(result.chose, 3);
  assert.equal(result.showSupportAsk, false);
});

test('during 5-star review questions, a normal agent question continues the review', () => {
  const result = onAgentMessage(
    session({ chose: 5, phase: 'review' }),
    { text: "That's wonderful to hear! What was your primary goal when you started working with eimmigration?", hasDrafts: false },
  );
  assert.equal(result.phase, 'review');
  assert.equal(result.showSupportAsk, false);
  assert.equal(result.showDrafts, false);
  assert.equal(result.skipFriction, false);
  assert.equal(result.sendToAssistant, undefined);
});

test('the friction / improve-the-experience question is skipped on the 4-then-5 path', () => {
  const text = 'Perfect endorsement! Is there any area where we could remove friction or improve the experience? (Put "no" if nothing else comes to mind)';
  assert.equal(looksLikeFrictionQuestion(text), true);

  const result = onAgentMessage(
    session({ chose: 5, phase: 'review' }),
    { text, hasDrafts: false },
  );
  assert.equal(result.skipFriction, true);
  assert.equal(result.hideAgentMessage, true);
  assert.equal(result.sendToAssistant, FRICTION_SKIP_REPLY);
  assert.equal(result.showSupportAsk, false);
  assert.equal(result.phase, 'review');
});

test('after review drafts are ready on the 4-then-5 path, ask Tonya\'s improvement question before showing drafts', () => {
  const result = onAgentMessage(
    session({ chose: 5, phase: 'review', feedbackAsked: false }),
    { text: "I've put together a draft review for each platform.", hasDrafts: true },
  );
  assert.equal(result.phase, 'improve');
  assert.equal(result.showSupportAsk, true);
  assert.equal(result.showDrafts, false);
  assert.equal(result.prompt, MURKY_FEEDBACK_PROMPT);
  assert.match(MURKY_FEEDBACK_PROMPT, /Thank you! Before you go, is there anything we could improve or do better\? We'll share your feedback with our support team\./);
});

test('direct 5-star (never tapped 4) still shows drafts and does not inject the support ask', () => {
  const result = onAgentMessage(
    session({ chose: null, phase: 'idle' }),
    { text: "I've put together a draft review for each platform.", hasDrafts: true },
  );
  assert.equal(result.showDrafts, true);
  assert.equal(result.showSupportAsk, false);
  assert.equal(result.skipFriction, false);
});

test('improvement answer is never sent to the assistant and is passed to the 3-star support notify path', () => {
  const result = onImprovementAnswer(
    session({ chose: 5, phase: 'improve' }),
    'Response time has been a little bit slow for support.',
  );
  assert.equal(result.sendToAssistant, undefined);
  assert.equal(result.feedback, 'Response time has been a little bit slow for support.');
  assert.equal(result.feedbackAsked, true);
  assert.equal(result.notifyEvent, 'negative');
  assert.equal(result.showDrafts, true);
  assert.equal(result.thanks, MURKY_FEEDBACK_THANKS);
  assert.doesNotMatch(result.thanks, /quick questions for your review/i);
});

test('empty / nothing-to-add improvement answer does not fire a support alert', () => {
  const result = onImprovementAnswer(
    session({ chose: 5, phase: 'improve' }),
    'Nothing to add',
  );
  assert.equal(result.feedback, '');
  assert.equal(result.notifyEvent, null);
  assert.equal(result.showDrafts, true);
  assert.equal(result.thanks, null);
});

test('murky notify fields put 4-then-5 improvement notes on the same support payload as a 3-star alert', () => {
  const fields = murkyNotifyFields({
    chose: 5,
    feedback: 'Onboarding docs could be clearer.',
    feedbackAsked: true,
  });
  assert.equal(fields.rating_note, 'Rated 4, chose 5 after the 4-star prompt');
  assert.equal(fields.support_feedback, 'Onboarding docs could be clearer.');
});

test('4-then-3 notify fields still carry the rating note and no 5-star support note', () => {
  const fields = murkyNotifyFields({ chose: 3, feedback: '', feedbackAsked: false });
  assert.equal(fields.rating_note, 'Rated 4, chose 3 after the 4-star prompt');
  assert.equal(fields.support_feedback, undefined);
});

test('improvement notes fill platform dislike/improve fields and stay out of narrative drafts', () => {
  const drafts = {
    g2: '[FIELD: What do you like best about eimmigration?]\nThe team is responsive.\n\n[FIELD: What do you dislike about eimmigration?]\nNo.\n\n[FIELD: Recommendations to others considering eimmigration:]\nHire them.',
    trustpilot: 'eImmigration made our immigration work much easier. Highly recommend.',
  };
  const next = applyImprovementToDrafts(drafts, 'Response time has been a little bit slow for support.');
  assert.match(next.g2, /What do you dislike about eimmigration\?\]\nResponse time has been a little bit slow for support\./);
  assert.equal(next.trustpilot, drafts.trustpilot);
  assert.doesNotMatch(next.trustpilot, /Response time has been a little bit slow/);
});

test('old PR #13 prompt is not used', () => {
  assert.doesNotMatch(MURKY_FEEDBACK_PROMPT, /we'll draft your 5-star review next/i);
  assert.doesNotMatch(MURKY_FEEDBACK_PROMPT, /This stays private and won't be part of your review/i);
});

test('old sessions that already captured a support note are not asked again', () => {
  const restored = normalizeMurkyMiddle({
    chose: 5,
    feedback: 'Onboarding docs could be clearer.',
  });
  assert.equal(restored.feedbackAsked, true);
  assert.equal(restored.feedback, 'Onboarding docs could be clearer.');
});

test('app.js wires the shared module and dropped the old pre-review prompt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(src, /MurkyMiddle\.onFourStarChoice/);
  assert.match(src, /MurkyMiddle\.onAgentMessage/);
  assert.match(src, /sendPostReviewSupportAlert/);
  assert.match(src, /sendLifecycleNotification\('negative'\)/);
  assert.doesNotMatch(src, /we'll draft your 5-star review next/i);
  assert.doesNotMatch(src, /remove friction or improve the experience/);
});

test('eImmigration demo loads the murky-middle module before app.js', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages/clients/eimmigration/demo/index.html'),
    'utf8',
  );
  const libIdx = html.indexOf('/lib/murky-middle.js');
  const appIdx = html.indexOf('/app.js');
  assert.ok(libIdx > 0);
  assert.ok(appIdx > libIdx);
});
