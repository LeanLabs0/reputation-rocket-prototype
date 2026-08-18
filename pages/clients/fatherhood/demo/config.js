/*
 * National Fatherhood Initiative walkthrough demo — at /fatherhood/demo/.
 *
 * Uses NFI branding and platforms, but does NOT connect to the live
 * portal, HubSpot lead form, Slack, or real review sites. Review links open
 * the local sandbox. /api/notify and /api/upload-video are stubbed in demo.js;
 * /api/agent still talks to the real Reputation Rocket assistant for a live chat.
 *
 * HubSpot form IDs are intentionally omitted so the lead-capture modal never appears.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'nfi-demo',
  providerName: 'National Fatherhood Initiative',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['trustpilot', 'greatnonprofits'],
  reviewLinks: {
    trustpilot: 'review-sandbox.html?platform=trustpilot&company=National%20Fatherhood%20Initiative',
    greatnonprofits: 'review-sandbox.html?platform=greatnonprofits&company=National%20Fatherhood%20Initiative',
  },
  welcomeVideoUrl: '/assets/video/Reputation Rocket Intro.mp4',
  welcomeVideoPoster: '/assets/image/7c248b618a126294316f6a.gif',
  interviewQuestions: [
    'Why did you choose National Fatherhood Initiative?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: false,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: [],
  supportEmail: 'demo@fatherhood.example',
};
