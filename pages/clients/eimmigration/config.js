window.CLIENT_CONFIG = {
  clientSlug: "eimmigration",
  providerName: "eimmigration",
  displayName: "eImmigration",
  agentEndpoint: "/api/agent",
  notificationEndpoint: "/api/notify",
  platforms: ["gartner","g2","trustpilot"],
  reviewLinks: {
    gartner: "https://www.gartner.com/reviews/product/eimmigration",
    g2: "https://www.g2.com/products/eimmigration-by-cerenade/reviews/start",
    trustpilot: "https://www.trustpilot.com/evaluate/cerenade.com"
  },
  welcomeVideoUrl: "",
  welcomeVideoPoster: "",
  interviewQuestions: [
    "Why did you choose eimmigration?",
    "What were you hoping to achieve?",
    "How did we deliver on your expectations?"
  ],
  videoCaptureEnabled: false,
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
  thankYouUrl: "",
  thankYouRedirectDelayMs: 120000,
  allowedRedirectHosts: ["eimmigration.com","www.eimmigration.com","get.eimmigration.com"],
  supportEmail: "support@cerenade.com",
  hubspotPortalId: "45248900",
  hubspotFormId: "d636fadd-2e72-4663-bf26-e465c7d419a5",
  hubspotFormRegion: "na1",
  hubspotCompleteProperty: "rr_iscomplete",
  hubspotCompleteValue: "Yes",
  hubspotIncompleteValue: "No",
  hubspotOutcomeProperty: "rr_outcome",
  hubspotOutcomePositiveValue: "positive",
  hubspotOutcomeNegativeValue: "negative",
  slackChannel: 'C07K39T6U6M',
  slackThreadPositive: '1781882060.665979',
  slackThreadNegative: '1781882092.387649'
};
