# Scout: Social Media Cross-Platform Posting Research

**Date:** 2026-03-16  
**Scout:** Paloma  
**Mission:** Research all options for posting to multiple social media platforms from one place — SaaS tools, open-source, developer APIs. Deliver a buy-vs-build recommendation.

---

## TL;DR Recommendation

**Use Postiz (self-hosted, open-source).** It's the strongest option by a significant margin — 28+ platforms, REST API + NodeJS SDK, Docker deployment, active project. Wrapping it as an MCP tool is straightforward. No monthly SaaS fees. No vendor lock-in.

If self-hosting is off the table, **Ayrshare** is the cleanest unified API with the broadest coverage, but costs $99+/month.

---

## Top 3-5 Recommendations

### #1: Postiz (self-hosted) ⭐⭐⭐⭐⭐
**Type:** Open-source, self-hosted  
**GitHub:** `github.com/gitroomhq/postiz-app` (AGPL-3.0)  
**Platforms:** **28+** — X, LinkedIn, LinkedIn Page, Reddit, Instagram, Facebook Page, Threads, YouTube, Google My Business, TikTok, Pinterest, Dribbble, **Discord**, **Slack**, Kick, Twitch, Mastodon, Bluesky, Lemmy, Farcaster, Telegram, Nostr, VK, Medium, Dev.to, Hashnode, WordPress, ListMonk  
**Tech Stack:** NextJS + NestJS + Prisma/PostgreSQL + Temporal  
**Integration Points:** REST API, NodeJS SDK (`@postiz/node`), N8N custom node, Make.com app  
**Deployment:** Docker (docker-compose)  
**Cost:** Free to self-host. Platform API costs only.

