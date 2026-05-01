# Reputation Rocket — Prototype

A multi-step review flow that drafts platform-specific copy, runs an AI chat survey, and walks customers through posting to HubSpot, G2, Google, and similar sites. **The browser never sees the Factor8 API key** in the V1 setup: the app calls Vercel serverless routes that proxy the agent and send lifecycle notifications.


For **Vercel, env vars, client folders, local Node dev, and optional n8n**, see [VERCEL_N8N_SETUP.md](./VERCEL_N8N_SETUP.md) (full walkthrough). This README summarizes the same layout and day-to-day commands.

---

## Repo layout (V1)

```text
reputation-rocket-prototype/
  index.html           # Generic entry (config.js at root)
  config.js
  app.js               # State machine, theming, chat, post flow
  styles.css           # Shared UI + Lean Labs / Figma-aligned tokens
  api/
    agent.js           # POST /api/agent → Factor8 (uses FACTOR8_API_KEY)
    notify.js          # POST /api/notify → Slack and/or n8n webhook
  lean-labs/           # Template “client folder”: index.html, config.js, styles.css
  local-dev-server.js  # npm run dev: static + same /api/* behavior locally
  serve.py             # Optional: Python static server + /api/* proxy to Fly (no local secrets)
```

Copy `lean-labs/` for each new tenant (see **New client page** below).

---

## Quick start (recommended): Node + `.env.local`

Matches production behavior (agent + notify handlers).

```bash
copy .env.local.example .env.local   # Windows; use cp on macOS/Linux
```

Edit `.env.local` at minimum:

```text
FACTOR8_API_KEY=...
FACTOR8_API_URL=https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query
```

For **Slack-only notifications** (typical V1), set a webhook and you can leave n8n vars empty:

