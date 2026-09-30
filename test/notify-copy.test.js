const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSlackMessage,
  buildCompletedEmailSubjectAndText,
  buildNegativeEmailSubjectAndText,
} = require('../api/notify');

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

test('Slack 4-star fields escape markup so customer text cannot mention the channel', () => {
  const payload = {
    event: 'completed',
    client: 'Acme',
    rating: 5,
    rating_note: 'Rated 4, chose 5 after the 4-star prompt',
    support_feedback: 'See <!channel> and <https://evil.example>',
  };
  const slack = allBlockText(buildSlackMessage(payload));
  assert.match(slack, /See &lt;!channel&gt; and &lt;https:\/\/evil\.example&gt;/);
  assert.doesNotMatch(slack, /See <!channel>/);

  const email = buildCompletedEmailSubjectAndText(payload);
  assert.match(email.text, /See <!channel> and <https:\/\/evil\.example>/);
});

test('Slack 4-star support feedback is clipped before the Slack section limit', () => {
  const payload = {
    event: 'completed',
    client: 'Acme',
    support_feedback: `${'x'.repeat(2600)}TAIL`,
  };
  const slack = allBlockText(buildSlackMessage(payload));
  assert.match(slack, /Feedback for support:/);
  assert.doesNotMatch(slack, /TAIL/);
  assert.match(slack, /…/);
});


// Feedback for support: 4 -> 5 customers' improvement answer, sent right away.
const notifyModule = require('../api/notify');

test('support feedback is an allowed event routed to the support (negative) thread', () => {
  assert.equal(notifyModule.ALLOWED_EVENTS.has('support_feedback'), true);
  assert.equal(notifyModule.slackThreadKindForEvent('support_feedback'), 'negative');
  assert.equal(notifyModule.slackThreadKindForEvent('negative'), 'negative');
  assert.equal(notifyModule.slackThreadKindForEvent('completed'), 'positive');
});

test('support feedback Slack alert shows the feedback, the rating note and the context', () => {
  const message = notifyModule.buildSlackMessage({
    event: 'support_feedback',
    client: 'Acme',
    provider: 'eImmigration',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    rating: 5,
    rating_note: 'Rated 4, chose 5 after the 4-star prompt',
    support_feedback: 'Response time has been a little slow for support <!channel>',
    transcript: [],
  });
  assert.equal(message.blocks[0].text.text, 'Feedback for support, Acme');
  assert.match(message.text, /Feedback for support/);
  const all = message.blocks
    .map((b) => [b.text && b.text.text, ...(b.fields || []).map((f) => f.text)].filter(Boolean).join('\n'))
    .join('\n');
  assert.match(all, /\*Rating note:\*\nRated 4, chose 5 after the 4-star prompt/);
  assert.match(all, /\*Feedback for support:\*\nResponse time has been a little slow for support/);
  assert.match(all, /first rated 4 stars, then chose to leave a 5-star review/);
  assert.doesNotMatch(all, /<!channel>/);
  assert.doesNotMatch(message.blocks[0].text.text, /—/);
});

test('support feedback Slack still builds when the customer left no extra transcript', () => {
  const message = notifyModule.buildSlackMessage({
    event: 'support_feedback',
    client: 'Acme',
    rating_note: 'Rated 4, chose 5 after the 4-star prompt',
  });
  assert.equal(message.blocks[0].text.text, 'Feedback for support, Acme');
  assert.doesNotMatch(JSON.stringify(message), /Session completed|Marked submitted/);
});

test('support feedback email carries the feedback and never the completed copy', () => {
  const email = notifyModule.buildSupportFeedbackEmailSubjectAndText({
    event: 'support_feedback',
    client: 'Acme',
    received_at: '2026-09-30T17:00:00.000Z',
    rating_note: 'Rated 4, chose 5 after the 4-star prompt',
    support_feedback: 'Onboarding docs could be clearer.',
  });
  assert.match(email.subject, /^\[Reputation Rocket\] Feedback for support, Acme, /);
  assert.doesNotMatch(email.subject, /—/);
  assert.match(email.text, /Feedback for support: Onboarding docs could be clearer\./);
  assert.match(email.text, /Rating note: Rated 4, chose 5 after the 4-star prompt/);
  assert.doesNotMatch(email.text, /Session completed|Marked submitted/);
});
