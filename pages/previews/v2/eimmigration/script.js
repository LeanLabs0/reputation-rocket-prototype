/*
 * V2 preview script for eimmigration. Data only, read by ../preview.js.
 *
 * "Our words" come from eimmigration's own site and AEO work, not from us:
 * - category and capabilities: get.eimmigration.com /capabilities pages
 *   (immigration law software, case management, form management, client portal)
 * - buyer pages: Attorneys, Paralegals, Law Firms, Non-Profits, Corporations
 * - competitors: DocketWise and BlueDot (comparison post), LollyLaw (sales notes, 7/30)
 * - results: the same /capabilities pages ("manage more cases with less
 *   effort", "see the status of every case at a glance", "auto-populate
 *   related forms", "errors and rejections", "file directly to government
 *   portals", faster client intake, "keep clients informed", "simplify billing")
 * The V1 evidence is anonymized and paraphrased. No customer names, emails,
 * organizations or verbatim answers.
 *
 * Preview 2 (10/16 review): who the customer is comes first, then what they
 * use it for, where they see results, and a rating for each of those
 * results. Choices sit inside the chat. No "what would you call it" step;
 * the headline category comes from the services they pick.
 */
window.V2_PREVIEW = {
  slug: 'eimmigration',
  company: 'eimmigration',
  logo: '/pages/clients/eimmigration/logo.png',
  theme: '/pages/clients/eimmigration/styles.css',
  platforms: ['gartner', 'g2', 'trustpilot'],
  personaLabel: 'Sample customer: a nonprofit immigration legal services team',
  bestForWho: 'teams',

  draftsReady: "Thanks so much for sharing.\n\nThese drafts are a preview of the reviews. You can read and edit them here. Nothing is published or sent.",

  inlineChoices: true,
  // Same welcome as the live portal since 10/20: the step bar sits under
  // Get Started until the chat starts.
  progressBelowWelcome: true,

  // Under 5 stars (decided 10/22): the customer finishes the chat so the team
  // knows what to fix, but gets no drafts or review links. The review is
  // saved and eimmigration reaches out first. The chat ends on the live
  // "Thank you for your honesty" screen.
  lowRating: {
    below: 5,
    gate: true,
    ask: "Thanks for being honest. Before anything gets posted, we'll save your review. We'd really like to reach out and figure out what we need to solve to get you all the way to 5 stars. Is that OK?",
    options: [
      { id: 'yes', label: 'Yes, reach out to me', reply: 'Thank you. A few more questions so we know where to start.' },
      { id: 'no', label: 'No thanks', reply: 'No problem. A few more questions so the team knows what to fix.' },
    ],
    saved: "Thanks for sharing. We saved your review, and someone from eimmigration will reach out before anything gets posted.",
  },

  steps: [
    {
      id: 'orgType', type: 'single', slot: 'Y', skip: true, ownWords: false,
      ask: 'Thanks for helping other teams find the right immigration software. First, which best describes your organization?',
      options: [
        { id: 'nonprofit', label: 'Nonprofit immigration legal services', phrase: 'a nonprofit immigration legal services team', plural: 'nonprofit immigration legal teams', terms: ['nonprofit'] },
        { id: 'solo', label: 'Solo immigration attorney', phrase: 'a solo immigration practice', plural: 'solo immigration attorneys', terms: ['solo immigration'] },
        { id: 'small-firm', label: 'Immigration law firm, 2 to 10 attorneys', phrase: 'a small immigration law firm', plural: 'small immigration law firms', terms: ['immigration law firm'] },
        { id: 'large-firm', label: 'Immigration law firm, 11 or more attorneys', phrase: 'a larger immigration law firm', plural: 'larger immigration law firms', terms: ['immigration law firm'] },
        { id: 'corporate', label: 'Corporate immigration team', phrase: 'a corporate immigration team', plural: 'corporate immigration teams', terms: ['corporate immigration'] },
      ],
    },
    {
      id: 'before', type: 'single', slot: 'Z', skip: true, ownWords: true,
      ask: 'What were you using before eimmigration?',
      options: [
        { id: 'spreadsheets', label: 'Spreadsheets or paper files', phrase: 'spreadsheets or paper files', terms: ['spreadsheets'], bestAs: 'switching from spreadsheets' },
        { id: 'docketwise', label: 'DocketWise', phrase: 'DocketWise', terms: ['docketwise'], bestAs: 'switching from DocketWise' },
        { id: 'lollylaw', label: 'LollyLaw', phrase: 'LollyLaw', terms: ['lollylaw'], bestAs: 'switching from LollyLaw' },
        { id: 'bluedot', label: 'BlueDot', phrase: 'BlueDot', terms: ['bluedot'], bestAs: 'switching from BlueDot' },
        { id: 'other-software', label: 'Another immigration software', phrase: 'another immigration software', terms: ['another immigration software'], bestAs: 'switching from another tool' },
        { id: 'first', label: 'Nothing, this is our first system', firstSystem: true, terms: [] },
      ],
    },
    {
      id: 'pain', type: 'multi', slot: 'Z', min: 0, skip: true, ownWords: true,
      ask: 'What problems did you need solved? Pick all that apply.',
      options: [
        { id: 'retyping', label: 'Re-typing the same client information', phrase: 're-typing the same client information on every form', terms: ['re-typing'], bestAs: 'with no more re-typing client data' },
        { id: 'deadlines', label: 'Tracking deadlines and case status', phrase: 'keeping track of deadlines and case status', terms: ['case status'], bestAs: 'with deadline and case status tracking' },
        { id: 'forms-time', label: 'Too much time on USCIS forms', phrase: 'the time it took to prepare USCIS forms', terms: ['prepare uscis forms'], bestAs: 'with faster USCIS forms' },
        { id: 'funders', label: 'Reporting to funders or grants', phrase: 'reporting to funders or grant programs', terms: ['funders', 'grant'], bestAs: 'with funder reporting' },
        { id: 'budget', label: 'Staying within budget', phrase: 'staying within our budget', terms: ['budget'] },
      ],
    },
    {
      id: 'services', type: 'multi', slot: 'X', min: 1,
      ask: 'What does your team use eimmigration for? Pick all that apply.',
      ownWords: true,
      options: [
        { id: 'case-management', label: 'Immigration case management', phrase: 'immigration case management', terms: ['case management'], bestAs: 'immigration case management software' },
        { id: 'uscis-forms', label: 'Filling and e-filing USCIS forms', phrase: 'filling and e-filing USCIS forms', terms: ['uscis forms', 'e-filing'], bestAs: 'immigration forms software' },
        { id: 'intake', label: 'Client intake questionnaires', phrase: 'client intake questionnaires', terms: ['intake questionnaires'], bestAs: 'immigration client intake software' },
        { id: 'deadlines', label: 'Deadlines and reminders', phrase: 'tracking deadlines and reminders', terms: [] },
        { id: 'reports', label: 'Reports for funders or leadership', phrase: 'reports for our funders or leadership', terms: [] },
        { id: 'portal', label: 'Client portal and messaging', phrase: 'the client portal and messaging', terms: [] },
        { id: 'billing', label: 'Invoices and trust accounting', phrase: 'invoices and trust accounting', terms: [] },
      ],
    },
    {
      // Only the results tied to the services they picked (plus "time
      // saved"). `dim` is the short name the rating grid shows.
      id: 'outcomes', type: 'multi', min: 0, skip: true, ownWords: true, filterBy: 'services',
      ask: 'Where are you seeing results with eimmigration? Pick all that apply.',
      options: [
        { id: 'more-cases', for: ['case-management'], label: 'Handling more cases with less effort', dim: 'Handling more cases', phrase: 'handling more cases with less effort' },
        { id: 'status', for: ['case-management', 'deadlines'], label: "Seeing every case's status at a glance", dim: 'Case status at a glance', phrase: "seeing every case's status at a glance" },
        { id: 'deadlines', for: ['deadlines', 'case-management'], label: 'Staying on top of deadlines', dim: 'Staying on top of deadlines', phrase: 'staying on top of deadlines' },
        { id: 'autofill', for: ['uscis-forms', 'intake'], label: 'Forms that fill in from one client profile', dim: 'Form auto-fill', phrase: 'filling forms from one client profile' },
        { id: 'fewer-errors', for: ['uscis-forms'], label: 'Fewer form errors and rejections', dim: 'Cutting form errors', phrase: 'cutting form errors and rejections' },
        { id: 'efile', for: ['uscis-forms'], label: 'Filing straight to USCIS', dim: 'E-filing with USCIS', phrase: 'filing straight to USCIS' },
        { id: 'faster-intake', for: ['intake', 'portal'], label: 'Faster client intake', dim: 'Client intake speed', phrase: 'getting client intake done faster' },
        { id: 'informed', for: ['portal'], label: 'Clients kept in the loop', dim: 'Keeping clients informed', phrase: 'keeping clients in the loop' },
        { id: 'reports', for: ['reports'], label: 'Reports that are quick to pull', dim: 'Pulling reports', phrase: 'pulling reports quickly' },
        { id: 'billing', for: ['billing'], label: 'Simpler billing', dim: 'Billing', phrase: 'keeping billing simple' },
        { id: 'time', label: 'Time saved across the team', dim: 'Time saved', phrase: 'saving our team time' },
      ],
    },
    {
      // One row per result they picked above.
      id: 'grid', type: 'grid', dimsFrom: 'outcomes', skip: true,
      ask: 'How is eimmigration doing on each of these? 1 to 5.',
    },
    {
      id: 'rating', type: 'stars', skip: true,
      ask: 'Are you happy with your overall experience? Would you be willing to rate it 5 stars for this review?',
    },
    {
      id: 'result', type: 'text', required: false, skipLabel: 'Skip',
      ask: 'What has changed for your team since you started using eimmigration? An example or a number helps.',
      sample: 'Our caseworkers enter a client once and every form fills itself, so we close cases faster and spend far less time on paperwork.',
    },
    {
      id: 'recommend', type: 'single', skip: true,
      ask: 'Would you recommend eimmigration to a team like yours?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'not-sure', label: 'Not sure yet' },
        { id: 'no', label: 'No' },
      ],
    },
    {
      id: 'improve', type: 'text', required: false, skipLabel: 'Nothing to add',
      ask: 'Is there anything we could improve or do better?',
      sample: '',
    },
  ],

  templates: {
    services: ['We use {co} for {services}.', 'Our team uses {co} for {services}.', '{co} is what we use for {services}.'],
    outcomes: ['{co} has helped with {outcomes}.', 'Where we see results is {outcomes}.', 'We see the results in {outcomes}.'],
    who: ["We're {org}.", "For context, we're {org}."],
    before: ['Before {co}, we were using {before}.', 'We switched to {co} from {before}.', 'We moved over to {co} from {before}.'],
    beforeOwn: ['Before {co}, we were using {beforeOwn}.', 'We switched to {co} from {beforeOwn}.'],
    firstSystem: ['{co} is the first system our team has used for this.'],
    pain: ['We needed help with {pain}.', 'We were struggling with {pain}.'],
    painOwn: ['Our main problem was {painOwn}.'],
    standout: ['{dim} has been the standout for us.', '{dim} stands out.'],
    strongOne: ['{dims} has been strong for us.'],
    strongMany: ['{dims} have been strong for us.'],
    low: ['{lowDim} could be better.'],
    recommendYes: ["I'd recommend {co} to other {orgPlural}.", "I'd recommend {co} to teams like ours."],
    recommendNotSure: ["I'm not sure yet whether I'd recommend {co} to other {orgPlural}.", "I'm not sure yet whether I'd recommend {co}."],
    recommendNo: ["I wouldn't recommend {co} to other {orgPlural} right now.", "I wouldn't recommend {co} right now."],
    nothingToAdd: ['Nothing to add right now.'],
    headlineCategory: ['{categoryCap} for {orgPlural}'],
    headlineService: ['{co} for {firstService}'],
  },

  persona: {
    orgType: 'nonprofit',
    before: 'spreadsheets',
    pain: ['retyping', 'funders'],
    services: ['case-management', 'uscis-forms', 'reports'],
    outcomes: ['autofill', 'status', 'reports'],
    grid: { all: { 'Form auto-fill': 5, 'Case status at a glance': 5, 'Pulling reports': 4 } },
    rating: 5,
    result: 'Our caseworkers enter a client once and every form fills itself, so we close cases faster and spend far less time on paperwork.',
    recommend: 'yes',
    improve: '',
  },

  v1: {
    label: 'V1, live today',
    questions: [
      'How would you rate your overall experience working with eimmigration? (1 being poor, 5 being excellent)',
      'What was your primary goal when you started working with eimmigration?',
      'A follow-up on results',
      'What would you tell another business owner considering eimmigration?',
      'Is there any area where we could remove friction or improve the experience?',
    ],
    sampleTitle: 'What a real nonprofit customer told V1 (paraphrased)',
    sampleAnswers: [
      'Entering client profiles and filling out forms is easy.',
      'It made everything much easier, and each case takes less time than before.',
      "It's a very good data system. Forms fill out easily and update to new form editions on their own.",
    ],
    scoreCaption: "Scored on this customer's V1 answers.",
    sampleNote: "V1 drafts can only use what the customer says. Nothing here names the category, says they're a nonprofit or says what they used before.",
    published: null,
    stats: [
      { big: '0 of 12', text: 'nonprofit customers said "nonprofit" in their V1 answers' },
      { big: '4 of 27', text: 'V1 interviews named the category (case management or immigration software)' },
      { big: '0 of 27', text: 'named a competitor they switched from. 3 of 27 mentioned switching at all' },
      { big: '1 of 11', text: 'September Trustpilot reviews says "immigration software". None says nonprofit' },
    ],
    statsSource: '27 real V1 sessions (Aug to Oct 2026), scored with a script. 11 September Trustpilot reviews, read 10/16.',
  },
};
