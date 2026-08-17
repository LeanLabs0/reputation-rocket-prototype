/*
 * PropertyRadar walkthrough demo — at /propertyradar/demo/.
 *
 * Uses PropertyRadar branding and platforms, but does NOT connect to the live
 * portal, HubSpot lead form, Slack, or real review sites. Review links open
 * the local sandbox. /api/notify and /api/upload-video are stubbed in demo.js;
 * /api/agent still talks to the real Reputation Rocket assistant for a live chat.
 *
 * HubSpot form IDs are intentionally omitted so the lead-capture modal never appears.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'pr-demo',
  providerName: 'PropertyRadar',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['g2', 'trustpilot'],
  reviewLinks: {
    g2: 'review-sandbox.html?platform=g2&company=PropertyRadar',
    trustpilot: 'review-sandbox.html?platform=trustpilot&company=PropertyRadar',
  },
  welcomeVideoUrl: '/assets/video/Reputation Rocket Intro.mp4',
  welcomeVideoPoster: '/assets/image/7c248b618a126294316f6a.gif',
  interviewQuestions: [
    'What do you use PropertyRadar for?',
    'What problem does PropertyRadar help you solve?',
    'What do you like most about PropertyRadar?',
    'What would you tell someone considering PropertyRadar?',
  ],
  videoCaptureEnabled: true,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: [],
  supportEmail: 'demo@propertyradar.example'
};
