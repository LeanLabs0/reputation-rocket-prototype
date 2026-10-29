window.CLIENT_CONFIG = {
  clientSlug: "eimmigration",
  providerName: "eimmigration",
  displayName: "eImmigration",
  agentEndpoint: "/api/agent",
  notificationEndpoint: "/api/notify",
  platforms: ["gartner","g2","trustpilot"],
  reviewLinks: {
    gartner: "https://www.gartner.com/reviews/product/eimmigration",
    g2: "https://www.g2.com/products/eimmigration-by-cerenade/reviews/start",
    trustpilot: "https://www.trustpilot.com/evaluate/cerenade.com"
  },
  // Viv's 10/16 Step 1 notes: no welcome video (the page has no video host, so
  // a URL saved in /configure is ignored too), and the step bar sits under the
  // Get Started button until the chat starts.
  progressBelowWelcome: true,
  interviewQuestions: [
    "Why did you choose eimmigration?",
    "What were you hoping to achieve?",
    "How did we deliver on your expectations?"
  ],
  videoCaptureEnabled: false,
  // V3 interview (10/27): the page asks these questions, then the writer agent
  // drafts the reviews from the answers in one request ("Interview V3" in
  // app.js). Under 5 stars nothing is drafted: the review is saved and the
  // team reaches out first. The star question has no Skip, so a customer who
  // would not publish 5 stars always gives a number.
  interview: {
    version: 3,
    writingMessage: "Thank you! Give me a few seconds to put your drafts together.",
    lowRating: {
      below: 5,
      gate: true,
      ask: "Thanks for being honest. Before anything gets posted, we'll save your review. We'd really like to reach out and figure out what we need to solve to get you all the way to 5 stars. Is that OK?",
      options: [
        { id: "yes", label: "Yes, reach out to me", reply: "Thank you. A few more questions so we know where to start." },
        { id: "no", label: "No thanks", reply: "No problem. A few more questions so the team knows what to fix." }
      ],
      saved: "Thanks for sharing. We saved your review, and someone from eimmigration will reach out before anything gets posted.",
      savedDeclined: "Thanks for sharing. We saved your review, and nothing will be posted."
    },
    steps: [
      {
        id: "orgType", type: "single", skip: true, promptLabel: "Who they are",
        ask: "Thanks for helping other teams find the right immigration software. First, which best describes your organization?",
        options: [
          { id: "nonprofit", label: "Nonprofit immigration legal services", phrase: "a nonprofit immigration legal services team" },
          { id: "solo", label: "Solo immigration attorney", phrase: "a solo immigration practice" },
          { id: "small-firm", label: "Immigration law firm, 2 to 10 attorneys", phrase: "a small immigration law firm" },
          { id: "large-firm", label: "Immigration law firm, 11 or more attorneys", phrase: "a larger immigration law firm" },
          { id: "corporate", label: "Corporate immigration team", phrase: "a corporate immigration team" }
        ]
      },
      {
        id: "before", type: "single", skip: true, ownWords: true, promptLabel: "Used before",
        ask: "What were you using before eimmigration?",
        options: [
          { id: "spreadsheets", label: "Spreadsheets or paper files", phrase: "spreadsheets or paper files" },
          { id: "docketwise", label: "DocketWise", phrase: "DocketWise" },
          { id: "lollylaw", label: "LollyLaw", phrase: "LollyLaw" },
          { id: "bluedot", label: "BlueDot", phrase: "BlueDot" },
          { id: "other-software", label: "Another immigration software", phrase: "another immigration software" },
          { id: "first", label: "Nothing, this is our first system", firstSystem: true }
        ]
      },
      {
        id: "services", type: "multi", min: 1, ownWords: true, promptLabel: "Use eimmigration for",
        ask: "What does your team use eimmigration for? Pick all that apply.",
        options: [
          { id: "case-management", label: "Immigration case management", phrase: "case management" },
          { id: "uscis-forms", label: "Filling and e-filing USCIS forms", phrase: "USCIS forms" },
          { id: "intake", label: "Client intake questionnaires", phrase: "client intake questionnaires" },
          { id: "deadlines", label: "Deadlines and reminders", phrase: "deadline reminders" },
          { id: "reports", label: "Reports for funders or leadership", phrase: "reporting for funders or leadership" },
          { id: "portal", label: "Client portal and messaging", phrase: "the client portal" },
          { id: "billing", label: "Invoices and trust accounting", phrase: "billing" }
        ]
      },
      {
        id: "fiveStar", type: "single", skip: true,
        ask: "Would you be willing to publish your review as a 5-star rating?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" }
        ]
      },
      {
        id: "rating", type: "stars", skipIf: { fiveStar: "yes" }, skipValue: 5,
        ask: "How would you rate your overall experience with eimmigration? (1 being poor, 5 being excellent)"
      },
      {
        id: "result", type: "text", skipLabel: "Skip",
        ask: "What made you switch, and what has changed for your team since? An example or a number helps."
      },
      {
        // Only after a short or skipped switch answer: quick taps for real
        // detail, so the drafts have more to say without inventing anything.
        id: "gains", type: "multi", max: 3, skip: true, ownWords: true,
        onlyIfShort: { step: "result", minWords: 8 },
        promptLabel: "What got better",
        ask: "Got it. What's better for your team since you started using eimmigration? Pick any that fit.",
        options: [
          { id: "intake", label: "Client intake is faster", phrase: "client intake is faster" },
          { id: "retyping", label: "Less re-typing of client info", phrase: "less re-typing of client info" },
          { id: "form-errors", label: "Fewer errors on forms", phrase: "fewer errors on forms" },
          { id: "deadlines", label: "Easier to stay on top of deadlines", phrase: "staying on top of deadlines is easier" },
          { id: "client-updates", label: "Easier to keep clients updated", phrase: "keeping clients updated is easier" },
          { id: "reporting", label: "Reporting takes less time", phrase: "reporting takes less time" },
          { id: "time", label: "We save time every week", phrase: "we save time every week" }
        ]
      },
      {
        id: "advice", type: "text", skipLabel: "Skip",
        ask: "What would you tell a team like yours that's looking at eimmigration?"
      },
      {
        id: "improve", type: "text", skipLabel: "Nothing to add",
        ask: "Is there anything we could improve or do better?"
      }
    ]
  },
  // Wording from Viv's 10/13 feedback. Keys are read by clientCopy() and
  // clientCardHint() in app.js; anything not set here keeps the shared default.
  copy: {
    draftsReadyMessage: "Thanks so much for sharing.\n\nWe turned your responses into a few reviews that you can edit or publish.",
    draftsReadyButton: "See my reviews",
    cardHints: {
      gartner: "Takes 2 minutes. You'll need to log in to or create a free Gartner account to publish your review.",
      g2: "Takes 2 minutes. You'll need to log in to or create a free G2 account to publish your review.",
      trustpilot: "Takes 1 minute. You'll need to log in to or create a free Trustpilot account to publish your review."
    },
    postFinishHint: "",
    postNudgeProgress: "Nice work! Publish and confirm the rest so eimmigration can see your reviews and send your reward."
  },
  thankYouUrl: "",
  thankYouRedirectDelayMs: 120000,
  allowedRedirectHosts: ["eimmigration.com","www.eimmigration.com","get.eimmigration.com"],
  supportEmail: "support@cerenade.com",
  hubspotPortalId: "45248900",
  hubspotFormId: "d636fadd-2e72-4663-bf26-e465c7d419a5",
  hubspotFormRegion: "na1",
  hubspotCompleteProperty: "rr_iscomplete",
  hubspotCompleteValue: "Yes",
  hubspotIncompleteValue: "No",
  hubspotOutcomeProperty: "rr_outcome",
  hubspotOutcomePositiveValue: "positive",
  hubspotOutcomeNegativeValue: "negative",
  slackChannel: 'C07K39T6U6M',
  slackThreadPositive: '1781882060.665979',
  slackThreadNegative: '1781882092.387649'
};
