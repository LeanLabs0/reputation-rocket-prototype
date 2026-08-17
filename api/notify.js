const { readClientConfigFile } = require('../lib/client-config-file');
const { getClient } = require('../lib/hubspot/store');
const { mergePortalSettings } = require('../lib/portal-settings');

const N8N_WEBHOOK_URL = process.env.N8N_REPUTATION_WEBHOOK_URL;
const N8N_SHARED_SECRET = process.env.N8N_REPUTATION_SHARED_SECRET;
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = 'Reputation Rocket <alert@updates.reputationrocket.ai>';

/**
 * Slack Bot API (chat.postMessage) threading config — per client.
 *
 * Secrets stay in env:
 *   SLACK_BOT_TOKEN_<SLUG>   — xoxb-... bot token (falls back to SLACK_BOT_TOKEN)
 *
 * Routing lives on the client config.js (not env):
 *   slackChannel           — channel ID the bot was installed into (C0...)
 *   slackThreadPositive    — thread_ts of the "positive/completed" parent message
 *   slackThreadNegative    — thread_ts of the "negative" parent message
 *
 * thread_ts: right-click a Slack message → Copy link → URL ends in p1718725200123456
 *   → insert a dot before the last 6 digits → 1718725200.123456
 */
function getSlackBotConfig(clientSlug, event, settings) {
  const suffix = toEnvSuffix(clientSlug);
  const token = (process.env[`SLACK_BOT_TOKEN_${suffix}`] || process.env.SLACK_BOT_TOKEN || '').trim();
  const channel = String((settings && settings.slackChannel) || '').trim();
  const threadTs = String(
    event === 'negative'
      ? (settings && settings.slackThreadNegative)
      : (settings && settings.slackThreadPositive),
  ).trim();
  if (!token || !channel || !threadTs) return null;
  return { token, channel, threadTs };
}

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

  const fileConfig = readClientConfigFile(payload.client_slug) || {};
  const stored = await getClient(payload.client_slug);
  const settings = mergePortalSettings(
    stored?.portalSettings,
    fileConfig,
    fileConfig.providerName || payload.client || payload.client_slug,
  );
  const botConfig = getSlackBotConfig(payload.client_slug, payload.event, settings);
  const notifyEmails = Array.isArray(settings.notifyEmails) ? settings.notifyEmails : [];
  const canEmail = Boolean(RESEND_API_KEY && notifyEmails.length);

  if (!N8N_WEBHOOK_URL && !botConfig && !canEmail) {
    const suffix = toEnvSuffix(payload.client_slug);
    return res.status(500).json({
      error: 'No notification delivery method configured for this client',
      detail: 'Set Slack (bot token + config.js threads), notifyEmails on config.js with RESEND_API_KEY, or N8N_REPUTATION_WEBHOOK_URL.',
      expected: [
        'N8N_REPUTATION_WEBHOOK_URL',
        `SLACK_BOT_TOKEN_${suffix} (or SLACK_BOT_TOKEN)`,
        'config.js slackChannel / slackThreadPositive / slackThreadNegative',
        'config.js notifyEmails + RESEND_API_KEY',
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
    const deliveredTo = [];
    const errors = [];

    if (N8N_WEBHOOK_URL) {
      const upstream = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(notificationPayload),
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        errors.push({ channel: 'n8n', status: upstream.status, body: text });
      } else {
        deliveredTo.push('n8n');
      }
    } else if (botConfig) {
      const message = buildSlackMessage(notificationPayload);
      const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${botConfig.token}`,
        },
        body: JSON.stringify({
          channel: botConfig.channel,
          thread_ts: botConfig.threadTs,
          ...message,
        }),
      });

      const slackData = await slackRes.json();
      if (!slackRes.ok || !slackData.ok) {
        errors.push({
          channel: 'slack-thread',
          status: slackRes.status,
          slack_error: slackData.error || 'unknown',
        });
      } else {
        deliveredTo.push('slack-thread');
      }
    }

    let support_email_sent = false;
    if (canEmail) {
      const emailResult = await sendNotifyEmail(notificationPayload, notifyEmails);
      support_email_sent = Boolean(emailResult.sent);
      if (emailResult.sent) {
        deliveredTo.push('email');
      } else {
        errors.push({ channel: 'email', reason: emailResult.reason || 'unknown' });
      }
    }

    if (!deliveredTo.length) {
      return res.status(502).json({
        error: 'Notification delivery failed',
        errors,
      });
    }

    return res.status(200).json({
      ok: true,
      delivered_to: deliveredTo.join(','),
      support_email_sent,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Notification request failed',
      message: error.message,
    });
  }
};

/**
 * Per-brand Slack mention. Set SLACK_REPUTATION_MENTION_<CLIENT_SLUG> (falls back
 * to SLACK_REPUTATION_MENTION) to a comma-separated list of targets. Each entry:
 *   - a user member ID (e.g. U12345678 / W12345678) → <@U12345678>
 *   - a user group ID (e.g. S12345678)              → <!subteam^S12345678>
 *   - "channel" | "here"                            → <!channel> | <!here>
 *   - anything already wrapped in <...>             → used as-is
 * Member/group IDs come from Slack (profile → "Copy member ID"), NOT the @handle.
 */
function getSlackMention(clientSlug) {
  const suffix = toEnvSuffix(clientSlug);
  const raw = process.env[`SLACK_REPUTATION_MENTION_${suffix}`] || process.env.SLACK_REPUTATION_MENTION;
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      if (token.startsWith('<')) return token;
      const lower = token.toLowerCase();
      if (lower === 'channel' || lower === 'here' || lower === 'everyone') return `<!${lower}>`;
      if (/^S[A-Z0-9]+$/.test(token)) return `<!subteam^${token}>`;
      return `<@${token}>`;
    })
    .join(' ');
}

function buildSlackMessage(payload) {
  const mention = getSlackMention(payload.client_slug);
  const mentionBlock = mention
    ? [{ type: 'section', text: { type: 'mrkdwn', text: mention } }]
    : [];
  const mentionPrefix = mention ? `${mention} ` : '';

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
      text: `${mentionPrefix}Reputation Rocket - Negative feedback - ${payload.client || 'Unknown'} (${receivedAt})`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `Negative feedback — ${payload.client || 'Unknown client'}`,
          },
        },
        ...mentionBlock,
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
  const video = payload.video_testimonial && typeof payload.video_testimonial === 'object'
    ? payload.video_testimonial
    : null;
  const videoLine = video && video.url
    ? `<${video.url}|Open HubSpot video file>`
    : (video && video.id ? `HubSpot file ID: ${video.id}` : 'Not submitted');

  return {
    text: `${mentionPrefix}:rocket: ${payload.customer_name || 'A customer'} completed Reputation Rocket for ${payload.client || 'a client'}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Reputation Rocket Completed',
        },
      },
        ...mentionBlock,
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
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Video testimonial:*\n${videoLine}`,
          },
        },
        ...formatTranscriptBlocks(payload.transcript),
    ],
  };
}

/**
 * Render the interview Q&A as a numbered "Survey responses / summary" list,
 * matching the negative-feedback format. The transcript is an array of
 * { role: 'agent' | 'user', content } turns; each agent question is paired with
 * the customer's next answer. Long lists are split across multiple section
 * blocks to stay under Slack's 3000-char limit.
 */
function formatTranscriptBlocks(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return [];

  const pairs = [];
  let pendingQuestion = null;
  for (const turn of transcript) {
    if (!turn || !turn.content) continue;
    const content = String(turn.content).trim();
    if (!content) continue;
    if (turn.role === 'user') {
      if (pendingQuestion) {
        pairs.push({ question: pendingQuestion, answer: content });
        pendingQuestion = null;
      }
    } else {
      pendingQuestion = content;
    }
  }
  if (pairs.length === 0) return [];

  const lines = pairs.map((p, i) => `${i + 1}. ${p.question}: ${p.answer}`);

  const MAX = 2900;
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const piece = current ? `${current}\n${line}` : line;
    if (piece.length > MAX && current) {
      chunks.push(current);
      current = line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
    } else {
      current = piece.length > MAX ? `${piece.slice(0, MAX - 1)}…` : piece;
    }
  }
  if (current) chunks.push(current);

  const blocks = [{ type: 'divider' }];
  chunks.forEach((text, i) => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: i === 0 ? `*Survey responses / summary:*\n${text}` : text },
    });
  });
  return blocks;
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

function formatTranscriptText(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 'No interview transcript was provided.';
  }

  const pairs = [];
  let pendingQuestion = null;
  for (const turn of transcript) {
    if (!turn || !turn.content) continue;
    const content = String(turn.content).trim();
    if (!content) continue;
    if (turn.role === 'user') {
      if (pendingQuestion) {
        pairs.push({ question: pendingQuestion, answer: content });
        pendingQuestion = null;
      }
    } else {
      pendingQuestion = content;
    }
  }
  if (!pairs.length) return 'No interview transcript was provided.';
  return pairs.map((p, i) => `${i + 1}. ${p.question}: ${p.answer}`).join('\n');
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
    '',
    `Session: ${payload.session_id || '—'}`,
  ].join('\n');

  return { subject, text };
}

function buildCompletedEmailSubjectAndText(payload) {
  const receivedAt = formatReceivedAt(payload.received_at || payload.ts);
  const posted = Array.isArray(payload.posted) && payload.posted.length
    ? payload.posted.join(', ')
    : 'None marked posted';
  const video = payload.video_testimonial && typeof payload.video_testimonial === 'object'
    ? payload.video_testimonial
    : null;
  const videoLine = video && video.url
    ? video.url
    : (video && video.id ? `HubSpot file ID: ${video.id}` : 'Not submitted');

  const subject = `[Reputation Rocket] Completed — ${payload.client || 'Unknown'} — ${receivedAt}`;

  const text = [
    `Reputation Rocket completed — ${payload.client || 'Unknown client'}`,
    '',
    `Portal: ${payload.provider || '—'}`,
    `Customer company: ${payload.client || 'Unknown'}`,
    `Customer: ${payload.customer_name || 'Unknown'}`,
    `Email: ${payload.customer_email || 'Unknown'}`,
    `Date received: ${receivedAt}`,
    `Marked posted: ${posted}`,
    `Rating: ${payload.rating || 'Unknown'}`,
    '',
    `Video testimonial: ${videoLine}`,
    '',
    'Survey responses / summary:',
    formatTranscriptText(payload.transcript),
    '',
    `Session: ${payload.session_id || '—'}`,
  ].join('\n');

  return { subject, text };
}

/**
 * Resend.com. Recipients come from config.js notifyEmails (server-read, not the browser).
 */
async function sendNotifyEmail(payload, to) {
  try {
    if (!RESEND_API_KEY || !RESEND_FROM) {
      return { sent: false, reason: 'resend_not_configured' };
    }
    if (!Array.isArray(to) || !to.length) {
      return { sent: false, reason: 'no_recipient' };
    }

    const { subject, text } = payload.event === 'negative'
      ? buildNegativeEmailSubjectAndText(payload)
      : buildCompletedEmailSubjectAndText(payload);

    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM.trim(),
        to,
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