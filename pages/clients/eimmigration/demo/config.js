/*
 * EIM (eimmigration) walkthrough demo — at /eimmigration/demo/.
 *
 * Uses eimmigration branding and platforms, but does NOT connect to the live
 * EIM portal, HubSpot lead form, Slack, or real review sites. Review links open
 * the local sandbox. /api/notify and /api/upload-video are stubbed in demo.js;
 * /api/agent still talks to the real Reputation Rocket assistant for a live chat.
 *
 * HubSpot form IDs are intentionally omitted so the lead-capture modal never appears.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'eim-demo',
  providerName: 'eimmigration',
  displayName: 'eImmigration',
  // Tap-to-answer rating + the 4-star choice (Kevin 9/29). Demo only until
  // Viv greens it; then flip the same two keys on the live EIM config.
  ratingButtons: true,
  murkyMiddle: true,
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['gartner', 'g2', 'trustpilot'],
  // Wording from Viv's 10/13 feedback. Keys are read by clientCopy() and
  // clientCardHint() in app.js; anything not set here keeps the shared default.
  copy: {
    draftsReadyMessage: "Thanks so much for sharing.\n\nWe turned your responses into a few reviews that you can edit or publish.",
    draftsReadyLink: "Read the drafts.",
    cardHints: {
      gartner: "Takes 2 minutes. You'll need to log in to or create a free Gartner account to publish your review.",
      g2: "Takes 2 minutes. You'll need to log in to or create a free G2 account to publish your review.",
      trustpilot: "Takes 1 minute. You'll need to log in to or create a free Trustpilot account to publish your review."
    },
    postFinishHint: "",
    postNudgeProgress: "Nice work! Publish and confirm the rest so eimmigration can see your reviews and send your reward."
  },
  reviewLinks: {
    gartner: 'review-sandbox.html?platform=gartner&company=eimmigration',
    g2: 'review-sandbox.html?platform=g2&company=eimmigration',
    trustpilot: 'review-sandbox.html?platform=trustpilot&company=eimmigration',
  },
  welcomeVideoUrl: '/assets/video/Reputation Rocket Intro.mp4',
  welcomeVideoPoster: '/assets/image/7c248b618a126294316f6a.gif',
  interviewQuestions: [
    'Why did you choose eimmigration?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  // Match the live EIM portal: no video step in the walkthrough.
  videoCaptureEnabled: false,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: [],
  supportEmail: 'demo@eimmigration.example',
};
