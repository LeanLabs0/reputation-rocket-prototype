window.CLIENT_CONFIG = {
  clientSlug: 'katapult',
  providerName: 'Katapult Engineering',
  company: 'Katapult Engineering',
  agentEndpoint: '/api/agent',
  notificationEndpoint: '/api/notify',
  platforms: ['hubspot', 'g2', 'google'],
  reviewLinks: {
    hubspot: 'https://ecosystem.hubspot.com/marketplace/solutions/katapult-engineering',
    g2: 'https://www.g2.com/products/katapult-engineering/take_survey',
    google: 'https://g.page/katapult-engineering/review',
  },
  welcomeVideoUrl: '',
  videoUrl: 'https://testimonial.to/katapult-engineering',
  thankYouUrl: 'https://katapultengineering.com/reputation-rocket/thanks',
  allowedRedirectHosts: ['katapultengineering.com', 'www.katapultengineering.com'],
  /**
   * Katapult Figma tokens (file XNgYG13UR0MOKDiF5aTIHA): heading-font DM Sans 600,
   * body Inter; Primary #FF8300; Secondary #007299; Heading #003E51; Body #717271;
   * Neutral/Light #F5F7FA; Supporting/6 #4AC5E0; Supporting/2 #003647; input radius 6px.
   */
  theme: {
    fontFamily:
      "'Inter', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    googleFontQuery: 'Inter:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700',
    headingColor: '#003E51',
    bodyColor: 'rgba(113, 114, 113, 0.92)',
    mutedColor: '#8A8C8B',
    primary: '#FF8300',
    primaryDark: '#E57200',
    accent: '#007299',
    pageBackground:
      'radial-gradient(ellipse 92% 75% at 50% 0%, rgb(245, 247, 250) 0%, rgb(255, 255, 255) 48%, rgb(238, 241, 244) 100%)',
    navBackground: 'transparent',
    stepperGradient: 'linear-gradient(270deg, rgba(0, 62, 81, 0.07) -35%, rgb(255, 255, 255) 42%)',
    stepperShadow: '8px 12px 32px rgba(0, 62, 81, 0.09)',
    stepperRadius: '14px',
    brandGradient:
      'radial-gradient(120% 120% at 82% 18%, rgb(0, 54, 71) 0%, rgb(0, 62, 81) 48%, rgb(0, 42, 56) 100%)',
    brandBorder: '#002A38',
    gradient: 'linear-gradient(135deg, #FF8300 0%, #FFA64D 42%, #4AC5E0 100%)',
    primaryButtonStyle: 'solid',
    buttonRadius: '6px',
    cardRadiusChat: '14px',
    purpleTint: 'rgba(255, 131, 0, 0.12)',
    purpleBorder: 'rgba(255, 131, 0, 0.28)',
    chatMessageArea: '#F5F7FA',
    chatMessageAvatarBg: 'rgba(0, 114, 153, 0.09)',
    pendingBadgeBg: '#EEF1F4',
    pendingBadgeText: '#717271',
    activeBadgeBg: 'rgba(255, 131, 0, 0.16)',
    activeBadgeText: '#CC6600',
    doneBadgeBg: 'rgba(0, 114, 153, 0.12)',
    doneBadgeText: '#007299',
    starGradientStops: ['#FF8300', '#4AC5E0', '#007299'],
  },
};
