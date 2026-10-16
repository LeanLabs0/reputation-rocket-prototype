/*
 * V2 preview script for eimmigration. Data only, read by ../preview.js.
 *
 * "Our words" come from eimmigration's own site and AEO work, not from us:
 * - category and capabilities: get.eimmigration.com /capabilities pages
 *   (immigration law software, case management, form management, client portal)
 * - buyer pages: Attorneys, Paralegals, Law Firms, Non-Profits, Corporations
 * - competitors: DocketWise and BlueDot (comparison post), LollyLaw (sales notes, 7/30)
 * The V1 evidence is anonymized and paraphrased. No customer names, emails,
 * organizations or verbatim answers.
 */
window.V2_PREVIEW = {
  slug: 'eimmigration',
  company: 'eimmigration',
  logo: '/pages/clients/eimmigration/logo.png',
  theme: '/pages/clients/eimmigration/styles.css',
  platforms: ['gartner', 'g2', 'trustpilot'],
  personaLabel: 'Sample customer: a nonprofit immigration legal services team',
  bestForWho: 'teams',

  welcome: {
    title: 'V2: reviews that say what eimmigration is and who it is for',
    body: 'Same chat, a few extra taps. We ask what the customer uses eimmigration for, who they are and what they used before, so the review they post names the category, the buyer and the problem it solved.',
  },
  draftsReady: "Thanks so much for sharing.\n\nThese drafts are a preview of the reviews. You can read and edit them here. Nothing is published or sent.",

  steps: [
    {
      id: 'services', type: 'multi', slot: 'X', min: 1, max: 3,
      ask: 'Thanks for helping other teams find the right immigration software. First, what does your team use eimmigration for? Pick up to three.',
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
      id: 'grid', type: 'grid', perService: false, skip: true,
      ask: 'Quick ratings, 1 to 5. How is eimmigration on each of these?',
      dims: ['Ease of use', 'Customer support', 'Value for money'],
    },
    {
      id: 'rating', type: 'stars', skip: true,
      ask: 'How would you rate your overall experience working with eimmigration? (1 being poor, 5 being excellent)',
    },
    {
      id: 'orgType', type: 'single', slot: 'Y', skip: true, ownWords: false,
      ask: 'Which best describes your organization?',
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
      id: 'pain', type: 'multi', slot: 'Z', max: 2, min: 0, skip: true, ownWords: true,
      ask: 'What was the main problem you needed solved? Pick up to two.',
      options: [
        { id: 'retyping', label: 'Re-typing the same client information', phrase: 're-typing the same client information on every form', terms: ['re-typing'], bestAs: 'with no more re-typing client data' },
        { id: 'deadlines', label: 'Tracking deadlines and case status', phrase: 'keeping track of deadlines and case status', terms: ['case status'], bestAs: 'with deadline and case status tracking' },
        { id: 'forms-time', label: 'Too much time on USCIS forms', phrase: 'the time it took to prepare USCIS forms', terms: ['prepare uscis forms'], bestAs: 'with faster USCIS forms' },
        { id: 'funders', label: 'Reporting to funders or grants', phrase: 'reporting to funders or grant programs', terms: ['funders', 'grant'], bestAs: 'with funder reporting' },
        { id: 'budget', label: 'Staying within budget', phrase: 'staying within our budget', terms: ['budget'] },
      ],
    },
    {
      id: 'result', type: 'text', required: false, skipLabel: 'Skip',
      ask: 'What has changed for your team since you started using eimmigration? An example or a number helps.',
      sample: 'Our caseworkers enter a client once and every form fills itself, so we close cases faster and spend far less time on paperwork.',
    },
    {
      id: 'category', type: 'single', slot: 'X', skip: true, ownWords: true,
      ask: 'If a colleague asked what eimmigration is, what would you call it?',
      options: [
        { id: 'cm-software', label: 'Immigration case management software', phrase: 'immigration case management software', terms: ['immigration case management software'], bestAs: 'immigration case management software' },
        { id: 'law-software', label: 'Immigration law software', phrase: 'immigration law software', terms: ['immigration law software'], bestAs: 'immigration law software' },
        { id: 'forms-software', label: 'Immigration forms software', phrase: 'immigration forms software', terms: ['immigration forms software'], bestAs: 'immigration forms software' },
      ],
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
    category: ["I'd describe {co} as {category}.", 'For us, {co} is {category}.'],
    recommendYes: ["I'd recommend {co} to other {orgPlural}.", "I'd recommend {co} to teams like ours."],
    recommendNotSure: ["I'm not sure yet whether I'd recommend {co} to other {orgPlural}.", "I'm not sure yet whether I'd recommend {co}."],
    recommendNo: ["I wouldn't recommend {co} to other {orgPlural} right now.", "I wouldn't recommend {co} right now."],
    nothingToAdd: ['Nothing to add right now.'],
    headlineCategory: ['{categoryCap} for {orgPlural}'],
    headlineService: ['{co} for {firstService}'],
  },

  persona: {
    services: ['case-management', 'uscis-forms', 'reports'],
    grid: { all: { 'Ease of use': 5, 'Customer support': 5, 'Value for money': 4 } },
    rating: 5,
    orgType: 'nonprofit',
    before: 'spreadsheets',
    pain: ['retyping', 'funders'],
    result: 'Our caseworkers enter a client once and every form fills itself, so we close cases faster and spend far less time on paperwork.',
    category: 'cm-software',
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
