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
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['gartner', 'g2', 'trustpilot'],
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
