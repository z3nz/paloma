# Social Poster — Cross-Platform Posting via Postiz

> **Goal:** Build a self-hosted Postiz-backed MCP server that lets Paloma post to 10+ social platforms conversationally. Adam keeps manual control over YouTube, X/Twitter, Facebook, and Instagram. Everything else is automated.
> **Status:** Active — WU-1/2/3/4 complete, WU-5 blocked (Docker Desktop not available in WSL2)
> **Created:** 2026-03-16
> **Pipeline:** ~~Scout~~ → ~~Chart~~ → **Forge** → Polish → Ship

---

## Research References

- **Scout findings:** `.paloma/docs/scout-social-media-crossposting-20260316.md`
- **Postiz API docs:** `https://docs.postiz.com/public-api`
- **Postiz Docker quickstart:** `https://docs.postiz.com/quickstart`
- **Postiz NodeJS SDK:** `https://www.npmjs.com/package/@postiz/node`
- **MCP server pattern reference:** `mcp-servers/web.js` (same structure)
- **MCP settings:** `~/.paloma/mcp-settings.json`

---

## Platform Strategy

### Manual (Adam posts directly)
YouTube, X/Twitter, Facebook, Instagram — the "big four." No API integration needed.

### Automated via Postiz (Paloma handles)
| Platform | Difficulty | Notes |
|----------|-----------|-------|
| Discord | Trivial | Postiz handles webhook/bot |
| Telegram | Trivial | Postiz handles Bot API |
| Bluesky | Easy | AT Protocol via Postiz |
| Mastodon | Easy | ActivityPub via Postiz |
| LinkedIn | Medium | OAuth via Postiz, `w_member_social` scope |
| Reddit | Medium | OAuth via Postiz |
| Threads | Medium | Meta ecosystem via Postiz |
| Medium | Easy | REST API via Postiz |
| Dev.to | Easy | REST API via Postiz |
| TikTok | Hard | Requires app audit — use Postiz's credentials if available, otherwise skip initially |

### Known Limitations
- **YouTube Community Posts** — no API exists anywhere. Not possible.
- **Facebook Groups** — Meta removed the API. Not possible.
- **TikTok** — requires app audit for production use. Self-hosted Postiz free tier may not include pre-approved credentials. If TikTok doesn't work out of the box, skip it for now and revisit when/if Postiz adds shared credentials for self-hosted.
- **X/Twitter** — $200/month for real API access. Adam posts manually instead.

---

## Architectural Decisions

### AD-1: Thin MCP wrapper around Postiz REST API
The MCP server is a thin client that forwards requests to the local Postiz instance. Postiz handles all OAuth, token management, content formatting, and platform-specific logic. The MCP server does NOT re-implement any platform API integration.

**Why:** Postiz already solved the hard problems (28+ platform integrations, OAuth flows, rate limiting). Duplicating that logic in the MCP server would be massive scope creep. Thin wrapper = fast to build, easy to maintain, benefits from upstream Postiz improvements.

### AD-2: `@postiz/node` SDK as primary client, direct REST as fallback
Use the official Postiz NodeJS SDK if it covers our needs. Fall back to direct HTTP calls to the Postiz REST API for anything the SDK doesn't expose.

**Why:** SDK provides type safety and abstracts API versioning. But it's a young project — may not cover all endpoints. Direct REST is always available as escape hatch.

### AD-3: Project in `projects/social-poster/` with own git repo
Follows the established pattern: personal/business tools live in `projects/` with their own git history, separate from Paloma's core repo. This is NOT an `mcp-servers/` tool.

**Why:** Adam's explicit decision. Matches the project separation rule (fadden-demo, verifesto-studios pattern). Keeps Paloma's core repo focused on AI infrastructure.

### AD-4: Docker Compose at project root
The `docker-compose.yml` for Postiz + PostgreSQL + Redis lives at `projects/social-poster/` root alongside the MCP server code. One project, one directory, one repo.

**Why:** Everything for social posting lives together. `docker compose up` in the project dir starts the backend. `node server.js` starts the MCP server. Simple.

### AD-5: Content passed through, not adapted
The MCP `social_post` tool accepts content as-is and passes it to Postiz. Postiz handles platform-specific content adaptation (character limits, media formatting, etc.). The MCP server does NOT implement its own content adaptation layer.

