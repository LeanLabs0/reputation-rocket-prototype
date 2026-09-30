/**
 * 4-star ("murky middle") path for the EIM demo.
 *
 * Order (Tonya, 2026-09-30):
 * 1. Tap 4 → explain the murky middle, then choose 5 or 3.
 * 2. Choose 5 → run the 5-star review questions first.
 * 3. Skip the agent's "remove friction / improve the experience" question.
 * 4. After those questions: say we'll draft the review, then (4-then-5 only)
 *    ask Tonya's private support sentence.
 * 5. Never send "no" / "nothing to add" to the assistant. That made the
 *    bot praise an empty note. Request drafts with a hidden instruction instead.
 * 6. Send real notes through the same /api/notify `negative` path a 3-star
 *    session uses. Do not send the notes to the assistant (keeps them out of
 *    narrative review drafts). Fill platform dislike/improve fields only.
 * 7. Choose 3 → send 3 and stay on the existing private support path.
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
  const DRAFT_NEXT_MESSAGE = "We'll draft your review now.";
  const DRAFT_REQUEST_REPLY =
    'Please generate the review drafts now from the answers already given. Do not ask any more questions.';

  function looksLikeFrictionQuestion(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return false;
    if (/remove friction/.test(t)) return true;
    if (/improve the experience/.test(t) && /put ['"]?no['"]?/.test(t)) return true;
    if (/is there any area where we could/.test(t)) return true;
    if (/where could we (improve|do better|remove friction)/.test(t)) return true;
    return false;
  }

  function looksLikeSkipPraise(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return false;
    if (/wonderful to hear/.test(t)) return true;
    if (/that'?s (great|wonderful|amazing|good) to hear/.test(t)) return true;
    if (/glad to hear/.test(t)) return true;
    if (/love to hear/.test(t)) return true;
    return false;
  }

  function looksLikeTypedSkip(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.toLowerCase() === MURKY_FEEDBACK_SKIP_LABEL.toLowerCase()) return true;
    if (/^nothing to add\b/i.test(t)) return true;
    if (/^nothing else (comes to mind|to add)\b/i.test(t)) return true;
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
    return {
      chose,
      feedback,
      feedbackAsked,
      phase,
      draftLineShown: value.draftLineShown === true,
      awaitingDrafts: value.awaitingDrafts === true,
    };
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
    const draftLineShown = !!(state && state.draftLineShown);
    const awaitingDrafts = !!(state && state.awaitingDrafts);
    const fromFour = Number(chose) === 5;

    const base = {
      skipFriction: false,
      hideAgentMessage: false,
      showSupportAsk: false,
      showDrafts: false,
      showDraftLine: false,
      phase: phase || 'idle',
    };

    if (fromFour && !feedbackAsked && looksLikeFrictionQuestion(text) && !hasDrafts) {
      return {
        ...base,
        skipFriction: true,
        hideAgentMessage: true,
        sendToAssistant: DRAFT_REQUEST_REPLY,
        showDraftLine: !draftLineShown,
        draftLine: DRAFT_NEXT_MESSAGE,
        showSupportAsk: true,
        prompt: MURKY_FEEDBACK_PROMPT,
        phase: 'improve',
        awaitingDrafts: true,
        draftLineShown: true,
      };
    }

    // Never show "that's wonderful to hear" (or similar) as praise of a skip.
    // A real follow-up review question on the same bubble can still display.
    if (looksLikeSkipPraise(text) && !hasDrafts) {
      const extraReviewQuestion = /\?/.test(text) && !looksLikeFrictionQuestion(text);
      if (fromFour) {
        const keepReviewQuestion = extraReviewQuestion && !awaitingDrafts && phase === 'review';
        if (!keepReviewQuestion) {
          return {
            ...base,
            hideAgentMessage: true,
            awaitingDrafts: awaitingDrafts || phase === 'improve',
          };
        }
      } else if (!extraReviewQuestion) {
        return { ...base, hideAgentMessage: true };
      }
    }

    if (fromFour && phase === 'improve' && !feedbackAsked && !hasDrafts) {
      return {
        ...base,
        hideAgentMessage: true,
        phase: 'improve',
        awaitingDrafts: true,
      };
    }

    if (fromFour && phase === 'improve' && !feedbackAsked && hasDrafts) {
      return {
        ...base,
        hideAgentMessage: true,
        showSupportAsk: false,
        showDrafts: false,
        showDraftLine: false,
        awaitingDrafts: false,
        phase: 'improve',
      };
    }

    if (fromFour && !feedbackAsked && hasDrafts) {
      const hide = !text
        || looksLikeSkipPraise(text)
        || looksLikeFrictionQuestion(text)
        || /draft/i.test(text);
      return {
        ...base,
        hideAgentMessage: hide,
        showDraftLine: !draftLineShown,
        draftLine: DRAFT_NEXT_MESSAGE,
        showSupportAsk: true,
        prompt: MURKY_FEEDBACK_PROMPT,
        showDrafts: false,
        phase: 'improve',
        awaitingDrafts: false,
        draftLineShown: true,
      };
    }

    if (fromFour && feedbackAsked && hasDrafts) {
      return {
        ...base,
        hideAgentMessage: true,
        showDrafts: true,
        awaitingDrafts: false,
        phase: 'done',
      };
    }

    if (fromFour && feedbackAsked && !hasDrafts) {
      return {
        ...base,
        hideAgentMessage: true,
        showDrafts: false,
        awaitingDrafts: true,
        phase: 'done',
      };
    }

    if (!fromFour && hasDrafts) {
      return {
        ...base,
        hideAgentMessage: looksLikeSkipPraise(text) || /draft/i.test(text) || !text,
        showDraftLine: !draftLineShown,
        draftLine: DRAFT_NEXT_MESSAGE,
        showDrafts: true,
        showSupportAsk: false,
      };
    }

    if (hasDrafts) {
      return { ...base, showDrafts: true };
    }

    return base;
  }

  function onUserReviewAnswer(state, { text, lastAgentText } = {}) {
    const fromFour = state && Number(state.chose) === 5;
    const phase = (state && state.phase) || 'idle';
    const feedbackAsked = !!(state && state.feedbackAsked);
    if (!fromFour || feedbackAsked) return { sendToAssistant: text };
    if (phase !== 'review' && phase !== 'improve') return { sendToAssistant: text };

    const lastWasFriction = looksLikeFrictionQuestion(lastAgentText);
    if (lastWasFriction && (isNoFeedbackAnswer(text) || looksLikeTypedSkip(text))) {
      return {
        sendToAssistant: DRAFT_REQUEST_REPLY,
        skipFriction: true,
        showDraftLine: !(state && state.draftLineShown),
        draftLine: DRAFT_NEXT_MESSAGE,
        showSupportAsk: true,
        prompt: MURKY_FEEDBACK_PROMPT,
        phase: 'improve',
        awaitingDrafts: true,
        draftLineShown: true,
      };
    }
    return { sendToAssistant: text };
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
    DRAFT_NEXT_MESSAGE,
    DRAFT_REQUEST_REPLY,
    looksLikeFrictionQuestion,
    looksLikeSkipPraise,
    looksLikeTypedSkip,
    isNoFeedbackAnswer,
    keptMurkySupportFeedback,
    normalizeMurkyMiddle,
    onFourStarChoice,
    onAgentMessage,
    onUserReviewAnswer,
    onImprovementAnswer,
    murkyNotifyFields,
    parseFieldDraft,
    applyImprovementToDrafts,
    supportFlagFromFeedback,
  };
});
