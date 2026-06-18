const N8N_WEBHOOK_URL = process.env.N8N_REPUTATION_WEBHOOK_URL;
const N8N_SHARED_SECRET = process.env.N8N_REPUTATION_SHARED_SECRET;
// Email sending (Resend) is disabled until Resend is set up. Slack remains the
// active channel. Re-enable by uncommenting these + the sendNegativeSupportEmail
// call below and the function itself.
// const RESEND_API_KEY = process.env.RESEND_API_KEY;
// const RESEND_FROM = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL;

/**
 * Slack Bot API (chat.postMessage) threading config — per client.
 *
 * To enable threaded replies for a client set these env vars:
 *   SLACK_BOT_TOKEN_<SLUG>   — xoxb-... bot token (falls back to SLACK_BOT_TOKEN)
 *   SLACK_CHANNEL_<SLUG>     — channel ID the bot was installed into (C0...)
 *   SLACK_THREAD_P_<SLUG>    — thread_ts of the "positive/completed" parent message
 *   SLACK_THREAD_N_<SLUG>    — thread_ts of the "negative" parent message
 *
 * thread_ts: right-click a Slack message → Copy link → URL ends in p1718725200123456
 *   → insert a dot before the last 6 digits → 1718725200.123456
 *
 * Clients without bot config automatically fall back to the webhook path.
 */
function getSlackBotConfig(clientSlug, event) {
  const suffix = toEnvSuffix(clientSlug);
  const token = (process.env[`SLACK_BOT_TOKEN_${suffix}`] || process.env.SLACK_BOT_TOKEN || '').trim();
  const channel = (process.env[`SLACK_CHANNEL_${suffix}`] || '').trim();
  const threadKey = event === 'negative' ? `SLACK_THREAD_N_${suffix}` : `SLACK_THREAD_P_${suffix}`;
  const threadTs = (process.env[threadKey] || '').trim();
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

  const botConfig = getSlackBotConfig(payload.client_slug, payload.event);

  if (!N8N_WEBHOOK_URL && !botConfig) {
    const suffix = toEnvSuffix(payload.client_slug);
    return res.status(500).json({
      error: 'No Slack delivery method configured for this client',
      detail: 'Set a bot token + channel + thread TS for this client (or N8N_REPUTATION_WEBHOOK_URL).',
      expected: [
        'N8N_REPUTATION_WEBHOOK_URL',
        `SLACK_BOT_TOKEN_${suffix} (or SLACK_BOT_TOKEN)`,
        `SLACK_CHANNEL_${suffix}`,
        `SLACK_THREAD_P_${suffix} / SLACK_THREAD_N_${suffix}`,
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
      // n8n webhook — highest priority, handles its own routing
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
    } else if (botConfig) {
      // Slack Bot API — threads the reply into the configured positive or negative thread
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
        return res.status(502).json({
          error: 'Slack Bot API (chat.postMessage) failed',
          status: slackRes.status,
          slack_error: slackData.error || 'unknown',
        });
      }

      deliveredTo = 'slack-thread';
    }

    // Email alerts via Resend are disabled until Resend is configured.
    // Slack (above) is the active notification channel. To re-enable email,
    // uncomment the block below + sendNegativeSupportEmail() + the env consts.
    let support_email_sent = false;
    // if (payload.event === 'negative') {
    //   const emailResult = await sendNegativeSupportEmail(notificationPayload);
    //   support_email_sent = Boolean(emailResult.sent);
    // }

    return res.status(200).json({ ok: true, delivered_to: deliveredTo, support_email_sent });
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
 *
 * DISABLED: Resend is not set up yet, so this is commented out and unused.
 * To re-enable email alerts: uncomment this function, the RESEND_* env consts
 * at the top, and the sendNegativeSupportEmail() call in the handler.
 */
/*
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
*/