**Why:** Postiz's whole value proposition is handling per-platform differences. Adding a content adapter in the MCP server would be redundant and would drift out of sync with Postiz's logic. If specific platform formatting is needed, Adam can specify it in the post content or we revisit later.

### AD-6: Postiz API key via environment variable
The MCP server reads `POSTIZ_API_URL` and `POSTIZ_API_KEY` from its environment (set in `mcp-settings.json` env block). The API key is generated from Postiz's settings UI after deployment.

**Why:** Matches the pattern of other MCP servers (brave-search uses `BRAVE_API_KEY`, cloudflare-dns uses `CLOUDFLARE_API_TOKEN`). No secrets in code.

---

## Project Structure

```
projects/social-poster/
├── docker-compose.yml        # Postiz + PostgreSQL + Redis
├── .env.example              # Template for all env vars (committed)
├── .env                      # Actual env vars (gitignored)
├── package.json              # MCP server dependencies
├── server.js                 # MCP server entry point (4 tools)
├── postiz-client.js          # Postiz REST API client wrapper
├── .gitignore
└── README.md                 # Setup guide, platform connection docs
```

---

## MCP Tool Definitions

### `social_post`
Post content to one or more connected platforms immediately.

```json
{
  "content": "Text content of the post",
  "platforms": ["discord", "telegram", "bluesky"],
  "media": [{ "url": "https://...", "path": "/local/path.jpg" }],
  "title": "Optional title (Reddit, Medium, Dev.to)"
}
```
Returns: post IDs/URLs per platform, any failures.

### `social_schedule`
Schedule a post for future publication.

```json
{
  "content": "Text content",
  "platforms": ["linkedin", "mastodon"],
  "scheduledAt": "2026-03-17T10:00:00Z",
  "media": [{ "url": "https://..." }],
  "title": "Optional title"
}
```
Returns: scheduled post IDs, confirmation per platform.

### `social_list_accounts`
List all connected social accounts and their status.

```json
{}
```
Returns: array of `{ platform, username, status, id }`.

### `social_analytics`
Get engagement metrics for recent posts.

```json
{
  "platform": "linkedin",
  "limit": 10
}
```
Returns: array of `{ postId, platform, likes, shares, comments, impressions, postedAt }`.

---

## Work Units

### WU-1: Project Scaffold + Git Init
**Description:** Create the `projects/social-poster/` directory, initialize the Node.js project, install dependencies, set up git repo.

**Dependencies:** None

**Files to create:**
- `projects/social-poster/package.json` — name: `@paloma/social-poster`, type: module, dependencies: `@modelcontextprotocol/sdk`, `@postiz/node`
- `projects/social-poster/.gitignore` — node_modules, .env, *.log
- `projects/social-poster/.env.example` — template with all required env vars (Postiz URL, API key, Docker config)
- `projects/social-poster/README.md` — setup instructions stub (expanded in WU-6)

**Commands:**
```bash
cd projects/social-poster
npm init -y  # then edit package.json
npm install @modelcontextprotocol/sdk @postiz/node
git init
git add -A && git commit -m "chore: scaffold social-poster project"
```

**Acceptance criteria:**
- [ ] Directory exists at `projects/social-poster/`
- [ ] `package.json` has correct dependencies
- [ ] `.gitignore` excludes node_modules, .env
- [ ] `.env.example` documents all required env vars
- [ ] Git repo initialized with initial commit

---

### WU-2: Docker Compose for Postiz Stack
**Description:** Create Docker Compose configuration for Postiz + PostgreSQL + Redis. Include all environment variables needed for Postiz to run.

**Dependencies:** None (file-disjoint with WU-1 — can run in parallel)

**Files to create:**
- `projects/social-poster/docker-compose.yml` — Postiz app + PostgreSQL + Redis services

**Design details:**

Postiz Docker stack requires three services:
1. **postiz** — `ghcr.io/gitroomhq/postiz-app:latest` — the main app (NextJS frontend + NestJS backend)
2. **postgres** — `postgres:17` — database
3. **redis** — `redis:7` — caching/queues

Key environment variables for the Postiz container:
```yaml
DATABASE_URL: postgres://postiz:${POSTGRES_PASSWORD}@postgres:5432/postiz
REDIS_URL: redis://redis:6379
NEXT_PUBLIC_BACKEND_URL: http://localhost:3000
BACKEND_INTERNAL_URL: http://localhost:3000
JWT_SECRET: ${JWT_SECRET}
UPLOAD_DIRECTORY: /uploads
NEXT_PUBLIC_UPLOAD_DIRECTORY: /uploads
```

