window.CLIENT_CONFIG = {
  clientSlug: 'eimmigration',
  providerName: 'EImmigration',
  company: 'EImmigration',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['hubspot', 'g2', 'google'],
  reviewLinks: {
    hubspot: 'https://ecosystem.hubspot.com/marketplace/solutions/lean-labs',
    g2: 'https://www.g2.com/products/lean-labs/take_survey',
    google: 'https://g.page/lean-abs/review',
  },
  welcomeVideoUrl: '',
  videoUrl: 'https://testimonial.to/lean-labs',
  thankYouUrl: 'https://leanlabs.com/reputation-rocket/thanks',
  allowedRedirectHosts: ['get.eimmigration.com', 'www.get.eimmigration.com'],
  /**
   * Tokens from Figma eImmigration file (variables: Typography/primary-font Inter,
   * body-font Nokora; Primary #0099FF; Secondary #00CAB0; Tertiary #A643F2;
   * Heading #1D2E4E; Body #2A3E70; Neutral/Blue #F0F9FF; button radius 5px;
   * Sm Shadow / SM Card elevation).
   */
  theme: {
    fontFamily:
      "'Inter', 'Nokora', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    googleFontQuery: 'Inter:wght@400;500;600;700&family=Nokora:wght@400;700',
    headingColor: '#1D2E4E',
    bodyColor: 'rgba(42, 62, 112, 0.82)',
    mutedColor: '#6B7A99',
    primary: '#0099FF',
    primaryDark: '#007ACC',
    accent: '#00CAB0',
    pageBackground:
      'radial-gradient(ellipse 90% 72% at 50% 0%, rgb(240, 249, 255) 0%, rgb(255, 255, 255) 45%, rgb(248, 248, 248) 100%)',
    navBackground: 'transparent',
    stepperGradient: 'linear-gradient(270deg, rgb(240, 249, 255) -40%, rgb(255, 255, 255) 38%)',
    stepperShadow: '8px 8px 30px rgba(29, 46, 78, 0.08)',
    stepperRadius: '12px',
    brandGradient:
      'radial-gradient(120% 120% at 78% 18%, rgb(29, 46, 78) 0%, rgb(21, 34, 56) 52%, rgb(15, 26, 46) 100%)',
    brandBorder: '#152338',
    gradient: 'linear-gradient(135deg, #A643F2 0%, #0099FF 52%, #62BEFB 100%)',
    primaryButtonStyle: 'gradient',
    buttonRadius: '5px',
    cardRadiusChat: '12px',
    purpleTint: 'rgba(0, 153, 255, 0.11)',
    purpleBorder: 'rgba(0, 153, 255, 0.24)',
    chatMessageArea: '#F0F9FF',
    chatMessageAvatarBg: 'rgba(0, 153, 255, 0.1)',
    pendingBadgeBg: '#F8F8F8',
    pendingBadgeText: '#6B7A99',
    activeBadgeBg: 'rgba(0, 153, 255, 0.14)',
    activeBadgeText: '#008AE6',
    doneBadgeBg: 'rgba(0, 202, 176, 0.15)',
    doneBadgeText: '#009B8A',
    starGradientStops: ['#A643F2', '#0099FF', '#62BEFB'],
  },
};
