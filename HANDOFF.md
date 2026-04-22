# Reputation Rocket — Developer Handoff (Edward)

> Updated 2026-04-22 after prototype review + Kevin alignment call + Tonya platform research.

## TL;DR

Prototype works end-to-end. Agent runs on Fly. Frontend is a static SPA with sessionStorage only. V1 scope is deliberately lean per Kevin — no admin panel, no dashboard, no storage backend. Your job:

1. Host the static frontend at `reputationrocket.ai/<client-slug>` (DNS + hosting)
2. Wire **Slack notification** webhook on completion (positive + negative paths)
3. Build **HubSpot workflow** that fires the email with the personalized link
4. Manually configure each pilot client (Google Doc / form — no admin UI needed for V1)

---

## V1 scope per Kevin (what we are NOT building)

| Item | Status | Notes |
|---|---|---|
| Admin panel | ❌ CUT | Lean Labs configures clients manually. No UI needed |
| Dashboard / reporting | ❌ CUT | Future V2 wishlist ("baseline vs delta" reviews/month) |
| Storage backend | ❌ CUT | Frontend is sessionStorage only. No persisted state in V1 |
| Clutch support | ❌ CUT | Their submission is 15-20 min phone interview — doesn't fit draft-and-deliver |
| "Unsupported platform" disclaimer UX | ❌ Deferred V2 | When clients want platforms we don't template for |
| Confetti on completion | ✅ DONE | Hard requirement from Kevin |
| Slack notification on completion | ⏳ Edward | Frontend has the data — just needs a POST to your n8n webhook |

---

## Supported review platforms (V1)

Lean Labs pilot targets: **HubSpot, G2, Google Business Profile** (Trustpilot available but not in Lean Labs mix).

| Platform | Flow | Notes |
|---|---|---|
| HubSpot | `paste` | Single textbox. Agent emits narrative, 60-100 words |
| G2 | `fields` | Multi-field form. Agent emits 4 sections with `[FIELD: question]` markers. Frontend splits them so user copies each into the right G2 form field |
| Google Business Profile | `paste` | Single textbox. Agent emits conversational, 50-100 words |
| Trustpilot | `paste` | Single textbox. Agent emits punchy, 40-80 words |

Any other platform the customer lists → agent falls back to generic narrative (60-100 words). Frontend shows it with the paste flow. Not ideal UX for a mismatched platform — fine for V1 since we only ship the 4 above.

---

## Customer-facing app

[src/factor8/static/reputation-rocket/](../src/factor8/static/reputation-rocket/) — single-page, no framework, deployable as static assets. Live dev at `reputationrocket.netlify.app`.

| Screen | Behavior |
|---|---|
| 1 — Welcome | Greeting, optional `welcome_video_url` video, "logging in is the hardest part" callout, CTA |
| 2 — Chat | Live agent on Fly. 5-question adaptive survey. Sentiment routing on Q1 |
| 3 — Draft | Tabbed per-platform drafts. Edit each. Regenerate per-tab. Star rating |
| 4 — Post | Progress bar (`X of N posted`). `paste` cards = copy-all + open tab + 2s auto-mark. `fields` cards = per-field copy + open form + explicit "I posted it" confirm |
| 5 — Video | testimonial.to link (only if `video_url` param set) |
| 6 — Complete | Confetti, stats. Redirects to `thank_you_url` after 5s if set |
| 7 — Negative | Empathy message, negative_flag logged. Redirects to `thank_you_url` after 5s if set |

### Agent backend

[.claude/agents/reputation-rocket.md](../.claude/agents/reputation-rocket.md) — Haiku, ~$0.003/turn, ~1-2s per turn.