Port mapping: `3000:5000` (map Postiz's internal port to localhost:3000, or similar — verify in Postiz docs).

Volume mounts:
- `postiz-postgres:/var/lib/postgresql/data` — database persistence
- `postiz-uploads:/uploads` — media uploads

The `.env.example` (from WU-1) should include:
```
# Postiz
POSTIZ_API_URL=http://localhost:3000
POSTIZ_API_KEY=  # Generate from Postiz Settings > API

# Docker/PostgreSQL
POSTGRES_PASSWORD=changeme
JWT_SECRET=changeme-generate-a-random-string
```

**Acceptance criteria:**
- [ ] `docker compose up -d` starts all 3 services
- [ ] Postiz UI accessible at configured port
- [ ] PostgreSQL data persists across restarts (named volume)
- [ ] `.env.example` documents all required environment variables

---

### WU-3: MCP Server + Postiz Client
**Description:** Build the MCP server that exposes 4 tools (`social_post`, `social_schedule`, `social_list_accounts`, `social_analytics`) backed by the Postiz REST API.

**Dependencies:** WU-1 (needs package.json and dependencies installed)

**Files to create:**
- `projects/social-poster/server.js` — MCP server entry point. Registers 4 tools, delegates to postiz-client.js.
- `projects/social-poster/postiz-client.js` — Postiz REST API client. Handles auth, request formatting, error handling.

**Design details:**

`server.js` follows the exact pattern of `mcp-servers/web.js`:
- Import `Server`, `StdioServerTransport`, `ListToolsRequestSchema`, `CallToolRequestSchema` from `@modelcontextprotocol/sdk`
- Create server with `name: 'social-poster', version: '1.0.0'`
- Register 4 tools with full inputSchema definitions
- Route tool calls to postiz-client.js functions

`postiz-client.js` exports:
- `createPost({ content, platforms, media, title })` — POST to Postiz create-post endpoint
- `schedulePost({ content, platforms, media, title, scheduledAt })` — POST with schedule param
- `listAccounts()` — GET connected accounts/integrations
- `getAnalytics({ platform, limit })` — GET post analytics/metrics
- All functions read `POSTIZ_API_URL` and `POSTIZ_API_KEY` from `process.env`
- All functions return structured results or throw with clear error messages
- 30-second timeout on all HTTP requests

**SDK vs REST decision for Forge:**
Try `@postiz/node` SDK first. If it covers all 4 operations cleanly, use it. If it's missing endpoints or poorly documented, fall back to direct `fetch()` calls against the Postiz REST API. Either way, `postiz-client.js` abstracts the implementation — `server.js` doesn't care which approach is used underneath.

**Error handling:**
- Missing env vars → clear startup error message (fail fast, don't silently break)
- Postiz unreachable → return `isError: true` with "Postiz is not running" message
- Platform-specific failures → return partial success (some platforms posted, some failed) with per-platform status

**Acceptance criteria:**
- [ ] MCP server starts and registers all 4 tools
- [ ] `social_post` sends content to Postiz and returns per-platform results
- [ ] `social_schedule` creates a scheduled post and returns confirmation
- [ ] `social_list_accounts` returns connected platforms and account details
- [ ] `social_analytics` returns engagement metrics for recent posts
- [ ] Missing `POSTIZ_API_URL` or `POSTIZ_API_KEY` produces clear startup error
- [ ] Postiz connection failures return helpful error messages (not stack traces)

---

### WU-4: MCP Registration + Bridge Integration
**Description:** Register the social-poster MCP server in Paloma's mcp-settings.json so it's accessible from all Paloma sessions.

**Dependencies:** WU-2, WU-3 (Postiz running + MCP server code ready)

**Files to modify:**
- `~/.paloma/mcp-settings.json` — add `social-poster` server entry

**Design details:**

Add to mcp-settings.json:
```json
"social-poster": {
  "command": "node",
  "args": ["/home/adam/paloma/projects/social-poster/server.js"],
  "env": {
    "POSTIZ_API_URL": "http://localhost:3000",
    "POSTIZ_API_KEY": "<from-postiz-settings>"
  }
}
```

After registration, restart the bridge so the new MCP server is loaded.

**Acceptance criteria:**
- [ ] `social-poster` entry added to mcp-settings.json
- [ ] Bridge restart picks up new server
- [ ] All 4 tools visible in Paloma's tool list
- [ ] Tools callable from a Paloma session (Flow or any pillar)

---

### WU-5: Platform Connection + End-to-End Testing
**Description:** Connect social accounts in Postiz UI and test posting to each automated platform. Document which platforms work, which have issues, and any platform-specific quirks.

**Dependencies:** WU-4 (MCP server registered and accessible)

**This is an execution + documentation task.**

**Platforms to connect and test (in order of ease):**
1. Discord — webhook or bot connection
2. Telegram — Bot API via BotFather token
3. Bluesky — app password (no OAuth ceremony)
4. Mastodon — instance token
5. LinkedIn — OAuth in Postiz UI
6. Reddit — OAuth in Postiz UI
7. Medium — integration token
8. Dev.to — API key from settings
9. Threads — Meta OAuth in Postiz UI
10. TikTok — attempt connection; skip if requires app audit

**Test procedure per platform:**
1. Connect account in Postiz UI
2. Call `social_list_accounts` — verify platform shows as connected
3. Call `social_post` with test content — verify post appears on platform
4. Call `social_analytics` — verify metrics are retrievable (may need to wait for data)

**Files to update:**
- `projects/social-poster/README.md` — document connection steps per platform, known issues, platform-specific quirks

**Acceptance criteria:**
- [ ] At least 6 platforms connected and posting successfully
- [ ] `social_list_accounts` returns all connected platforms
- [ ] `social_post` to multiple platforms simultaneously works
- [ ] `social_schedule` creates a future post that appears in Postiz queue
- [ ] README.md documents connection steps and any platform-specific notes
- [ ] Failures on any platform are documented with workaround or "skip for now" decision

---

### WU-6: Ship
**Description:** Final commits, push to remote, archive plan.

**Dependencies:** WU-5

**Steps:**
1. Ensure all code is committed in `projects/social-poster/` git repo
2. Create GitHub remote repo (private) and push
3. Final commit in Paloma repo for mcp-settings.json changes + plan archival
4. Push Paloma repo to main
5. Write lessons learned to `.paloma/lessons/`

**Acceptance criteria:**
- [ ] `projects/social-poster/` repo pushed to GitHub (private)
- [ ] Paloma repo changes pushed to main
- [ ] Plan renamed to `completed-20260316-social-poster-crossplatform.md`
- [ ] Lessons written if any novel patterns emerged

---

## Dependency Graph

```
WU-1 (Scaffold)  ──→ WU-3 (MCP Server) ──┐
                                            ├──→ WU-4 (Registration) ──→ WU-5 (Testing) ──→ WU-6 (Ship)
WU-2 (Docker)    ─────────────────────────┘
```

**Parallel dispatch opportunities:**
- **Round 1:** WU-1 + WU-2 (file-disjoint, no dependencies)
- **Round 2:** WU-3 (needs WU-1 for dependencies)
- **Round 3:** WU-4 (needs WU-2 + WU-3)
- **Round 4:** WU-5 (needs WU-4)
- **Round 5:** WU-6 (needs WU-5)

**Estimated Forge sessions:** 2-3
- Session 1: WU-1 + WU-2 (parallel) + WU-3 (sequential after WU-1)
- Session 2: WU-4 + WU-5 (deployment + testing, may need Adam for OAuth)
- Session 3: WU-6 (ship)

---

## Success Criteria

1. **Working:** Paloma can post to 6+ platforms via `social_post` from any session
2. **Scheduled:** `social_schedule` queues posts for future publication
3. **Observable:** `social_list_accounts` and `social_analytics` provide visibility
4. **Maintainable:** Thin MCP wrapper means upstream Postiz updates benefit us automatically
5. **Separate:** Project has its own repo, own git history, clean separation from Paloma core
6. **Documented:** README covers setup, platform connections, and known limitations

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| `@postiz/node` SDK incomplete or broken | Fall back to direct REST API calls via fetch() — postiz-client.js abstracts either approach |
| TikTok requires app audit | Skip TikTok initially; revisit if Postiz adds shared credentials for self-hosted |
| Postiz Docker image large or unstable | Pin to specific version tag, not `latest`. Test before committing to it. |
| Postiz API changes | SDK or REST wrapper isolates changes to postiz-client.js only |
| Platform OAuth tokens expire | Postiz handles token refresh internally — this is their core feature |
| Docker resource usage on WSL | PostgreSQL + Redis + Postiz is moderate (~1-2GB RAM). Acceptable on Adam's machine. |

---

---

## Implementation Notes (Forge Session 1 — WU-1, WU-2, WU-3)

**Completed:** 2026-03-16

### WU-1: Project Scaffold
- Created `projects/social-poster/` with `package.json` (`@paloma/social-poster`, ESM module)
- Single dependency: `@modelcontextprotocol/sdk` (SDK removed — see WU-3 notes)
- `.gitignore`, `.env.example` with all Postiz + social media API key documentation
- Git repo initialized, 3 commits on `main`

### WU-2: Docker Compose
- **Key discovery:** Postiz requires a **Temporal workflow engine** stack — not just Postgres + Redis
- Full stack: Postiz app + PostgreSQL 17 + Redis 7.2 + Temporal (auto-setup + Elasticsearch + separate PostgreSQL 16)
- That's 6 containers, not 3. Stripped optional services (Sentry Spotlight, Temporal UI, Temporal admin-tools)
- Port mapping: `4007:5000` (Postiz UI at `http://localhost:4007`)
- All social media API keys pass through from `.env` via `${VAR:-default}` syntax
- Temporal dynamic config (`dynamicconfig/development-sql.yaml`) included from upstream
- Named volumes for all persistent data

### WU-3: MCP Server + Postiz Client
- **SDK dropped:** `@postiz/node@1.0.8` has a CJS/ESM compatibility bug — it uses `require()` for `node-fetch` v3 which is ESM-only. Risk mitigation AD-2 activated: fell back to direct `fetch()` calls.
- `postiz-client.js`: Direct REST client against Postiz public API v1 (`/api/public/v1/*`)
  - Endpoints: `POST /posts` (create/schedule), `GET /posts` (list), `GET /integrations` (accounts), `DELETE /posts/:id`
  - Auth: `Authorization: <apiKey>` header (no Bearer prefix)
  - 30-second timeout on all requests
- `server.js`: MCP server with 4 tools, validated via `tools/list` JSON-RPC call
  - `social_post` — immediate posting to N integrations
  - `social_schedule` — future-dated posting (validates date is future, ISO 8601)
  - `social_list_accounts` — lists connected integrations with formatted output
  - `social_analytics` — returns posts from last N days (no dedicated analytics API in Postiz public API)
- Error handling: missing env vars (fail-fast at startup), connection refused, timeouts — all produce clear messages
- **No analytics endpoint** in Postiz public API — `social_analytics` returns post history instead

### Deviations from Plan
1. **SDK removed** — plan anticipated this (AD-2). Direct REST is cleaner and has zero dependencies beyond MCP SDK.
2. **Docker stack is 6 containers** not 3 — Temporal is required. Plan underestimated infrastructure.
3. **No Bearer prefix** in auth — Postiz uses raw API key in Authorization header.
4. **Post schema uses integration IDs** not platform names — users must call `social_list_accounts` first to get IDs.

---

## Implementation Notes (Flow Session — WU-4)

**Completed:** 2026-03-18

### WU-4: MCP Registration + Bridge Integration
- Added `social-poster` entry to `~/.paloma/mcp-settings.json` with placeholder API key (`CONFIGURE_AFTER_DOCKER_SETUP`)
- Added `social-poster` to `.paloma/mcp.json` — both `enabled` list and `autoExecute` list (all tools auto-approved)
- Updated `scripts/setup-mcp.sh` to include social-poster with key preservation logic (survives `npm run setup` re-runs)
- POSTIZ_API_URL set to `http://localhost:4007` (matching docker-compose port mapping)

### WU-5 Blocker
- Docker is not available in this WSL2 instance — Docker Desktop needs to be running on Windows with WSL2 integration enabled
- Once Docker is available: `cd projects/social-poster && docker compose up -d`
- Then: create Postiz account at http://localhost:4007, generate API key from Settings > Team, update `~/.paloma/mcp-settings.json`

### Next: WU-5 (Platform Testing, needs Docker) → WU-6 (Ship)
