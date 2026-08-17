# Reputation Rocket — Prototype

Reputation Rocket is a review flow with more than one step.
The flow writes review text for each platform.
The flow also does an AI chat survey.
Then the flow shows the customer how to post the review.
The customer can post the review to HubSpot, G2, Google, and other sites.

In the V1 setup, the browser does not get the Factor8 API key.
The app sends requests to Vercel serverless routes.
These routes send the agent request and the lifecycle notifications.

For Vercel, environment variables, client folders, local Node development, and n8n, refer to [VERCEL_N8N_SETUP.md](./VERCEL_N8N_SETUP.md).
That file has the full procedure.
This README gives a short description of the same layout and the daily commands.

---

## Repo layout (V1)

```text
reputation-rocket-prototype/
  pages/
    home/              # Marketing homepage (live URL still /)
    configure/         # Operator console (live URL still /configure/)
    clients/           # Per-client portals (live URLs still /{slug}/)
      lean-labs/
      eimmigration/
      propertyradar/   # Scaffold template for new clients
  config.js            # Reference / toolbox only; each client folder has its own config.js
  app.js               # State machine, theming, chat, post flow
  styles.css           # Shared UI + Lean Labs / Figma-aligned tokens
  api/
    agent.js           # POST /api/agent → Factor8 (uses FACTOR8_API_KEY)
    notify.js          # POST /api/notify → Slack and/or n8n webhook
    upload-video.js    # POST /api/upload-video → HubSpot Files API
  local-dev-server.js  # npm run dev: static + same /api/* behavior locally
  serve.py             # Optional: Python static server + /api/* proxy to Fly (no local secrets)
```

The public URLs do not change (`/`, `/configure/`, `/lean-labs/`, and others).
`vercel.json` rewrites these URLs to the files.
Put new client folders in `pages/clients/`.
Refer to **New client page** below.
You can also use `/configure` and then Add client.

---

## Quick start: Node and `.env.local`

Use this procedure for local work.
This procedure is the same as the production system for the agent and notify handlers.

```bash
copy .env.local.example .env.local   # Windows; use cp on macOS/Linux
```

Set these values in `.env.local` as a minimum:

```text
FACTOR8_API_KEY=...
FACTOR8_API_URL=https://factor8-agent-sdk.fly.dev/api/v1/brand-slug/test/query
```

For Slack notifications only (usual V1), set a webhook.
Do not set the n8n variables:

```text
SLACK_REPUTATION_WEBHOOK_URL=https://hooks.slack.com/services/...
```

You can set a Slack channel for one client.
Use `SLACK_REPUTATION_WEBHOOK_<SLUG_UPPER_WITH_UNDERSCORES>`.
Example: `SLACK_REPUTATION_WEBHOOK_LEAN_LABS` for `clientSlug: 'lean-labs'`.
Refer to `api/notify.js`.

```bash
npm run dev
# → http://localhost:8888  (company picker; open a client folder e.g. /lean-labs/)
```

Example for the Lean Labs folder:

```text
http://localhost:8888/lean-labs/?companyName=Lean+Labs&name=Edward+Test&email=edward@leanlabs.com
```

You can also use the Vercel CLI.
The command `vercel dev` (usually port 3000) runs the same functions nearer to production.
Refer to VERCEL_N8N_SETUP.md.

---

## Python static server (if necessary)

```bash
python serve.py
# → http://localhost:8888
```

This server sends `/api/*` to Fly with CORS.
This server does not load `api/agent.js`, `api/notify.js`, or `.env.local`.
Use this server only for a quick static check.
Use `npm run dev` for a full local test.

---

## New client page

1. Use `/configure` and then **Add client**.
   This command makes `pages/clients/<slug>/` from `propertyradar`.
   This command also sets the rewrites.
   You can also copy `pages/clients/propertyradar/` to `pages/clients/your-client-slug/`.
2. Edit `pages/clients/your-client-slug/config.js`.
   This file holds data only.
   This file does not hold the visual theme.
   Set `clientSlug`, `providerName`, `reviewLinks`, `platforms`, `welcomeVideoUrl`, `videoUrl`, `videoCaptureEnabled`, `thankYouUrl`, and `allowedRedirectHosts`.
   You can also set `supportEmail`.
   You can also set `notifyEmails` (Resend recipients).
   You can also set Slack routing: `slackChannel`, `slackThreadPositive`, and `slackThreadNegative`.
   You can also set `platformLogos`.
3. Set the brand in `pages/clients/your-client-slug/styles.css`.
   All theming is CSS.
   Change the `--ll-*` tokens.
   Use `@import` for the brand font.
   Set `#star-stop-*`.
   Refer to `pages/clients/eimmigration/styles.css`.
4. Make sure that `vercel.json` and `_redirects` map `/{slug}/` to `pages/clients/{slug}/`.
   Add client does this step.
   Trailing-slash redirects stay on the public URL.
5. Deploy the project on Vercel.
   Set the environment variables in the project.
   Refer to the table below.
6. Give this URL: `https://<your-domain>/<client-slug>/?…`.
   The public path is `/{slug}/`.
   The public path is not `/pages/clients/...`.

