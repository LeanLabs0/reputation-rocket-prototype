window.CLIENT_CONFIG = {
  clientSlug: 'lean-labs',
  providerName: 'Lean Labs',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['hubspot', 'g2', 'google'],
  reviewLinks: {
    hubspot: 'https://hubspot.com/lean-labs/review',
    g2: 'https://www.g2.com/products/lean-labs/take-survey',
    google: 'https://g.page/lean-abs/review',
  },
  welcomeVideoUrl: '',
  videoCaptureEnabled: true,
  thankYouUrl: 'https://leanlabs.com/reputation-rocket/thanks',
  allowedRedirectHosts: ['leanlabs.com', 'www.leanlabs.com'],
  /** Receives plain-text negative alert (same content as Slack) when RESEND_API_KEY is set on the server. */
  supportEmail: '',
  /** Optional: HubSpot embedded lead form when `name` and `email` are not in the URL (see app.js). */
  hubspotPortalId: '275827',
  hubspotFormId: '102ade8e-7204-41f9-80a0-6a5808c71089',
  hubspotFormRegion: 'na1',
  /** Optional: override visual defaults from app.js (`DEFAULT_CLIENT_THEME`). */
  theme: {},
};
