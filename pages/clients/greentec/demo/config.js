/*
 * Greentec walkthrough demo — at /greentec/demo/.
 *
 * Uses Greentec branding and platforms, but does NOT connect to the live
 * portal, HubSpot lead form, Slack, or real review sites. Review links open
 * the local sandbox. /api/notify and /api/upload-video are stubbed in demo.js;
 * /api/agent still talks to the real Reputation Rocket assistant for a live chat.
 *
 * HubSpot form IDs are intentionally omitted so the lead-capture modal never appears.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'gt-demo',
  providerName: 'Greentec',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['trustpilot', 'gartner'],
  reviewLinks: {
    trustpilot: 'review-sandbox.html?platform=trustpilot&company=Greentec',
    gartner: 'review-sandbox.html?platform=gartner&company=Greentec',
  },
  welcomeVideoUrl: '/assets/video/Reputation Rocket Intro.mp4',
  welcomeVideoPoster: '/assets/image/7c248b618a126294316f6a.gif',
  interviewQuestions: [
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: true,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: [],
  supportEmail: 'demo@greentec.example',
};
