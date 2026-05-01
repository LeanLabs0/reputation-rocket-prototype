const N8N_WEBHOOK_URL = process.env.N8N_REPUTATION_WEBHOOK_URL;
const N8N_SHARED_SECRET = process.env.N8N_REPUTATION_SHARED_SECRET;
const DEFAULT_SLACK_WEBHOOK_URL = process.env.SLACK_REPUTATION_WEBHOOK_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL;

const ALLOWED_EVENTS = new Set(['completed', 'negative']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body || {};
  if (!ALLOWED_EVENTS.has(payload.event)) {
    return res.status(400).json({ error: 'Invalid notification event' });
  }

  const slackWebhookUrlRaw = getSlackWebhookUrl(payload.client_slug);
  const slackWebhookValidation = validateSlackWebhookUrl(slackWebhookUrlRaw);
  if (!N8N_WEBHOOK_URL && !slackWebhookValidation.ok) {
    return res.status(500).json({
      error: 'Missing or invalid Slack webhook URL',
      detail: slackWebhookValidation.reason,
      expected: [
        'N8N_REPUTATION_WEBHOOK_URL',
        'SLACK_REPUTATION_WEBHOOK_URL',
        `SLACK_REPUTATION_WEBHOOK_${toEnvSuffix(payload.client_slug)}`,
      ],
    });
  }

  const notificationPayload = {
    ...payload,
    source: 'reputation-rocket',
    received_at: new Date().toISOString(),
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  if (N8N_SHARED_SECRET) {
    headers['X-Reputation-Rocket-Secret'] = N8N_SHARED_SECRET;
  }

  try {
    let deliveredTo = '';

    if (N8N_WEBHOOK_URL) {
      const upstream = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(notificationPayload),
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(502).json({
          error: 'n8n notification webhook failed',
          status: upstream.status,
          body: text,
        });
      }

      deliveredTo = 'n8n';
    } else {
      const slack = await fetch(slackWebhookValidation.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSlackMessage(notificationPayload)),
      });

      const slackText = await slack.text();
      if (!slack.ok || slackText !== 'ok') {
        return res.status(502).json({
          error: 'Slack notification webhook failed',
          status: slack.status,
          body: slackText.slice(0, 500),
        });
      }

      deliveredTo = 'slack';
    }

    let support_email_sent = false;
    if (payload.event === 'negative') {
      const emailResult = await sendNegativeSupportEmail(notificationPayload);
      support_email_sent = Boolean(emailResult.sent);
    }

    return res.status(200).json({ ok: true, delivered_to: deliveredTo, support_email_sent });
  } catch (error) {
    return res.status(502).json({
      error: 'Notification request failed',
      message: error.message,
    });
  }
};

function buildSlackMessage(payload) {
  if (payload.event === 'negative') {
    const flag = payload.negative_flag || {};
    const receivedAt = formatReceivedAt(payload.received_at || payload.ts);
    const concerns = Array.isArray(flag.key_concerns) && flag.key_concerns.length
      ? flag.key_concerns.join(', ')
      : 'No concerns provided';
    const actions = Array.isArray(flag.suggested_actions) && flag.suggested_actions.length
      ? flag.suggested_actions.join('\n')
      : 'Review customer feedback and identify resolution steps';
    const surveySummary = formatSurveyResponses(flag.survey_responses);
    const rating = flag.rating ?? payload.rating ?? '—';

    return {
      text: `Reputation Rocket - Negative feedback - ${payload.client || 'Unknown'} (${receivedAt})`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `Negative feedback — ${payload.client || 'Unknown client'}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Portal:*\n${payload.provider || '—'}` },
            { type: 'mrkdwn', text: `*Customer company:*\n${payload.client || 'Unknown'}` },
            { type: 'mrkdwn', text: `*Respondent:*\n${formatRespondent(payload)}` },
            { type: 'mrkdwn', text: `*Date received:*\n${receivedAt}` },
            { type: 'mrkdwn', text: `*Severity:*\n${flag.severity || '—'}` },
            { type: 'mrkdwn', text: `*Rating:*\n${rating}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Survey responses / summary:*\n${surveySummary}\n\n*Key concerns:*\n${concerns}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Action required:*\n• Review customer feedback and identify resolution steps\n• Assign team member to follow up with ${payload.client || 'the client'} within 24 hours\n• Determine if this requires immediate client communication or internal process improvement\n\n*Suggested actions:*\n${actions}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Next steps:*\n• Customer has been notified that our team is reviewing their feedback\n• Client (${payload.client || 'Unknown'}) should be contacted to discuss customer concerns\n• Update this thread with resolution actions taken`,
          },
        },
      ],
    };
  }

  const posted = Array.isArray(payload.posted) && payload.posted.length
    ? payload.posted.join(', ')
    : 'None marked posted';

  return {
    text: `:rocket: ${payload.customer_name || 'A customer'} completed Reputation Rocket for ${payload.client || 'a client'}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Reputation Rocket Completed',
        },
      },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Portal:*\n${payload.provider || '—'}` },
            { type: 'mrkdwn', text: `*Customer company:*\n${payload.client || 'Unknown'}` },
            { type: 'mrkdwn', text: `*Customer:*\n${payload.customer_name || 'Unknown'}` },
            { type: 'mrkdwn', text: `*Email:*\n${payload.customer_email || 'Unknown'}` },
            { type: 'mrkdwn', text: `*Marked posted:*\n${posted}` },
            { type: 'mrkdwn', text: `*Rating:*\n${payload.rating || 'Unknown'}` },
          ],
        },
    ],
  };
}

