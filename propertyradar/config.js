window.CLIENT_CONFIG = {
  clientSlug: 'propertyradar',
  providerName: 'PropertyRadar',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['g2', 'trustpilot'],
  reviewLinks: {
    g2: 'https://www.g2.com/products/propertyradar/reviews/start',
    trustpilot: 'https://www.trustpilot.com/evaluate/propertyradar.com',
  },
  welcomeVideoUrl: '',
  welcomeVideoPoster: '',
  interviewQuestions: [
    'Why did you choose PropertyRadar?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: false,
  thankYouUrl: '',
  thankYouRedirectDelayMs: 120000,
  allowedRedirectHosts: ['propertyradar.com', 'www.propertyradar.com'],
  supportEmail: 'edward@lean-labs.com',
};