```text
SLACK_REPUTATION_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Optional **per-client Slack** channel: `SLACK_REPUTATION_WEBHOOK_<SLUG_UPPER_WITH_UNDERSCORES>` (e.g. `SLACK_REPUTATION_WEBHOOK_LEAN_LABS` for `clientSlug: 'lean-labs'` — see `api/notify.js`).

```bash
npm run dev
# → http://localhost:8888
```

Example (Lean Labs folder):

```text
http://localhost:8888/lean-labs/?companyName=Lean+Labs&name=Edward+Test&email=edward@leanlabs.com
```

**Option — Vercel CLI:** `vercel dev` (often port 3000) runs the same functions closer to prod; see VERCEL_N8N_SETUP.md.

---

## Optional: Python static server

```bash
python serve.py
# → http://localhost:8888
```

Proxies `/api/*` to Fly with CORS. It does **not** load `api/agent.js` / `api/notify.js` or `.env.local`. Use this only for quick static checks; use `npm run dev` for full stack local testing.

---

## New client page

1. Copy `lean-labs/` → `your-client-slug/`.
2. Edit `your-client-slug/config.js`: `clientSlug`, `providerName`, `company`, `reviewLinks`, `platforms`, `welcomeVideoUrl`, `videoUrl`, `thankYouUrl`, `allowedRedirectHosts`, optional `supportEmail` (negative alerts), optional `theme: { }` (overrides `DEFAULT_CLIENT_THEME` in `app.js`).
3. Adjust `your-client-slug/styles.css` for brand overrides that belong in CSS.
4. Add `/your-client-slug` → `/your-client-slug/` (308) in `vercel.json` and `_redirects` so links without a trailing slash still load assets correctly (query string is preserved).
5. Deploy on Vercel; set environment variables in the project (see below).
6. Share either `https://<your-domain>/<client-slug>?…` or `https://<your-domain>/<client-slug>/?…` (both end up on the trailing-slash URL).

---

## Vercel environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `FACTOR8_API_KEY` | Yes (prod) | Server-side agent auth |
| `FACTOR8_API_URL` | Optional | Override default Fly query URL |
| `SLACK_REPUTATION_WEBHOOK_URL` | If not using n8n | Default Slack channel for `completed` / `negative` events |
| `SLACK_REPUTATION_WEBHOOK_<CLIENT>` | Optional | Per-client Slack (slug → env suffix) |
| `N8N_REPUTATION_WEBHOOK_URL` | Optional | If set, `notify` prefers n8n over Slack |
| `N8N_REPUTATION_SHARED_SECRET` | Optional | Sent as `X-Reputation-Rocket-Secret` when posting to n8n |
| `RESEND_API_KEY` | Optional | [Resend](https://resend.com) API key — enables negative-feedback email |
| `RESEND_FROM` | With Resend | Verified sender, e.g. `Reputation Rocket <alerts@yourdomain.com>` |
| `NEGATIVE_ALERT_EMAIL_<CLIENT>` | Optional | Overrides `supportEmail` from the client `config.js` for the inbox (same suffix rule as Slack, e.g. `NEGATIVE_ALERT_EMAIL_LEAN_LABS`) |

When `event` is `negative`, Slack (or n8n) still runs first; then, if Resend is configured and a recipient exists (`NEGATIVE_ALERT_EMAIL_*` or `support_email` in the POST body from `CLIENT_CONFIG.supportEmail`), a plain-text email is sent with the same fields as the Slack message and subject `[Reputation Rocket] Negative feedback — …`.

**Slack-only V1:** set `FACTOR8_API_KEY` + `SLACK_REPUTATION_WEBHOOK_URL` (and per-client Slack vars as needed). Leave `N8N_*` blank. Email is optional until `RESEND_*` and a support address are set.

Payload shape, n8n branching, and example Slack copy: [VERCEL_N8N_SETUP.md](./VERCEL_N8N_SETUP.md).

---

## Theming

Per-client visuals use `CLIENT_CONFIG.theme` merged into `DEFAULT_CLIENT_THEME` in `app.js` (fonts, colors, page background, stepper, chat area, buttons, badges, etc.). Root `styles.css` consumes `--ll-*` CSS variables set at runtime.

---

## URL query params (personalized links)

Still supported alongside `config.js` defaults (see `app.js` / HANDOFF for full list):

| Param | Typical use |
|-------|-------------|
| `companyName` / `company_name` / `company` | Display name for the client |
| `name` | Respondent name |
| `email` | Respondent email (tracked) |
| `platforms` | CSV: `hubspot,g2,google` |
| `review_<platform>` | Per-platform review URL |
| `video_url` | Enables video testimonial step |
| `welcome_video_url` | Welcome screen video |
| `thank_you_url` | Redirect after completion |

---

## Files (cheat sheet)

| Path | Role |
|------|------|
| `index.html`, `lean-labs/index.html` | Screens: welcome, chat, draft, post, video, complete, negative |
| `app.js` | State machine, Factor8 calls, review popups, overlays, session, theme application |
| `styles.css` | Shared layout, stepper, chat, platform grid, components |
| `config.js`, `lean-labs/config.js` | `CLIENT_CONFIG` (endpoints, links, theme) |
| `api/agent.js`, `api/notify.js` | Vercel / local-dev serverless handlers |
| `local-dev-server.js` | `npm run dev` |
| `.env.local.example` | Template for local secrets (not committed) |
| `VERCEL_N8N_SETUP.md` | Deploy, env, n8n workflow, limitations |
| `HANDOFF.md` | Backend contract + V2 direction |
| `_redirects` | Netlify-style redirects if used there |

---

## Backend (Factor8 agent)

Agent prompt and API live in [LeanLabs0/factor8-agent-sdk](https://github.com/LeanLabs0/factor8-agent-sdk). Surveys and reputation state are defined server-side — don’t change prompts or trackers without an end-to-end test (HANDOFF.md).

---

## Reset session (browser)

DevTools console:

```js
rrReset();
```

Clears session storage and reloads.

---

## V1 caveats

- Progress is stored in **sessionStorage** keyed per `clientSlug` (`rr_session_<slug>`). Switching between `/lean-labs`, `/eimmigration`, etc. no longer shares one saved flow.
- Launch links still trust `name` / `email` query params until signed tokens exist.
- “Posted” is user-confirmed, not verified with each review site.
- Physical client folders scale to a point; a config service is the longer-term approach (see HANDOFF / VERCEL doc).
- `supportEmail` in `config.js` is public in the browser; use `NEGATIVE_ALERT_EMAIL_<SLUG>` on the server to pin the inbox in production.
