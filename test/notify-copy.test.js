const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSlackMessage, buildCompletedEmailSubjectAndText } = require('../api/notify');

test('completed Slack header and fields do not imply the review is live', () => {
  const message = buildSlackMessage({
    event: 'completed',
    client: 'Acme',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    provider: 'Lean Labs',
    posted: ['g2', 'trustpilot'],
    rating: 5,
  });

  assert.equal(message.blocks[0].text.text, 'Session completed');
  assert.match(message.text, /session completed/i);

  const fieldTexts = message.blocks
    .flatMap((block) => (block.fields || []).map((field) => field.text))
    .join('\n');
  assert.match(fieldTexts, /\*Marked submitted:\*\ng2, trustpilot/);
  assert.doesNotMatch(fieldTexts, /live/i);
  assert.doesNotMatch(fieldTexts, /\*Marked posted:/);
  assert.doesNotMatch(message.blocks[0].text.text, /posted|live/i);
});

test('completed Slack empty platforms uses marked submitted', () => {
  const message = buildSlackMessage({ event: 'completed' });
  const fieldTexts = message.blocks
    .flatMap((block) => (block.fields || []).map((field) => field.text))
    .join('\n');
  assert.match(fieldTexts, /None marked submitted/);
});

test('completed email copy matches session completed / marked submitted', () => {
  const email = buildCompletedEmailSubjectAndText({
    event: 'completed',
    client: 'Acme',
    posted: ['gartner'],
    received_at: '2026-09-02T13:00:00.000Z',
  });
  assert.match(email.subject, /Session completed/);
  assert.match(email.text, /session completed/i);
  assert.match(email.text, /Marked submitted: gartner/);
  assert.doesNotMatch(email.subject, /live/i);
  assert.doesNotMatch(email.text, /Marked posted:/);
});

// 4-star choice ("murky middle") context lines.
const { buildNegativeEmailSubjectAndText } = require('../api/notify');

function allBlockText(message) {
  return message.blocks
    .map((block) => [
      block.text && block.text.text,
      ...(block.fields || []).map((field) => field.text),
    ].filter(Boolean).join('\n'))
    .join('\n');
}

test('completed alert shows the 4-star choice note and support feedback', () => {
  const payload = {
    event: 'completed',
    client: 'Acme',
    rating: 5,
    rating_note: 'Rated 4, chose 5 after the 4-star prompt',
    support_feedback: 'Onboarding docs could be clearer.',
  };
  const text = allBlockText(buildSlackMessage(payload));
  assert.match(text, /\*Rating note:\*\nRated 4, chose 5 after the 4-star prompt/);
  assert.match(text, /\*Feedback for support:\*\nOnboarding docs could be clearer\./);

  const email = buildCompletedEmailSubjectAndText(payload);
  assert.match(email.text, /Rating note: Rated 4, chose 5 after the 4-star prompt/);
  assert.match(email.text, /Feedback for support: Onboarding docs could be clearer\./);
});

test('negative alert shows the 4-star choice note', () => {
  const payload = {
    event: 'negative',
    client: 'Acme',
    rating_note: 'Rated 4, chose 3 after the 4-star prompt',
    negative_flag: { rating: 3, severity: 'low' },
  };
  assert.match(allBlockText(buildSlackMessage(payload)), /\*Rating note:\*\nRated 4, chose 3 after the 4-star prompt/);
  assert.match(buildNegativeEmailSubjectAndText(payload).text, /Rating note: Rated 4, chose 3 after the 4-star prompt/);
});

test('alerts without the 4-star prompt are unchanged', () => {
  const completed = allBlockText(buildSlackMessage({ event: 'completed', client: 'Acme', rating: 5 }));
  const negative = allBlockText(buildSlackMessage({ event: 'negative', client: 'Acme', negative_flag: { rating: 2 } }));
  for (const text of [completed, negative]) {
    assert.doesNotMatch(text, /Rating note|Feedback for support/);
  }
  const email = buildCompletedEmailSubjectAndText({ event: 'completed', client: 'Acme' });
  assert.doesNotMatch(email.text, /Rating note|Feedback for support/);
});
