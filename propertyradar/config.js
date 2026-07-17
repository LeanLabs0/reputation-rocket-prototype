window.CLIENT_CONFIG = {
  clientSlug: 'propertyradar',
  providerName: 'PropertyRadar',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['g2', 'trustpilot'],
  reviewLinks: {
    // TODO: fill in PropertyRadar free-version G2 write-review URL (from Jonathan/Sean)
    g2: '',
    // TODO: fill in PropertyRadar Trustpilot review URL (from Jonathan/Sean)
    trustpilot: '',
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
