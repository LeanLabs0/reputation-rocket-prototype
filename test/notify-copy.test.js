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