---

## Vercel environment variables

| Variable | Required |
|----------|----------|
| `FACTOR8_API_KEY` | Yes (prod) |
| `FACTOR8_API_URL` | If necessary |
| `SLACK_REPUTATION_WEBHOOK_URL` | If you do not use n8n |
| `SLACK_REPUTATION_WEBHOOK_<CLIENT>` | If necessary |
| `N8N_REPUTATION_WEBHOOK_URL` | If necessary |
| `N8N_REPUTATION_SHARED_SECRET` | If necessary |
| `RESEND_API_KEY` | If necessary |
| `HUBSPOT_FILES_ACCESS_TOKEN_<CLIENT>` | Video upload and contact updates (legacy) |
| `HUBSPOT_FILES_ACCESS_TOKEN_<PORTAL_ID>` | If necessary |
| `CONFIGURE_PASSWORD` | `/configure` |
| `HUBSPOT_APP_CLIENT_ID` | `/configure` OAuth |
| `HUBSPOT_APP_CLIENT_SECRET` | `/configure` OAuth |
| `HUBSPOT_APP_REDIRECT_URI` | `/configure` OAuth |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Required on Vercel |
| `HUBSPOT_TOKEN_ENCRYPTION_KEY` | Recommended |

Set the Slack channel ID and the thread IDs for each client in `config.js`.
Use `slackChannel`, `slackThreadPositive`, and `slackThreadNegative`.
Keep only the bot token in the environment.

If a client has `notifyEmails` in `config.js` and you set `RESEND_API_KEY`, `/api/notify` sends email to that list.
The email is sent for `completed` and for `negative`.
The email has the same fields as the Slack message.
Slack also sends a message if that client has Slack threads.

---

## `/configure` — HubSpot and experience setup

The operator console is at [`/configure/`](./pages/configure/).
You can use this console on the local system and in production.
The live URL stays `/configure/`.

**These steps occur for each portal when you Connect HubSpot:**

1. The system does an OAuth install with files, contacts, schemas, and forms scopes.
2. The system makes the contact properties `rr_iscomplete` (`Yes`/`No`) and `rr_outcome` (`positive`/`negative`).
3. The system makes (or uses again) the lead form **`[LL] Reputation Rocket - Sign in`**.
   The form needs `firstname`, `lastname`, `email`, and `company`.
4. The system stores the refresh token (KV on Vercel).
   When you run locally, the system writes the IDs into `config.js`.

**You must still do these steps manually:** Slack channel and threads, brand CSS, and Factor8.

---

## Theming

Theming uses CSS.
There is no JS theme layer.
The root `styles.css :root` holds the default (Lean Labs) `--ll-*` tokens.
These tokens set fonts, colors, page background, stepper, chat area, buttons, and badges.
Each client folder has a `styles.css` file.
That file loads after the root file and changes those tokens.
That file also uses `@import` for the brand font and sets `--font-family`.
That file also sets the star-gradient colors `#star-stop-*`.
`config.js` does not hold visual settings.
Refer to `pages/clients/eimmigration/styles.css` for a full example.

---

## URL query parameters (personalized links)

The system also uses these parameters with the `config.js` defaults.
For the full list, refer to `app.js` and HANDOFF.

| Parameter | Usual use |
|-----------|-----------|
| `companyName` / `company_name` / `company` | Display name for the client |
| `name` | Name of the person who answers |
| `email` | Email of the person who answers (tracked) |
| `platforms` | CSV: `hubspot,g2,google` |
| `review_<platform>` | Review URL for one platform |
| `video_url` | Starts the video testimonial step |
| `welcome_video_url` | Video on the welcome screen |
| `thank_you_url` | Redirect after the flow is complete |

---

## Files (quick list)

| Path | Function |
|------|----------|
| `pages/home/index.html`, `pages/clients/*/index.html` | Home and portal screens: welcome, chat, draft, post, video, complete, negative |
| `app.js` | State machine, Factor8 calls, review popups, overlays, session (no theming) |
| `styles.css` | Shared layout and default `--ll-*` theme tokens. Each client `styles.css` changes them. |
| `config.js`, `pages/clients/*/config.js` | `CLIENT_CONFIG` data (endpoints, links, IDs). No visual theme. |
| `api/agent.js`, `api/notify.js`, `api/upload-video.js` | Vercel and local-dev serverless handlers |
| `local-dev-server.js` | `npm run dev` |
| `.env.local.example` | Template for local secrets (not committed) |
| `VERCEL_N8N_SETUP.md` | Deploy, environment, n8n workflow, limitations |
| `HANDOFF.md` | Backend contract and V2 direction |
| `_redirects` | Netlify-style redirects if you use Netlify |

---

## Backend (Factor8 agent)

The agent prompt and the API are in [LeanLabs0/factor8-agent-sdk](https://github.com/LeanLabs0/factor8-agent-sdk).
Surveys and reputation state are set on the server.
Do not change prompts or trackers if you do not do a full test.
Refer to HANDOFF.md.

---

## Reset the session (browser)

Use the DevTools console:

```js
rrReset();
```

This command clears session storage and loads the page again.

---
