/**
 * 4-star ("murky middle") path for the EIM demo.
 *
 * Order (Tonya, 2026-09-30):
 * 1. Tap 4 → explain the murky middle, then choose 5 or 3.
 * 2. Choose 5 → run the 5-star review questions first.
 * 3. Skip the agent's "remove friction / improve the experience" question.
 * 4. After those questions (drafts are ready): ask for improvement notes.
 * 5. Send real notes through the same /api/notify `negative` path a 3-star
 *    session uses. Do not send the notes to the assistant (keeps them out of
 *    narrative review drafts). Fill platform dislike/improve fields only.
 * 6. Choose 3 → send 3 and stay on the existing private support path.
 *
 * Dual export: Node tests `require` this file; the chat page loads it as a
 * script before app.js and reads `window.MurkyMiddle`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.MurkyMiddle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MURKY_MIDDLE_MESSAGE =
    "Thank you for your 4-star rating. We've found that 4 stars is often the murky middle. " +
    'Would you prefer to leave a 3-star rating that goes to our support team, or a 5-star review ' +
    'about the best parts of your experience, with any feedback also shared with our support team?';

  const MURKY_CHOICE_LABELS = {
    5: 'Leave a 5-star review',
    3: 'Send a 3-star rating to our support team',
  };

  const MURKY_FEEDBACK_PROMPT =
    "Thank you! Before you go, is there anything we could improve or do better? We'll share your feedback with our support team.";
  const MURKY_FEEDBACK_SKIP_LABEL = 'Nothing to add';
  const MURKY_FEEDBACK_THANKS = "Thank you, we'll share that with our support team.";
  const MURKY_FEEDBACK_PLACEHOLDER = 'Type your feedback for our support team...';
  const MURKY_FEEDBACK_MAX_CHARS = 2000;
  const FRICTION_SKIP_REPLY = 'no';

  function looksLikeFrictionQuestion(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return false;
    if (/remove friction/.test(t) && /improve the experience/.test(t)) return true;
    if (/improve the experience/.test(t) && /put ['"]?no['"]?/.test(t)) return true;
    return false;
  }

  function isNoFeedbackAnswer(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.toLowerCase() === MURKY_FEEDBACK_SKIP_LABEL.toLowerCase()) return true;
    return /^(no|nope|none|nothing|n\/a|na|all good)\b[\s.!]*$/i.test(t);
  }

  function keptMurkySupportFeedback(text) {
    const feedback = String(text || '').trim().slice(0, MURKY_FEEDBACK_MAX_CHARS);
    if (!feedback || isNoFeedbackAnswer(feedback)) return '';
    return feedback;
  }

  function normalizeMurkyMiddle(value) {
    if (!value || typeof value !== 'object') return null;
    const chose = Number(value.chose);
    if (chose !== 5 && chose !== 3) return null;
    const feedback = typeof value.feedback === 'string'
      ? value.feedback.slice(0, MURKY_FEEDBACK_MAX_CHARS)
      : '';
    const hasNote = Boolean(feedback.trim());
    const feedbackAsked = value.feedbackAsked === true || (hasNote && value.feedbackAsked !== false);
    const allowedPhase = new Set(['choosing', 'review', 'improve', 'support', 'idle', 'done']);
    const phase = allowedPhase.has(value.phase) ? value.phase : (chose === 5 ? 'review' : 'support');
    return { chose, feedback, feedbackAsked, phase };
  }

  function onFourStarChoice(state, choice) {
    if (choice !== 5 && choice !== 3) return { action: 'ignore' };
    if (choice === 5) {
      return {
        sendToAssistant: '5',
        phase: 'review',
        chose: 5,
        showSupportAsk: false,
        feedbackAsked: false,
        feedback: '',
      };
    }
    return {
      sendToAssistant: '3',
      phase: 'support',
      chose: 3,
      showSupportAsk: false,
      feedbackAsked: false,
      feedback: '',
    };
  }

  function onAgentMessage(state, { text, hasDrafts } = {}) {
    const chose = state && state.chose;
    const phase = (state && state.phase) || 'idle';
    const feedbackAsked = !!(state && state.feedbackAsked);

    if (chose === 5 && phase === 'review' && looksLikeFrictionQuestion(text) && !hasDrafts) {
      return {
        skipFriction: true,
        hideAgentMessage: true,
        sendToAssistant: FRICTION_SKIP_REPLY,
        showSupportAsk: false,
        showDrafts: false,
        phase: 'review',
      };
    }

    if (chose === 5 && !feedbackAsked && hasDrafts) {
      return {
        skipFriction: false,
        hideAgentMessage: false,
        showSupportAsk: true,
        showDrafts: false,
        phase: 'improve',
        prompt: MURKY_FEEDBACK_PROMPT,
      };
    }

    if (hasDrafts) {
      return {
        skipFriction: false,
        hideAgentMessage: false,
        showSupportAsk: false,
        showDrafts: true,
        phase: phase === 'improve' ? 'improve' : phase,
      };
    }

    return {
      skipFriction: false,
      hideAgentMessage: false,
      showSupportAsk: false,
      showDrafts: false,
      phase: phase || 'idle',
    };
  }

  function onImprovementAnswer(state, text) {
    const kept = keptMurkySupportFeedback(text);
    return {
      feedback: kept,
      feedbackAsked: true,
      phase: 'done',
      sendToAssistant: undefined,
      notifyEvent: kept ? 'negative' : null,
      showDrafts: true,
      thanks: kept ? MURKY_FEEDBACK_THANKS : null,
    };
  }

  function murkyNotifyFields(state) {
    const normalized = normalizeMurkyMiddle(state);
    if (!normalized) return {};
    const out = { rating_note: `Rated 4, chose ${normalized.chose} after the 4-star prompt` };
    if (normalized.chose === 5 && normalized.feedback) {
      out.support_feedback = normalized.feedback;
    }
    return out;
  }

  function parseFieldDraft(draft) {
    if (!draft) return [];
    const re = /\[FIELD:\s*([^\]]+?)\]\s*([\s\S]*?)(?=\n*\[FIELD:|$)/g;
    const out = [];
    let m;
    while ((m = re.exec(draft)) !== null) {
      out.push({ label: m[1].trim(), body: m[2].trim() });
    }
    return out;
  }

  function isImprovementFieldLabel(label) {
    const t = String(label || '').toLowerCase();
    return /dislike|improv|friction|could be better|areas of (concern|improvement)/.test(t);
  }

  function applyImprovementToDrafts(drafts, feedback) {
    const note = String(feedback || '').trim();
    if (!note || !drafts || typeof drafts !== 'object') return drafts;
    const out = {};
    Object.keys(drafts).forEach((plat) => {
      out[plat] = drafts[plat];
    });
    Object.keys(out).forEach((plat) => {
      const text = out[plat];
      const fields = parseFieldDraft(text);
      if (!fields.length) return;
      let changed = false;
      const next = fields.map((field) => {
        if (!isImprovementFieldLabel(field.label)) return field;
        changed = true;
        return { label: field.label, body: note };
      });
      if (changed) {
        out[plat] = next.map((field) => `[FIELD: ${field.label}]\n${field.body}`).join('\n\n');
      }
    });
    return out;
  }

  function supportFlagFromFeedback(feedback, rating) {
    const note = String(feedback || '').trim();
    return {
      rating: rating != null ? rating : 5,
      severity: 'low',
      key_concerns: note ? [note] : [],
    };
  }

  return {
    MURKY_MIDDLE_MESSAGE,
    MURKY_CHOICE_LABELS,
    MURKY_FEEDBACK_PROMPT,
    MURKY_FEEDBACK_SKIP_LABEL,
    MURKY_FEEDBACK_THANKS,
    MURKY_FEEDBACK_PLACEHOLDER,
    MURKY_FEEDBACK_MAX_CHARS,
    FRICTION_SKIP_REPLY,
    looksLikeFrictionQuestion,
    isNoFeedbackAnswer,
    keptMurkySupportFeedback,
    normalizeMurkyMiddle,
    onFourStarChoice,
    onAgentMessage,
    onImprovementAnswer,
    murkyNotifyFields,
    parseFieldDraft,
    applyImprovementToDrafts,
    supportFlagFromFeedback,
  };
});
