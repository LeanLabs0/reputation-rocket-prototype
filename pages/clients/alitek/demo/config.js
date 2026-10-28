/*
 * Alitek walkthrough demo — at /alitek/demo/.
 *
 * Uses Alitek branding and platforms, but does not connect to Slack, HubSpot,
 * or live review sites. Review links open the local sandbox. /api/notify,
 * /api/upload-video, /api/hubspot-contact, and /api/handoff are stubbed in demo.js.
 * /api/agent still talks to the real Reputation Rocket assistant.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'alitek-demo',
  providerName: 'Alitek',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['clutch', 'g2'],
  reviewLinks: {
    clutch: 'review-sandbox.html?platform=clutch&company=Alitek',
    g2: 'review-sandbox.html?platform=g2&company=Alitek',
  },
  welcomeVideoUrl: '/assets/video/Reputation%20Rocket%20Intro.mp4',
  welcomeVideoPoster: '/assets/image/7c248b618a126294316f6a.gif',
  interviewQuestions: [
    'Why did you choose Alitek?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: false,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 120000,
  allowedRedirectHosts: [],
  supportEmail: '',
  notifyEmails: [],
  hubspotPortalId: '',
  hubspotFormId: '',
  hubspotFormRegion: 'na1',
  hubspotCompleteProperty: 'rr_iscomplete',
  hubspotCompleteValue: 'Yes',
  hubspotIncompleteValue: 'No',
  hubspotOutcomeProperty: 'rr_outcome',
  hubspotOutcomePositiveValue: 'positive',
  hubspotOutcomeNegativeValue: 'negative',
};
