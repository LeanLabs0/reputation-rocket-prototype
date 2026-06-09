window.CLIENT_CONFIG = {
  clientSlug: 'lean-labs',
  providerName: 'Lean Labs',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['hubspot', 'g2', 'google'],
  reviewLinks: {
    hubspot: 'https://ecosystem.hubspot.com/marketplace/solutions/lean-labs',
    g2: 'https://www.g2.com/products/lean-labs/take_survey',
    google: 'https://g.page/lean-labs/review',
  },
  welcomeVideoUrl: '',
  /** Optional poster image shown before the welcome video plays (URL). */
  welcomeVideoPoster: '',
  /**
   * Interview questions for the video screen + record modal. Plain text only —
   * numbering and HTML markup are added automatically by the script. Add, edit,
   * or remove items freely. Omit/empty to fall back to the built-in defaults.
   */
  interviewQuestions: [
    'Why did you choose Lean Labs?',
    'What were you hoping to achieve?',
    'How did we deliver on your expectations?',
  ],
  videoCaptureEnabled: true,
  thankYouUrl: 'https://leanlabs.com/reputation-rocket/thank-you',
  /** Milliseconds on the in-app thank-you screen before redirecting to thankYouUrl (default 5s). */
  thankYouRedirectDelayMs: 5000,
  allowedRedirectHosts: ['leanlabs.com', 'www.leanlabs.com'],
  supportEmail: 'help@leanlabs.com',
  /**
   * Embedded HubSpot form when the page has no name+email in the query string.
   * Use the portal ID, form ID, and region from your form’s embed code in HubSpot.
   */
  hubspotPortalId: '275827',
  hubspotFormId: '102ade8e-7204-41f9-80a0-6a5808c71089',
  hubspotFormRegion: 'na1',
  /**
   * config.js is data only. Visual theming is CSS-driven:
   * defaults live in styles.css (:root); per-client overrides live in
   * <client>/styles.css (--ll-* tokens, @import font, #star-stop-* colors).
   */
};