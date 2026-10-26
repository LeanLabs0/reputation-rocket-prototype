/*
 * V3 preview script for eimmigration. Data only, read by ../preview.js.
 *
 * "Our words" come from eimmigration's own site and AEO work, not from us:
 * - category and capabilities: get.eimmigration.com /capabilities pages
 *   (immigration law software, case management, form management, client portal)
 * - buyer pages: Attorneys, Paralegals, Law Firms, Non-Profits, Corporations
 * - competitors: DocketWise and BlueDot (comparison post), LollyLaw (sales notes, 7/30)
 * The V1 evidence is anonymized and paraphrased. No customer names, emails,
 * organizations or verbatim answers.
 *
 * V3 (10/26 review): the taps were close to ideal, but V2 drafts read like a
 * machine wrote them. So V3 keeps three quick taps (who they are, what they
 * had before, what they use it for), asks whether they'd publish a 5-star
 * review, then asks open questions so the review is in their words. The
 * drafts use their answers as the body and add one sentence of ours at most.
 */
window.V2_PREVIEW = {
  slug: 'eimmigration',
  company: 'eimmigration',
  versionLabel: 'V3',
  draftStyle: 'their-words',
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
      // Any number of picks. The draft names two at most, starting with the
      // ones their own answers talk about (`keywords`), so ticking every box
      // still reads like a person wrote it.
      id: 'services', type: 'multi', slot: 'X', min: 1,
      ask: 'What does your team use eimmigration for? Pick all that apply.',
      ownWords: true,
      options: [
        { id: 'case-management', label: 'Immigration case management', phrase: 'case management', terms: ['case management'], keywords: ['case'], bestAs: 'immigration case management software' },
        { id: 'uscis-forms', label: 'Filling and e-filing USCIS forms', phrase: 'USCIS forms', terms: ['uscis forms', 'e-filing'], keywords: ['form', 'uscis', 'e-fil'], bestAs: 'immigration forms software' },
        { id: 'intake', label: 'Client intake questionnaires', phrase: 'client intake questionnaires', terms: ['intake questionnaires'], keywords: ['intake', 'questionnaire'], bestAs: 'immigration client intake software' },
        { id: 'deadlines', label: 'Deadlines and reminders', phrase: 'deadline reminders', terms: [], keywords: ['deadline', 'reminder'] },
        { id: 'reports', label: 'Reports for funders or leadership', phrase: 'reporting for funders or leadership', terms: [], keywords: ['report', 'funder'] },
        { id: 'portal', label: 'Client portal and messaging', phrase: 'the client portal', terms: [], keywords: ['portal', 'messag'] },
        { id: 'billing', label: 'Invoices and trust accounting', phrase: 'billing', terms: [], keywords: ['invoice', 'billing', 'trust account'] },
      ],
    },
    {
      // 10/23 review: ask this instead of the 1 to 5 stars. Yes skips the
      // star question. No or Skip shows it, and under 5 follows lowRating.
      id: 'fiveStar', type: 'single', skip: true,
      ask: 'Would you be willing to publish your review as a 5-star rating?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    },
    {
      id: 'rating', type: 'stars', skip: true, skipIf: { fiveStar: 'yes' }, skipValue: 5,
      ask: 'How would you rate your overall experience with eimmigration? (1 being poor, 5 being excellent)',
    },
    {
      id: 'result', type: 'text', required: false, skipLabel: 'Skip',
      ask: 'What made you switch, and what has changed for your team since? An example or a number helps.',
      followUp: {
        minWords: 8,
        ask: 'Thanks! Could you add an example or a number? One more sentence helps another team picture it.',
        skipLabel: "That's it",
      },
      sample: 'No more re-typing client details. We used to track cases in spreadsheets and type the same information into every form. Now we enter a client once, the forms fill themselves, and our funder reports take a few clicks instead of a week.',
    },
    {
      id: 'advice', type: 'text', required: false, skipLabel: 'Skip',
      ask: "What would you tell a team like yours that's looking at eimmigration?",
      sample: 'Set aside a week to move your cases over and lean on the support team. After that it just works, and your caseworkers will thank you.',
    },
    {
      id: 'improve', type: 'text', required: false, skipLabel: 'Nothing to add',
      ask: 'Is there anything we could improve or do better?',
      sample: 'The reporting screens took us a while to learn, but support walked us through them.',
    },
  ],

  // The only sentences in our words. Each draft uses one of these at most.
  templates: {
    facts: [
      "We're {org}, and we switched to {co} from {before} {forJobs}.",
      'As {org}, we moved from {before} to {co} {forJobs}.',
      "We're {org}, and we use {co} {forJobs}.",
      'As {org}, we use {co} {forJobs}.',
      'We switched to {co} from {before} {forJobs}.',
      'We use {co} {forJobs}.',
      "We're {org}, and we switched to {co} from {before}.",
      'We switched to {co} from {before}.',
      "We're {org}.",
    ],
    factsFirst: [
      "We're {org}, and {co} is the first system we've used {forJobs}.",
      '{co} is the first system our team has used {forJobs}.',
      "We're {org}, and {co} is the first system we've used.",
    ],
    nothingToAdd: ['Nothing to add right now.'],
    titleFallback: ['Our experience with {co}'],
  },

  persona: {
    orgType: 'nonprofit',
    before: 'spreadsheets',
    services: ['case-management', 'uscis-forms', 'reports'],
    fiveStar: 'yes',
    rating: 5,
    result: 'No more re-typing client details. We used to track cases in spreadsheets and type the same information into every form. Now we enter a client once, the forms fill themselves, and our funder reports take a few clicks instead of a week.',
    advice: 'Set aside a week to move your cases over and lean on the support team. After that it just works, and your caseworkers will thank you.',
    improve: 'The reporting screens took us a while to learn, but support walked us through them.',
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
