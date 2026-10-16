/*
 * V2 preview script for Lean Labs. Data only, read by ../preview.js.
 *
 * "Our words" sources:
 * - the 10/14 voice memo: "AI ready website", "AEO website for HubSpot",
 *   "answer engine optimization agency", "AEO strategy"
 * - Lean Labs 2026 homepage services: Answer Engine Optimization, Website
 *   Redesign and Migrations, Growth-Driven Design, HubSpot Projects
 * - target prompts, e.g. "Best answer engine optimization agencies with
 *   HubSpot integration", "best GDD agency for SaaS companies in HubSpot"
 * The sample customer is made up. The V1 card is one real client session,
 * paraphrased, with no names, emails, or contact details.
 */
window.V2_PREVIEW = {
  slug: 'lean-labs',
  company: 'Lean Labs',
  logo: '/pages/clients/lean-labs/logo.svg',
  theme: '/pages/clients/lean-labs/styles.css',
  platforms: ['hubspot', 'g2'],
  personaLabel: 'Sample customer: a marketing leader at an industrial company',
  bestForWho: 'companies',

  draftsReady: '',

  steps: [
    {
      id: 'services', type: 'multi', slot: 'X', min: 1, max: 3,
      ask: 'Thanks for doing this. First, what did you work with Lean Labs on? Pick up to three.',
      ownWords: true,
      options: [
        { id: 'aeo', label: 'Answer engine optimization (AEO)', phrase: 'answer engine optimization (AEO)', short: 'AEO program', terms: ['answer engine optimization'], bestAs: 'answer engine optimization agency' },
        { id: 'aeo-website', label: 'AEO website for HubSpot', phrase: 'an AEO website for HubSpot', short: 'AEO website', terms: ['aeo website'], bestAs: 'AEO website agency for HubSpot' },
        { id: 'ai-ready', label: 'AI-ready website', phrase: 'an AI-ready website', short: 'website', terms: ['ai-ready website'], bestAs: 'AI-ready website agency' },
        { id: 'aeo-strategy', label: 'AEO strategy', phrase: 'our AEO strategy', short: 'AEO strategy', terms: ['aeo strategy'], bestAs: 'AEO strategy agency' },
        { id: 'gdd', label: 'Growth-driven design', phrase: 'growth-driven design', short: 'growth-driven design work', terms: ['growth-driven design'], bestAs: 'growth-driven design agency' },
        { id: 'migration', label: 'HubSpot website migration', phrase: 'a HubSpot website migration', short: 'migration', terms: ['hubspot website migration'], bestAs: 'HubSpot website migration agency' },
      ],
    },
    {
      id: 'grid', type: 'grid', perService: true, maxServices: 3, skip: true,
      ask: 'How did Lean Labs do on the {service}? (1 being poor, 5 being excellent)',
      dims: ['Strategy', 'Delivery', 'Communication'],
    },
    {
      id: 'rating', type: 'stars', skip: true,
      ask: 'Overall, how would you rate your experience working with Lean Labs? (1 being poor, 5 being excellent)',
    },
    {
      id: 'role', type: 'single', slot: 'Y', skip: true,
      ask: 'Which best describes your role?',
      options: [
        { id: 'marketing-leader', label: 'Marketing leader (CMO, VP, Director)', phrase: 'a marketing leader', terms: [] },
        { id: 'founder', label: 'Founder', phrase: 'a founder', terms: [] },
        { id: 'ceo', label: 'CEO', phrase: 'the CEO', terms: [] },
        { id: 'marketing-manager', label: 'Marketing manager', phrase: 'a marketing manager', terms: [] },
        { id: 'revops-manager', label: 'RevOps manager', phrase: 'a RevOps manager', terms: [] },
        { id: 'sales-leader', label: 'Sales leader', phrase: 'a sales leader', terms: [] },
      ],
    },
    {
      id: 'industry', type: 'single', slot: 'Y', skip: true,
      ask: 'What kind of company are you?',
      options: [
        { id: 'b2b-saas', label: 'B2B SaaS', phrase: 'a B2B SaaS company', plural: 'B2B SaaS companies', terms: ['b2b saas'] },
        { id: 'startup', label: 'Tech startup', phrase: 'a tech startup', plural: 'tech startups', terms: ['startup'] },
        { id: 'industrial', label: 'Industrial', phrase: 'an industrial company', plural: 'industrial companies', terms: ['industrial'] },
        { id: 'b2b-services', label: 'B2B services', phrase: 'a B2B services company', plural: 'B2B services companies', terms: ['b2b services'] },
        { id: 'pro-services', label: 'Professional services', phrase: 'a professional services firm', plural: 'professional services firms', terms: ['professional services'] },
      ],
    },
    {
      id: 'before', type: 'single', slot: 'Z', skip: true, ownWords: true,
      ask: 'Before Lean Labs, who handled your website and marketing?',
      options: [
        { id: 'another-agency', label: 'Another agency', phrase: 'another agency ran our site', terms: ['another agency'], bestAs: 'switching from another agency' },
        { id: 'in-house', label: 'Our in-house team', phrase: 'our in-house team ran the site', terms: ['in-house team'], bestAs: 'switching from an in-house build' },
        { id: 'diy', label: 'We did it ourselves in HubSpot', phrase: 'we managed the site ourselves in HubSpot', terms: ['ourselves in hubspot'] },
        { id: 'new', label: 'Nobody, this was new', firstSystem: true, terms: [] },
      ],
    },
    {
      id: 'pain', type: 'multi', slot: 'Z', max: 2, min: 0, skip: true, ownWords: true,
      ask: 'What was the main problem you needed solved? Pick up to two.',
      options: [
        { id: 'ai-answers', label: 'Not showing up in AI answers (ChatGPT, Google AI)', phrase: "not showing up in AI answers like ChatGPT and Google's AI Overviews", terms: ['ai answers', 'ai search'], bestAs: 'with visibility in AI answers' },
        { id: 'pipeline', label: "Website wasn't generating pipeline", phrase: "a website that wasn't generating pipeline", terms: ['pipeline'], bestAs: 'with a website that builds pipeline' },
        { id: 'hard-update', label: 'Site was hard to update', phrase: 'a site that was hard to update', terms: ['hard to update'] },
        { id: 'no-aeo-plan', label: 'No plan for AEO', phrase: 'having no plan for AEO', terms: ['plan for aeo'] },
      ],
    },
    {
      id: 'result', type: 'text', required: false, skipLabel: 'Skip',
      ask: 'What changed after working with Lean Labs? A number or a moment you remember helps.',
      sample: 'The new pages explain what we do clearly, and buyers are starting to find us when they ask AI tools about our services.',
    },
    {
      id: 'category', type: 'single', slot: 'X', skip: true, ownWords: true,
      ask: 'If a peer asked what kind of company Lean Labs is, what would you call it?',
      options: [
        { id: 'aeo-agency', label: 'An answer engine optimization agency', phrase: 'an answer engine optimization agency', terms: ['answer engine optimization agency'], bestAs: 'answer engine optimization agency' },
        { id: 'hubspot-agency', label: 'A HubSpot website agency', phrase: 'a HubSpot website agency', terms: ['hubspot website agency'], bestAs: 'HubSpot website agency' },
        { id: 'growth-agency', label: 'A B2B growth agency', phrase: 'a B2B growth agency', terms: ['growth agency'], bestAs: 'B2B growth agency' },
      ],
    },
    {
      id: 'recommend', type: 'single', skip: true,
      ask: 'Would you recommend Lean Labs to a company like yours?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'not-sure', label: 'Not sure yet' },
        { id: 'no', label: 'No' },
      ],
    },
    {
      id: 'improve', type: 'text', required: false, skipLabel: 'Nothing to add',
      ask: 'Is there anything we could improve or do better?',
      sample: 'Doing page edits over Slack was hard at first, but it got easier.',
    },
  ],

  templates: {
    services: ['We hired {co} for {services}.', '{co} handled {services} for us.', 'We brought {co} in for {services}.'],
    who: ["I'm {role} at {industry}.", "For context, I'm {role} at {industry}.", "We're {industry}.", "I'm {role}."],
    before: ['Before {co}, {before}.', 'Until we brought in {co}, {before}.'],
    beforeOwn: ['Before {co}, we worked with {beforeOwn}.'],
    firstSystem: ['This was our first project like this.'],
    pain: ['We needed help with {pain}.', 'We came to {co} for help with {pain}.'],
    painOwn: ['Our main problem was {painOwn}.'],
    standout: ['{dim} on the {service} was the standout.', 'The {service} stood out for {dimLower}.'],
    strongOne: ['{dims} on the {service} was strong.'],
    strongMany: ['{dims} on the {service} were strong.'],
    low: ['{lowDim} on the {lowService} could have been better.', '{lowDim} could have been better.'],
    category: ["I'd describe {co} as {category}.", 'For us, {co} is {category}.'],
    recommendYes: ["I'd recommend {co} to other {industryPlural}.", "I'd recommend {co} to companies like ours."],
    recommendNotSure: ["I'm not sure yet whether I'd recommend {co} to other {industryPlural}.", "I'm not sure yet whether I'd recommend {co}."],
    recommendNo: ["I wouldn't recommend {co} to other {industryPlural} right now.", "I wouldn't recommend {co} right now."],
    nothingToAdd: ['Nothing to add right now.'],
    headlineCategory: ['{categoryCap} for {industryPlural}'],
    headlineService: ['{co} for {firstService}'],
  },

  persona: {
    services: ['aeo-website', 'aeo'],
    grid: {
      'aeo-website': { Strategy: 5, Delivery: 5, Communication: 4 },
      aeo: { Strategy: 5, Delivery: 4, Communication: 4 },
    },
    rating: 5,
    role: 'marketing-leader',
    industry: 'industrial',
    before: 'another-agency',
    pain: ['ai-answers', 'pipeline'],
    result: 'The new pages explain what we do clearly, and buyers are starting to find us when they ask AI tools about our services.',
    category: 'aeo-agency',
    recommend: 'yes',
    improve: 'Doing page edits over Slack was hard at first, but it got easier.',
  },

  v1: {
    label: 'V1, live today',
    questions: [
      'How would you rate your overall experience working with Lean Labs? (1 being poor, 5 being excellent)',
      'What was your primary goal when you started working with Lean Labs?',
      'What specific improvements in revenue or sales metrics did you see after working with Lean Labs?',
      'What would you tell another business owner considering Lean Labs?',
      'Is there any area where we could remove friction or improve the experience? (totally optional)',
    ],
    sampleTitle: 'What a real client told V1 at their 10/14 launch (paraphrased)',
    sampleAnswers: [
      'We wanted more qualified traffic and more form submissions, and to show up where competitors beat us in Google search and AI search.',
      'We liked working with the team. We needed to pull out what makes us different, and it was exciting to go deep on the value we bring.',
      "We'd recommend them. They move fast, communication was strong and updates came on time.",
    ],
    scoreCaption: "Scored on this client's V1 answers. Their two real V1 drafts score the same.",
    sampleNote: 'V1 caught the goal and the praise. It never asked which service they bought, what kind of company they are or what they had before, so the drafts could not say it.',
    draftNotes: [
      "Both drafts lead with finding the client's differentiators, more qualified traffic and form submissions, and showing up in Google and AI search.",
      'Both praise the speed and the communication, and name two of our team members.',
      'The G2 draft says "no real complaints" in the dislike field. Nothing in their answers says that.',
      'Neither draft says which service they bought, what kind of company they are or what they had before.',
    ],
    published: null,
    stats: [
      { big: '0 of 5', text: 'V1 questions ask which service the client bought' },
      { big: '0 of 5', text: 'V1 questions ask who the client is or what they had before' },
      { big: '"no real complaints"', text: "is in the client's V1 G2 draft, but not in anything they said" },
      { big: '"business owner"', text: 'is how V1 frames the recommendation, for every client' },
    ],
    statsSource: 'V1 question script, plus one real client session from 10/14. Drafts and answers read 10/16 and paraphrased here.',
  },
};
