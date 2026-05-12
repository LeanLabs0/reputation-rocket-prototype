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
  videoUrl: 'https://testimonial.to/lean-labs',
  thankYouUrl: 'https://leanlabs.com/reputation-rocket/thanks',
  allowedRedirectHosts: ['leanlabs.com', 'www.leanlabs.com'],
  supportEmail: 'help@leanlabs.com',
  /**
   * Embedded HubSpot form when the page has no name+email in the query string.
   * Use the portal ID, form ID, and region from your form’s embed code in HubSpot.
   */
  hubspotPortalId: '275827',
  hubspotFormId: '102ade8e-7204-41f9-80a0-6a5808c71089',
  hubspotFormRegion: 'na1',
  /** Optional: overrides for tokens in app.js `DEFAULT_CLIENT_THEME` (Lean Labs Figma baseline). */
};