**Why #1:**
- Covers every platform Adam wants (and more — Discord, Slack, Telegram, Mastodon, Bluesky all included)
- Has a proper REST API + NodeJS SDK → wrap as MCP tool in ~1 hour
- Handles OAuth complexity with individual platforms for you
- Enterprise tier has a "Skip App Approvals" feature (uses Postiz's pre-approved developer apps, avoiding months-long Meta/TikTok review processes)
- ~3M Docker downloads, active development, 20K+ GitHub stars
- N8N node already exists — if Adam uses n8n, zero custom code needed
- Uses official OAuth flows for all platforms (no scraping/terms violations)
- The `postiz-agent` CLI is specifically designed for AI agent integration

**Caveats:**
- Requires Docker + PostgreSQL to run
- AGPL-3.0 license (copyleft — fine for personal use, matters if distributing as SaaS)
- Some platforms use Postiz's own developer app credentials → depends on their approval status with platforms

---

### #2: Ayrshare ⭐⭐⭐⭐
**Type:** Unified REST API (SaaS)  
**Platforms:** ~30 — Facebook, Instagram, TikTok, LinkedIn, X, Reddit, Pinterest, YouTube, Telegram, Threads, Google Business, Discord, and more  
**Cost:** Free Basic tier (limited), Premium ~$99/month, Business custom pricing (per active profile)  
**Integration:** REST API, documented endpoints

**Why #2:**
- Best-in-class unified API, widely used by developers
- Handles app approval complexity — you use their pre-approved apps
- No OAuth/token management per platform
- Has a developer-friendly REST API that maps cleanly to MCP tool pattern
- Covers both posting and analytics in one API

**Caveats:**
- $99/month for serious use — costs add up
- Vendor dependency; price changes are their call
- You're trusting their API to stay available

---

### #3: Late (getlate.dev) ⭐⭐⭐⭐
**Type:** Unified REST API (SaaS)  
**Platforms:** 13 — X/Twitter, Instagram, TikTok, LinkedIn, Facebook, YouTube, Threads, Reddit, Pinterest, Bluesky, Google Business, Telegram, Snapchat  
**Cost:** Free tier, paid plans by volume  
**Integration:** REST API, clean developer experience

**Why #3:**
- Very clean REST API with sensible design (one endpoint, `platforms: ["twitter", "instagram"]`)
- Free tier for low volume
- Good documentation with code examples
- Snapchat coverage (rare in competitors)
- Published developer comparison tables

**Caveats:**
- 13 platforms only — misses Discord, Mastodon, Slack vs. Postiz's 28+
- Newer/smaller company — longevity risk vs. Postiz

---

### #4: Buffer ⭐⭐⭐
**Type:** SaaS scheduling tool  
**Platforms:** Facebook, X, LinkedIn, Pinterest, Instagram, TikTok, YouTube, Google Business, Mastodon, Bluesky, Threads (no Discord, no Telegram)  
**Cost:** Free (3 channels), $6/month per channel for Essentials  
**Integration:** REST API available

**Why #4:**
- Polished UX, battle-tested reliability
- Free tier is genuinely useful for personal use
- Has a public API  
- Good choice if you want a SaaS dashboard with minimal setup

**Caveats:**
- Per-channel pricing adds up fast (10 channels = $60+/month)
- Missing Discord, Telegram — notable gaps
- Not ideal for deep API integration vs. dedicated API services

---

### #5: n8n (automation) ⭐⭐⭐
**Type:** Workflow automation platform (self-hosted or cloud)  
**Platforms:** Via native nodes: Facebook, X, LinkedIn, Instagram, YouTube, Discord, Telegram, Reddit, Mastodon + more via HTTP nodes  
**Cost:** Free self-hosted, $20+/month cloud  
**Integration:** 490+ social media workflow templates, API/webhook native

**Why #5:**
- If Adam already uses n8n, this is a natural extension
- Postiz has a native n8n node — use both together
- Can build complex multi-platform logic (AI + post + schedule)
- Self-hostable

**Caveats:**
- Not purpose-built for social posting
- Requires workflow design per use case
- More general-purpose than targeted

---

## Platform Coverage Matrix

| Platform | Postiz | Buffer | Ayrshare | Late | Build Custom |
|----------|--------|--------|----------|------|-------------|
| **X/Twitter** | ✅ | ✅ | ✅ | ✅ | ⚠️ ($200/mo API) |
| **Instagram** | ✅ | ✅ | ✅ | ✅ | ⚠️ (Meta review) |
| **Facebook Page** | ✅ | ✅ | ✅ | ✅ | ⚠️ (Graph API, page required) |
| **LinkedIn** | ✅ | ✅ | ✅ | ✅ | ✅ (w_member_social scope) |
| **TikTok** | ✅ | ✅ | ✅ | ✅ | ⚠️ (app audit required) |
| **YouTube** | ✅ | ✅ | ✅ | ✅ | ✅ (Data API + OAuth) |
| **Threads** | ✅ | ✅ | ✅ | ✅ | ⚠️ (Meta developer acct) |
| **Pinterest** | ✅ | ✅ | ✅ | ✅ | ✅ (developer approval) |
| **Reddit** | ✅ | ❌ | ✅ | ✅ | ✅ (OAuth, PRAW) |
| **Bluesky** | ✅ | ✅ | ✅ | ✅ | ✅ (trivial — AT Protocol) |
| **Mastodon** | ✅ | ✅ | ✅ | ❌ | ✅ (OAuth, easy) |
| **Discord** | ✅ | ❌ | ✅ | ❌ | ✅ (webhooks — trivial) |
| **Telegram** | ✅ | ❌ | ✅ | ✅ | ✅ (Bot API — trivial) |
| **Slack** | ✅ | ❌ | ❌ | ❌ | ✅ (Incoming Webhooks) |
| **YouTube Community** | ❌ | ❌ | ❌ | ❌ | ❌ (NOT in YouTube API) |
| **Facebook Groups** | ❌ | ❌ | ❌ | ❌ | ❌ (Meta removed API) |
| **Dev.to / Medium** | ✅ | ❌ | ❌ | ❌ | ✅ (simple REST APIs) |

**Important: YouTube Community Posts are NOT available through any official API.** The YouTube Data API does not expose community post creation — it's a YouTube-only feature. No workaround exists without automation tools that violate ToS.

**Facebook Groups posting was removed from the Graph API.** Facebook Pages posting still works; Groups does not via API.

---

## Individual Platform API Deep Dive

### Bluesky — EASIEST ✅
- **Protocol:** AT Protocol (open, documented at docs.bsky.app)
- **Auth:** App password (no OAuth ceremony, 2 minutes to set up)
- **Approval:** None needed
- **Rate limits:** Generous (default 300 creates/day)
- **Posting:** Text, images, links, threads — all supported
- **Cost:** Free
- **MCP integration:** Trivial. `@atproto/api` npm package is excellent.
- **Verdict: Start here. No friction whatsoever.**

### Discord — TRIVIAL ✅
- **Method 1 (Webhooks):** Create webhook in server settings → HTTP POST to URL. Zero auth. Zero code setup. Works immediately.
- **Method 2 (Bot API):** More control (reactions, threads), requires bot app, token — still very easy.
- **Rate limits:** 30 messages/minute per webhook
- **Cost:** Free
- **Verdict: Webhooks are 5-minute setup. Just do it.**

### Mastodon — EASY ✅
- **Protocol:** ActivityPub, REST API at `/api/v1/statuses`
- **Auth:** OAuth 2.0 or app-level access token from instance settings
- **Approval:** None needed (per-instance)
- **Cost:** Free
- **Note:** Decentralized — one API call per instance you post to, or use a bridge to federate

### Telegram — EASY ✅
- **Method:** Bot API via @BotFather
- **Setup:** Create bot, get token, send messages to channels
- **Cost:** Free
- **Verdict: 10-minute setup from zero to posting.**

### LinkedIn — MEDIUM ✅
- **API:** UGC Posts API (`/v2/ugcPosts`)
- **Auth:** OAuth 2.0, `w_member_social` scope (available to all developers, no approval required for basic posting)
- **Rate limits:** 100 post creates/day per user
- **Cost:** Free
- **Partner program:** Required for company pages analytics, DMs. Not needed for personal posts.
- **Verdict: Straightforward. w_member_social works without approval.**

### Reddit — MEDIUM ✅
- **Library:** PRAW (Python) or direct OAuth to `oauth.reddit.com`
- **Auth:** OAuth 2.0, register a "script" app at reddit.com/prefs/apps
- **Scopes:** `submit` for posting
- **Cost:** Free (100 QPM rate limit)
- **New in 2025:** "Responsible Builder Policy" — new approval process for some use cases
- **Verdict: Still accessible for personal automation. Register a script-type app.**

### Facebook Pages — MEDIUM ⚠️
- **API:** Graph API, Pages API
- **Auth:** OAuth, requires page access token
- **Requirement:** Must be page admin, must have a Facebook Page (not personal profile)
- **Approval:** Meta developer app review required for production/public use. For personal use on your own page, app in Development mode is sufficient.
- **Cost:** Free (rate limits based on page reach)
- **Verdict: Works for your own pages without going through full review.**

### Instagram — HARD ⚠️
- **API:** Instagram Graph API (part of Meta Graph)
- **Requirement:** Must have Business or Creator account (personal accounts NOT supported)
- **Auth:** OAuth via Facebook Login
- **Approval:** Meta App Review required for apps used by other people. For personal/your own account, Development mode works.
- **Limit:** 100 posts/24 hours via API
- **Note:** Meta deprecated Basic Display API. Feed posts, Reels, and Carousels supported via content publishing API.
- **Verdict: Works for your own business/creator account without full review. Personal account? Switch to Business first.**

### Threads — MEDIUM ⚠️
- **API:** Official Threads API (launched 2024)
- **Requirement:** Meta developer account, linked to Threads account
- **Auth:** OAuth via Meta
- **Features:** Publish posts, retrieve content, manage replies, analytics
- **Verdict: Accessible but requires Meta developer setup.**

### TikTok — HARD ⚠️⚠️
- **API:** Content Posting API
- **Unaudited:** Posts go private only, 5 users/24hr cap — effectively useless for real use
- **Audited:** Must submit app for TikTok review — can take weeks
- **Verdict: Only viable via Postiz/Ayrshare (pre-approved apps). Direct API integration is gated behind app audit.**

### X/Twitter — EXPENSIVE ⚠️⚠️
- **Free tier:** Exists but crippled — 1,500 posts/month, no read search
- **Basic tier:** $200/month — minimum viable for any real app
- **Higher tiers:** $5,000-$42,000/month
- **Auth:** OAuth 2.0
- **Verdict: Use Postiz or another unified tool to abstract this cost. Direct API is only worth it at $200+/month.**

### YouTube — MEDIUM ✅
- **API:** YouTube Data API v3 (Google)
- **Posting:** Videos only — upload + metadata. Community Posts NOT available via API.
- **Auth:** OAuth 2.0, Google developer account
- **Quota:** 10,000 units/day free (uploads are 1,600 units each → ~6 uploads/day on free tier)
- **Verdict: Fine for video uploads. Community Posts are a hard no via API.**

---

## Buy vs. Build Recommendation

### Short Answer: **Buy Postiz (self-host)**

**This isn't even close.** Postiz gives us 28 platforms, handles OAuth, has a REST API and NodeJS SDK, and costs $0 beyond platform-tier API fees. Building custom from scratch would take months and miss platforms like TikTok (approval-gated), Instagram (Meta review), and X (expensive).

### The Trade-Offs Table

| Approach | Cost | Time-to-first-post | Platform coverage | Maintenance |
|----------|------|--------------------|-------------------|-------------|
| **Postiz (self-host)** | $0 + hosting | 1-2 hours (Docker) | 28+ | Low (upstream OSS) |
| **Ayrshare API** | $99-299+/mo | 1-2 hours | 30+ | Minimal |
| **Late.dev API** | $20+/mo | 1-2 hours | 13 | Minimal |
| **Buffer API** | $6+/channel/mo | 1-2 hours | 12 | Minimal |
| **Custom build** | Dev time | Weeks-months | ~8 easy, rest gated | High |

### If Budget is Zero: **Postiz + free-tier manual approach for X**
Postiz self-hosted covers everything for free except the underlying platform API costs (which are only an issue for X/Twitter at scale).

### If You Want Zero Infrastructure: **Ayrshare at $99/month**
Handles everything, pre-approved apps, great REST API. Worth it if you don't want to run a Docker stack.

---

## If We Build Custom — Starting Order

The "build custom" path makes most sense for a subset of platforms that are genuinely easy:

**Tier 1 — Start here (trivial, free, no approval):**
1. **Bluesky** — AT Protocol, `@atproto/api`, app password. Done in 30 minutes.
2. **Discord** — Webhook URL, HTTP POST. Done in 5 minutes.
3. **Telegram** — Bot API, BotFather token. Done in 10 minutes.
4. **Mastodon** — ActivityPub REST API, instance token. Done in 30 minutes.

**Tier 2 — Worth doing directly (medium effort, free):**
5. **LinkedIn** — OAuth + `w_member_social` scope, no approval needed.
6. **Reddit** — PRAW or direct OAuth, script-type app.
7. **Facebook Pages** — Graph API, development mode works for own pages.

**Tier 3 — Use a unified service (gated/expensive):**
8. **Instagram** — Use Postiz/Ayrshare, not worth fighting Meta review solo.
9. **Threads** — Use Postiz/Ayrshare (Meta ecosystem).
10. **TikTok** — Use Postiz/Ayrshare (app audit required otherwise).
11. **X/Twitter** — Only direct if spending $200+/month is justified.

---

## Recommended Architecture (Paloma Integration)

### Option A: Postiz-as-MCP-Tool (RECOMMENDED)

```
Paloma (Flow/Forge) 
  → mcp__paloma__social__post(platforms, content, media)
    → Postiz REST API (self-hosted on same VPS/WSL)
      → Platform-specific APIs (handled by Postiz)
```

1. Deploy Postiz via Docker on Adam's machine or a cheap VPS
2. Connect social accounts in Postiz UI (one-time OAuth per platform)
3. Wrap Postiz's REST API as a new MCP server: `mcp-servers/social.js`
4. Tools: `social_post`, `social_schedule`, `social_get_accounts`, `social_analytics`

**Postiz REST API** is already documented at `docs.postiz.com/public-api`. The NodeJS SDK (`@postiz/node`) handles auth/request boilerplate.

### Option B: Thin Custom MCP for Easy Platforms + Postiz for Hard Ones

Start with Tier 1 platforms (Bluesky, Discord, Telegram, Mastodon) natively in an MCP server, and route everything else through Postiz.

### Option C: Ayrshare-as-MCP-Tool

Same pattern as Option A but via Ayrshare's API. No Docker stack, but $99+/month.

---

## Key Open Questions for Chart/Adam

1. **YouTube Community Posts** — These are NOT available via any API. If this is a requirement, the only path is Selenium/automation (ToS risk). Worth discussing explicitly.

2. **Facebook personal profile** — The Graph API dropped support for personal profile posting (Pages only). Is a Facebook Page sufficient, or does Adam need personal timeline posts?

3. **X/Twitter cost tolerance** — $200/month for real API access. Is X a priority given cost? Or acceptable to handle manually/skip?

4. **TikTok priority** — App audit required for production use. Postiz Enterprise bypasses this. Is TikTok high-priority enough to use Postiz Enterprise for their pre-approved app credentials?

5. **Self-hosting preference** — Postiz requires Docker + PostgreSQL. Is that acceptable, or does Adam prefer a fully-managed SaaS?

6. **Multi-account vs. single account** — Does Adam need to post to multiple accounts per platform (e.g., multiple Twitter accounts), or one account per platform?

---

## Files to Read Next (if building)

- Postiz API docs: `https://docs.postiz.com/public-api`  
- Postiz NodeJS SDK: `https://www.npmjs.com/package/@postiz/node`
- Postiz Docker quickstart: `https://docs.postiz.com/quickstart`
- Bluesky AT Protocol: `https://docs.bsky.app`
- Discord Webhooks: `https://discord.com/developers/docs/resources/webhook`

---

*Research complete. Findings ready for Chart.*