function getSlackWebhookUrl(clientSlug) {
  const suffix = toEnvSuffix(clientSlug);
  return process.env[`SLACK_REPUTATION_WEBHOOK_${suffix}`] || DEFAULT_SLACK_WEBHOOK_URL;
}

function validateSlackWebhookUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'Slack webhook URL is empty. Paste the full https://hooks.slack.com/services/... URL from Slack.' };
  }

  const trimmed = raw.trim();
  if (trimmed.includes('...') || trimmed.endsWith('/...')) {
    return { ok: false, reason: 'Slack webhook URL still looks like a placeholder (...). Replace it with the real URL from Slack.' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { ok: false, reason: 'Slack webhook URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Slack webhook URL must use https.' };
  }

  if (!parsed.hostname.endsWith('hooks.slack.com')) {
    return { ok: false, reason: 'Slack incoming webhook URLs should be on hooks.slack.com (Incoming Webhooks app).' };
  }

  return { ok: true, url: trimmed };
}

function toEnvSuffix(value) {
  return String(value || 'DEFAULT')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'DEFAULT';
}

function formatReceivedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatRespondent(payload) {
  const name = payload.customer_name || 'Unknown customer';
  const email = payload.customer_email ? ` (${payload.customer_email})` : '';
  return `${name}${email}`;
}

function formatSurveyResponses(responses) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return 'No full response list was provided. See key concerns and suggested actions below.';
  }

  return responses
    .slice(0, 6)
    .map((item, index) => `${index + 1}. ${item.question || 'Question'}: ${item.answer || 'No answer provided'}`)
    .join('\n');
}

function buildNegativeEmailSubjectAndText(payload) {
  const flag = payload.negative_flag || {};
  const receivedAt = formatReceivedAt(payload.received_at || payload.ts);
  const concerns = Array.isArray(flag.key_concerns) && flag.key_concerns.length
    ? flag.key_concerns.join(', ')
    : 'No concerns provided';
  const actions = Array.isArray(flag.suggested_actions) && flag.suggested_actions.length
    ? flag.suggested_actions.join('\n')
    : 'Review customer feedback and identify resolution steps';
  const surveySummary = formatSurveyResponses(flag.survey_responses);
  const rating = flag.rating ?? payload.rating ?? '—';

  const subject = `[Reputation Rocket] Negative feedback — ${payload.client || 'Unknown'} — ${receivedAt}`;

  const text = [
    `Negative feedback — ${payload.client || 'Unknown client'}`,
    '',
    `Portal: ${payload.provider || '—'}`,
    `Customer company: ${payload.client || 'Unknown'}`,
    `Respondent: ${formatRespondent(payload)}`,
    `Date received: ${receivedAt}`,
    `Severity: ${flag.severity || '—'}`,
    `Rating: ${rating}`,
    '',
    'Survey responses / summary:',
    surveySummary,
    '',
    `Key concerns:\n${concerns}`,
    '',
    'Action required:',
    '• Review customer feedback and identify resolution steps',
    `• Assign team member to follow up with ${payload.client || 'the client'} within 24 hours`,
    '• Determine if this requires immediate client communication or internal process improvement',
    '',
    'Suggested actions:',
    actions,
    '',
    'Next steps:',
    '• Customer has been notified that our team is reviewing their feedback',
    `• Client (${payload.client || 'Unknown'}) should be contacted to discuss customer concerns`,
    '• Update your team thread with resolution actions taken',
    '',
    `Session: ${payload.session_id || '—'}`,
  ].join('\n');

  return { subject, text };
}

/**
 * Optional: Resend.com. Set RESEND_API_KEY + RESEND_FROM.
 * Recipient: NEGATIVE_ALERT_EMAIL_<CLIENT_SLUG> env (recommended) or support_email from payload.
 */
async function sendNegativeSupportEmail(payload) {
  try {
    if (!RESEND_API_KEY || !RESEND_FROM) {
      return { sent: false, reason: 'resend_not_configured' };
    }

    const suffix = toEnvSuffix(payload.client_slug);
    const envTo = process.env[`NEGATIVE_ALERT_EMAIL_${suffix}`];
    const rawTo = envTo || payload.support_email;
    if (!rawTo || typeof rawTo !== 'string') {
      return { sent: false, reason: 'no_recipient' };
    }

    const to = rawTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { sent: false, reason: 'invalid_recipient' };
    }

    const { subject, text } = buildNegativeEmailSubjectAndText(payload);

    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM.trim(),
        to: [to],
        subject,
        text,
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      console.warn('[notify] Resend error', upstream.status, errBody.slice(0, 500));
      return { sent: false, reason: 'resend_http_error', status: upstream.status };
    }

    return { sent: true };
  } catch (error) {
    console.warn('[notify] Resend exception', error.message);
    return { sent: false, reason: 'resend_exception', message: error.message };
  }
}