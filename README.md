# Reputation Rocket — Prototype

A 5-step review-collection flow that drafts platform-specific reviews and walks customers through posting them. The agent backend runs on Fly (Factor 8 SDK); this repo is the customer-facing static UI.

> **For Edward:** start with [HANDOFF.md](./HANDOFF.md). It covers V1 scope, API contract, what's built, what you need to build, and the V2 platform research.

---

## Quick start (local dev)

```bash
python serve.py
# → http://localhost:8888
```

`serve.py` is a tiny Python `http.server` that also proxies `/api/*` requests to the live agent on Fly (`https://factor8-agent-sdk.fly.dev`) so the chat works locally.

Open with a personalized URL:

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

## Files

| File | Purpose |
|---|---|
| `index.html` | SPA markup — 7 screens (Welcome, Chat, Draft, Post, Video, Complete, Negative) |
| `app.js` | State machine, agent calls, draft tab logic, post-screen card variants |
| `styles.css` | Lean Labs design tokens (Poppins, purple/magenta/orange gradient) |
| `serve.py` | Local dev server + `/api/*` → Fly proxy |
| `_redirects` | Netlify equivalent of the proxy (one line: `/api/* → fly.dev/api/:splat`) |
| `HANDOFF.md` | Developer handoff doc — read this first |

## URL params (per-customer link)

| Param | Required | Notes |
|---|---|---|
| `company` | yes | Client name shown in chat |
| `name` | yes | Customer first+last |
| `email` | yes | Tracked, not shown |
| `platforms` | yes | CSV: `hubspot,g2,google` |
| `review_<platform>` | yes per platform | Review URL for each platform |
| `video_url` | no | testimonial.to link → enables Screen 5 |
| `welcome_video_url` | no | mp4 → Screen 1 video |
| `thank_you_url` | no | Client's thank-you page → redirect after 5s on Screen 6/7 |

## Backend

Lives in the [LeanLabs0/factor8-agent-sdk](https://github.com/LeanLabs0/factor8-agent-sdk) repo:

- **Agent prompt:** `.claude/agents/reputation-rocket.md`
- **API + state tracker:** `src/factor8/api/routes/query.py` (`_build_reputation_rocket_state`)
- **Deploy:** `fly deploy --app factor8-agent-sdk`

Don't change the agent prompt or the SURVEY STATE tracker without testing the full survey end-to-end. See HANDOFF.md for the test script.

## Reset session

DevTools console:
```js
rrReset()
```

Wipes sessionStorage and reloads.