- **Survey + sentiment routing** (Q1 = 1-2 → negative, Q1 = 3-5 → positive)
- **Multi-platform draft generation** in ONE response: `<drafts><draft platform="…">…</draft></drafts>`
- G2 drafts use `[FIELD: question]` markers so the frontend can split per G2 form field
- **Negative flag** via `<structured_output>{"negative_flag":{...}}</structured_output>`
- **Server-side SURVEY STATE tracker** — [api/routes/query.py:107-205](../src/factor8/api/routes/query.py#L107) prepends `Q1=ANSWERED, Q2=ANSWERED…` to every turn so Haiku stops re-asking. **Critical fix — do not remove.**

---

## API Contract

### Endpoint
```
POST https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query
```
Auth: `X-API-Key: 594aa935e360c9bf28f97437c1dddea9` header.

### Request (every turn, same shape)
```json
{
  "prompt": "user message OR 'Please start the review process.' on first turn",
  "agent": "reputation-rocket",
  "session_id": "uuid-per-customer-visit",
  "config": {
    "client_name": "Lean Labs",
    "customer_name": "Jane Doe",
    "customer_email": "jane@acme.com",
    "platforms": ["hubspot", "g2", "google"],
    "review_links": {
      "hubspot": "https://...",
      "g2": "https://www.g2.com/products/lean-labs/take-survey",
      "google": "https://..."
    }
  }
}
```

Do NOT put the config block inside `prompt` — server prepends it from the `config` field.

Do NOT send `video_testimonial_url` in `config` — frontend handles Screen 5.

### Response
```json
{
  "session_id": "uuid",
  "machine_id": "abc123",
  "result": "agent reply (may include <drafts>...</drafts>)",
  "data": { "negative_flag": { ... } | null },
  "total_cost_usd": 0.003,
  "duration_ms": 1800
}
```

**Sticky routing:** include `fly-force-instance-id: <machine_id>` header on follow-up turns. If the home machine is gone, retry without the header — Supabase has the session. Handled in [app.js:55-90 fetchWithStickyRetry](../src/factor8/static/reputation-rocket/app.js#L55).

### Draft block format

```
<drafts>
  <draft platform="hubspot">
  Full HubSpot draft — narrative 60-100 words
  </draft>
  <draft platform="g2">
  [FIELD: What do you like best about {client}?]
  1-3 sentences.

  [FIELD: What do you dislike about {client}?]
  1-2 sentences.

  [FIELD: What problems is {client} solving and how is that benefiting you?]
  1-3 sentences.

  [FIELD: Recommendations to others considering {client}:]
  1-2 sentences.
  </draft>
  <draft platform="google">
  Full Google Business draft — 50-100 words
  </draft>
</drafts>
```

Parsers: [parseDraftsBlock](../src/factor8/static/reputation-rocket/app.js#L415) + [parseG2Fields](../src/factor8/static/reputation-rocket/app.js#L577).

### Negative flag schema

```json
{
  "severity": "high|medium|low",
  "customer_name": "…",
  "customer_email": "…",
  "client_name": "…",
  "rating": 1,
  "survey_responses": [{"question":"…","answer":"…"}],
  "key_concerns": ["…"],
  "suggested_actions": ["…"]
}
```

Frontend handler: [app.js:294-307](../src/factor8/static/reputation-rocket/app.js#L294). Currently just `console.log`s. You wire the Slack webhook.

---

## URL Params (per-customer link)

| Param | Required | Notes |
|---|---|---|
| `company` | yes | Client name shown in chat |
| `name` | yes | Customer first+last |
| `email` | yes | Tracked, not shown |
| `platforms` | yes | CSV: `hubspot,g2,google` |
| `review_<platform>` | yes per platform | One per platform listed above |
| `video_url` | no | testimonial.to → enables Screen 5 |
| `welcome_video_url` | no | mp4 → Screen 1 video |
| `thank_you_url` | no | Client's thank-you page → redirect after 5s on Screen 6 / 7 |

---

## File Map

| Path | Purpose |
|---|---|
| `.claude/agents/reputation-rocket.md` | Agent system prompt |
| `src/factor8/api/routes/query.py:107-205` | `_build_reputation_rocket_state` — server SURVEY STATE tracker |
| `src/factor8/static/reputation-rocket/index.html` | SPA markup |
| `src/factor8/static/reputation-rocket/app.js` | State machine, agent calls, parsers, card variants |
| `src/factor8/static/reputation-rocket/styles.css` | Lean Labs design tokens |
| `src/factor8/static/reputation-rocket/serve.py` | Local dev proxy → Fly (port 8888) |

---

## What you need to build (Edward checklist)

### 1. Hosting at `reputationrocket.ai`

Point DNS + host the static files. Subpaths per client: `reputationrocket.ai/lean-labs`, `reputationrocket.ai/e-immig`, etc. Each subpath just serves the same `index.html` — the URL params do the per-client work.

### 2. HubSpot workflow trigger

HubSpot workflow on project-complete (or X days post-launch) fires an email with the unique link. Template:

```
Subject: Your quick favor for {{client_name}}
Body:
Hey {{firstname}},
Could we borrow 3 minutes? We partnered with a tool called Reputation Rocket to make
leaving reviews painless — it'll draft your words for you.

{{unique_rocket_url}}

Huge thanks,
{{client_name}} team
```

Link builder (use HubSpot tokens):
```
https://reputationrocket.ai/<client-slug>?company={{client_name}}&name={{firstname}}+{{lastname}}&email={{email}}&platforms=hubspot,g2,google&review_hubspot=<url>&review_g2=<url>&review_google=<url>&thank_you_url={{client_domain}}/reputation-rocket/thanks
```

### 3. Slack / n8n notification webhook

Frontend has the data on Screen 6 (complete) and Screen 7 (negative). Add a fetch POST from [initCompleteScreen](../src/factor8/static/reputation-rocket/app.js#L669) + [initNegativeScreen](../src/factor8/static/reputation-rocket/app.js#L709) to your n8n webhook. Payload shape:

```json
{
  "event": "completed" | "negative",
  "client": "Lean Labs",
  "customer_name": "Jane Doe",
  "customer_email": "jane@acme.com",
  "rating": 5,
  "posted": ["hubspot", "g2"],
  "ts": "2026-04-22T15:30Z",
  "negative_flag": { /* only on negative event */ }
}
```

Slack message on positive: `"@channel Jane Doe just posted a 5-star review to HubSpot + G2 for Lean Labs 🎉"`

Slack message on negative: `"@viv Jane Doe left a 2-star flag for Lean Labs. Key concerns: [key_concerns]. Suggested actions: [suggested_actions]."` — as Kevin described in the meeting.

### 4. Per-client manual setup (V1)

Google Doc / form where Lean Labs enters for each new client:
- Client name
- Platforms they want (must be in our supported list: HubSpot / G2 / Google / Trustpilot)
- Review URL per platform
- testimonial.to URL (optional)
- Welcome video URL (optional)
- Thank-you page URL

Ralph or Tonya manually configures the HubSpot workflow with that data. No admin UI for V1.

---

## Test It Yourself

### Local dev
```bash
cd src/factor8/static/reputation-rocket && python serve.py
# → http://localhost:8888
```

### Test URL (all features)
```
http://localhost:8888/?company=Lean+Labs&name=Edward+Test&email=edward@leanlabs.com
  &platforms=hubspot,g2,google
  &review_hubspot=https://hubspot.com/lean-labs/review
  &review_g2=https://www.g2.com/products/lean-labs/take-survey
  &review_google=https://g.page/lean-labs/review
  &video_url=https://testimonial.to/lean-labs
  &welcome_video_url=https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
  &thank_you_url=https://leanlabs.com/reputation-rocket/thanks
```

### E2E paths
- **Positive:** rate `5` → "site rebuild on 6 weeks" → "40% conv lift" → "would recommend" → "no" → drafts → post each (HubSpot auto-marks in 2s, G2 needs per-field copy + "I posted it") → video skip → complete → redirect to thank_you_url after 5s
- **Negative:** rate `2` → "specific concern" → negative screen, negative_flag in `console.log` → redirect after 5s if set
- Reset stale state: DevTools console → `rrReset()`

### Quick agent smoke
```bash
SID=$(uuidgen)
curl -sS -X POST "https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 594aa935e360c9bf28f97437c1dddea9" \
  -d "{\"prompt\":\"Please start the review process.\",\"agent\":\"reputation-rocket\",\"session_id\":\"$SID\",\"config\":{\"client_name\":\"Lean Labs\",\"customer_name\":\"Edward\",\"customer_email\":\"e@l.com\",\"platforms\":[\"hubspot\",\"g2\"],\"review_links\":{\"hubspot\":\"https://x\",\"g2\":\"https://y\"}}}" | python -m json.tool
```

---

## V2 Research — B2B/SaaS Review Platforms

When Reputation Rocket sells beyond Lean Labs, clients will want platforms outside our current 4. Research summary:

| # | Platform | Type | Flow | Fields | Login | Barrier | Recommend | Notes |
|---|----------|------|------|--------|-------|---------|-----------|-------|
| 1 | G2 | B2B SaaS | fields | 4 text + star ratings + profile | LinkedIn / work email | Medium | ✅ V1 | Gold standard. `[FIELD:]` markers in place |
| 2 | Capterra | B2B SaaS | fields | Stars + pros/cons/overall/use case/pricing | LinkedIn / email | Low-Medium | ✅ V2 | Syndicates to GetApp + Software Advice (1 submission = 3 listings) |
| 3 | GetApp | B2B SaaS | — | — | — | — | ❌ | Auto-syndicated from Capterra. Skip |
| 4 | Software Advice | B2B SaaS | — | — | — | — | ❌ | Auto-syndicated from Capterra. Skip |
| 5 | TrustRadius | B2B SaaS | fields | Pros/cons/use cases/features/word minimums | LinkedIn / work email | Medium-High | ⚠️ V2+ | Long form (~20-30 min). Adds multi-chunk `[FIELD:]` output |
| 6 | Gartner Peer Insights | B2B SaaS | fields | Ratings + context + demographics | Corp email + code | High | ⚠️ Enterprise | Strict verification. Enterprise buyers only |
| 7 | PeerSpot | B2B SaaS | brief | — | — | — | ❌ | Voice-agent "Samantha" or phone interview. Exclude |
| 8 | Clutch | Agency | brief | — | — | — | ❌ | 15-20 min phone interview. Exclude (already cut) |
| 9 | Trustpilot | General | paste | 1 star + 1 textbox | Email/Google | Low | ✅ V1 | Easiest flow |
| 10 | Google Business Profile | Local/General | paste | 1 star + 1 textbox | Google | Low | ✅ V1 | Required for local SEO |
| 11 | HubSpot App Marketplace | App marketplace | fields | Star + review + pros + cons + private feedback | HubSpot + app installed | Medium | ✅ V1 | Only for HubSpot ecosystem apps |
| 12 | Shopify App Store | App marketplace | paste | Star + textbox | Shopify merchant + app installed | Medium | ✅ V2 | Shopify vendors only |
| 13 | Product Hunt | Product discovery | paste | Star + textbox | PH account | Low | ✅ V2 | Consumer/indie SaaS launches |
| 14 | Apple App Store | App marketplace | paste | Star + title + body | Apple ID | Medium | ✅ V2 | iOS apps |
| 15 | Google Play Store | App marketplace | paste | Star + textbox | Google | Low | ✅ V2 | Android apps |
| 16 | Salesforce AppExchange | App marketplace | fields | Star + title + body + NPS | Trailblazer ID | Medium | ✅ V2 | SFDC ecosystem SaaS |
| 17 | SourceForge/Slashdot | B2B SaaS | fields | Star + structured | Email | Low-Medium | ✅ V2 | 1 submission = both listings |
| 18 | SoftwareSuggest | B2B SaaS | fields | Ratings + review + screenshot/invoice | Email + proof | Medium | ⚠️ MAYBE | Billing screenshot required. APAC-heavy |
| 19 | Crozdesk | B2B SaaS | paste (long) | Single 600-char-min | LinkedIn | Medium | ⚠️ MAYBE | Low traffic |
| 20 | Glassdoor | Employer | fields | Stars + title + pros + cons + advice | Email/LinkedIn | Low-Medium | ⚠️ MAYBE | Employer reviews, not product |
| 21 | Microsoft AppSource | App marketplace | fields | Star + title + body | Microsoft account | Medium | ⚠️ MAYBE | MS ecosystem SaaS only |
| 22 | FeaturedCustomers | Case study hub | — | — | — | — | ❌ | Vendor-managed only. Not user-submission |

**V2 platform-config decision (my recommendation — pending Ralph/Tonya signoff):**

Hybrid — dropdown of ~10 pre-configured platforms (V1 supported + top V2 candidates) with tested format templates, PLUS a "Custom / other" option that takes a platform name + URL + user-provided format hint. Agent falls back to generic narrative for custom platforms, with a disclaimer on Screen 4: *"We don't have a native template for {platform}. Here's a general review — you may need to adapt it for their form."* Lean Labs can later promote custom platforms to native templates by editing the config.

---

## Known Limitations / Parked

| Item | Status |
|---|---|
| Em-dash 400 in raw JSON body | Low priority — browsers unaffected |
| Admin panel | Deleted — V2 asset in git history if needed |
| Reporting dashboard | V2 wishlist (baseline vs delta) |
| Clutch support | Excluded from product |
| Unsupported platform disclaimer UX | V2 |
| testimonial.to interview Qs | Placeholder copy — Kevin to provide real Qs |
| Custom domain | `reputationrocket.netlify.app` → `reputationrocket.ai` — DNS work |

---

## Questions to resolve

1. **Pilot timing** — when does e-immigration start?
2. **Slack channel** — which channel should the negative-flag alerts go to?
3. **Confetti-event Slack format** — Kevin's line `"betty rebel says you're in trouble"` — final copy?

---

Ralph or Tonya on Slack for anything unclear.
