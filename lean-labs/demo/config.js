/*
 * Demo portal config — at /lean-labs/demo/ (legacy /demo redirects here).
 * Everything here is fictional: the company "Acme Co", the review platforms,
 * and the links (which open the local review-sandbox page). demo.js intercepts
 * side-effecting /api/* calls; the chat still uses the real agent. HubSpot form
 * IDs are intentionally omitted so the lead-capture form never appears.
 */
window.CLIENT_CONFIG = {
  clientSlug: 'demo',
  providerName: 'Acme Co',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['google', 'g2', 'trustpilot'],
  reviewLinks: {
    google: 'review-sandbox.html?platform=google',
    g2: 'review-sandbox.html?platform=g2',
    trustpilot: 'review-sandbox.html?platform=trustpilot',
  },
  welcomeVideoUrl: '',
  welcomeVideoPoster: '',
  interviewQuestions: [
    'Why did you choose Acme Co?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: true,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: [],
  supportEmail: 'hello@acme.example',
  /*
   * Visual theming is CSS-driven (defaults in ../../styles.css :root; demo tweaks
   * in ./styles.css). config.js is data only.
   */
};
