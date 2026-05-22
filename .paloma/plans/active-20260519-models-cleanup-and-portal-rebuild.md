# Models Dropdown Cleanup + Demo Portal Rebuild — Resume Doc

> **Scope:** Paloma (model dropdown) + Verifesto.com (demo portal MVP)
> **Status:** Active — in flight
> **Created:** 2026-05-19
> **Owner:** Adam + Claude Code (Flow)
> **Built to survive interruption:** every "Next" line below is the exact resume point.

---

## TL;DR — Current State

| Thread | What's happening | Status |
|--------|------------------|--------|
| Model dropdown cleanup | Removed uninstalled entries, reordered Ollama-first, added `qwen3-coder:30b` + `qwen3:8b` | ✅ Shipped (paloma `8b08ddf`) |
| Gemma 4 26B for Flow | In dropdown, bridge supports Ollama for any pillar. Adam to validate end-to-end. | ✅ Code wired — awaiting Adam's smoke test |
| Demo portal rebuild | Re-Forged into `verifesto.com` — backend + frontend, verified via Vite proxy | ✅ Shipped (verifesto.com `67cd7a7` + `6be285e`) |

### Fadden seed credentials (dev only)
- Email: `client@fadden.com`
- Password: `fadden-demo-2026`
- Project: "Fadden Demo" → `https://demo.fadden.com` (placeholder URL — update via Django admin once real demo is hosted)
- Reseed any time: `python manage.py seed_portal --demo-url <real-url>`

### How to run the portal locally
```
# Terminal 1 — Django
cd /Users/adam/Projects/verifesto.com/backend
source .venv/bin/activate
python manage.py runserver 8000

# Terminal 2 — Vite (port 5173 by default, override if conflict)
cd /Users/adam/Projects/verifesto.com/frontend
npm run dev

# Browse: http://localhost:5173/portal/login
```

---

## Adam's Decisions (2026-05-19)

1. **Demo portal recovery:** Re-Forge locally into `verifesto.com` (clean slate, this Mac, push to GitHub).
2. **"Local Gemini" meaning:** Gemma 4 26B via Ollama (truly local), not cloud Gemini 2.5 Pro.
3. **Dropdown cleanup scope:** Show only models that are actually installed/usable.

---

## Thread 1 — Model Dropdown Cleanup

### Files in play
- `/Users/adam/Projects/paloma/src/services/claudeStream.js` — `CLI_MODELS` array (line 11-48)
- `/Users/adam/Projects/paloma/src/components/prompt/ModelSelector.vue` — dropdown groups + ordering (template lines 32-131)

### Installed Ollama models (per `ollama list` 2026-05-19)
- `qwen2.5-coder:7b` (4.7 GB)
- `qwen3:8b` (5.2 GB)
- `qwen3-coder:30b` (18 GB) ← newest, biggest local coder
- `qwen3.5:27b` (17 GB)
- `gemma4:26b` (17 GB) ← Flow workhorse
- `qwen3.5:35b` (23 GB)
- `qwen3.5:9b` (6.6 GB)
- `qwen3-coder:30b-a3b-q8_0` (32 GB quant of qwen3-coder:30b)
- `nomic-embed-text:latest` (embedding only, not chat)

### CLI_MODELS edits
**Remove (not installed):**
- `ollama:qwen2.5-coder:32b` (only `:7b` is here)
- `ollama:quinn-gen5` (needs `qwen3:32b`, not pulled)
- `ollama:holy-trinity` / `ollama:ark` / `ollama:hydra` / `ollama:accordion` (Modelfile aliases, none built)
- `ollama:67` / `ollama:67:8b` (Paestro alias, base model `67` not built)

**Add (installed, missing):**
- `ollama:qwen3-coder:30b` — "Qwen 3 Coder 30B" (the new workhorse)
- `ollama:qwen3:8b` — "Qwen 3 8B" (lighter general-purpose)

**Keep (installed):**
- `ollama:qwen3.5:35b` / `:27b` / `:9b` (Paestro variants)
- `ollama:qwen2.5-coder:7b`
- `ollama:gemma4:26b`

### Dropdown reordering (ModelSelector.vue)
Current: Paloma (CLI) → Direct → Ollama → Codex → Copilot → Gemini → OpenRouter
**New:** Ollama → Gemini → Copilot → Codex → Paloma (CLI) → Direct → OpenRouter

Rationale: free + local first, paid + cloud last. Surfaces Adam's preferred path.

### Status
- [x] Edit `CLI_MODELS` in `claudeStream.js`
- [x] Reorder template groups in `ModelSelector.vue`
- [x] Commit + push to `paloma` repo (commit `8b08ddf`)
- **Next on resume:** N/A — shipped.

---

## Thread 2 — Demo Portal Rebuild (Verifesto.com)

### Why we're rebuilding
The plan `completed-20260331-verifesto-demo-portal-mvp.md` was completed by a **Gemini session on a different machine** (Linux path `/home/adam/paloma/projects/verifesto-studios/`). That session:
- Used a different directory name (`verifesto-studios` vs `verifesto.com`)
- Scaffolded a fresh frontend rather than building on the existing intake
- Never pushed to `git@github.com:z3nz/verifesto.com.git`

So the work effectively doesn't exist on this Mac or on GitHub. Decision: re-Forge cleanly into `/Users/adam/Projects/verifesto.com/`.

### Spec (lifted from completed plan, valid)
Three screens: **Login → Dashboard → Project View (iframe)**.

**Out of scope (deferred):** feedback, updates, uploads, notifications, self-registration, JWT, custom admin UI, AI features.

### Backend tasks (`backend/portal/`)
- [ ] Create `portal` Django app
- [ ] `Project` model (name, client FK to User, demo_url, description, status, timestamps)
- [ ] DRF serializers: `ProjectSerializer`, `LoginSerializer`, `UserSerializer`
- [ ] Views: `LoginView`, `LogoutView`, `MeView`, `ProjectList`, `ProjectDetail`
- [ ] URLs at `/api/portal/login|logout|me|projects|projects/<id>`
- [ ] Permission class filters projects to `request.user`
- [ ] Admin: register `Project` with list display + filters
- [ ] Settings: add `'portal'` to `INSTALLED_APPS`, add `REST_FRAMEWORK` config (SessionAuthentication + IsAuthenticated), session cookie flags
- [ ] `urls.py`: include `portal.urls` at `/api/portal/`
- [ ] Management command `seed_portal` — creates Fadden client user + Fadden project
- [ ] Migrate + seed
- [ ] Smoke test: login → `/api/portal/projects/` returns Fadden project

### Frontend tasks (`frontend/src/`)
- [ ] `npm install vue-router@4`
- [ ] Create `router/index.js` with routes + auth guard
- [ ] Move existing intake logic from `App.vue` → `views/IntakeView.vue`
- [ ] Simplify `App.vue` to `<router-view />`
- [ ] `views/PortalLogin.vue` — email + password, brand styling
- [ ] `views/PortalDashboard.vue` — welcome + project cards
- [ ] `views/PortalProject.vue` — iframe + fullscreen toggle
- [ ] `composables/useAuth.js` — user state, login/logout, CSRF
- [ ] `composables/useProjects.js` — fetchProjects/fetchProject
- [ ] Fix `services/api.js` base URL → relative `/api`
- [ ] `vite.config.js` proxy `/api` → `http://localhost:8000`
- [ ] Manual test: log in as Fadden, see dashboard, click into iframe view

### Commit checkpoints (each gets pushed)
1. `feat(portal): add Django portal app — model, serializers, views, urls, admin`
2. `feat(portal): seed_portal command + first migration`
3. `chore(frontend): add vue-router, move intake into IntakeView`
4. `feat(portal): PortalLogin + useAuth composable`
5. `feat(portal): PortalDashboard + useProjects composable`
6. `feat(portal): PortalProject iframe viewer`
7. `chore(frontend): vite proxy + relative API base URL`

If interrupted between checkpoints, the doc's "Next on resume" line tells me where to pick up.

### Status
- [x] Backend complete (commit `67cd7a7`)
- [x] Frontend complete (commit `6be285e`)
- [x] Smoke test passed — login 200, authed `/me/` 200, `/projects/` returns Fadden, logout 204 with CSRF
- [x] Pushed to `origin/main` of `verifesto.com`
- **Next on resume:** Open the running portal in a browser; replace the placeholder `demo_url` with the real Fadden demo URL via Django admin once it's hosted.

### Known limitations / next steps if Adam wants more
- `demo_url` is a placeholder (`https://demo.fadden.com`) — update via Django admin or re-seed.
- No "forgot password" flow — Django admin can reset, or wire `PasswordResetView` later.
- No CSRF cookie warmup endpoint — relies on the cookie being set on the first authed response. If a fresh-tab POST ever 403s on logout, add `@ensure_csrf_cookie` to `MeView`.
- Production deploy: the Procfile already runs `collectstatic`. The frontend is deployed on Cloudflare Pages and the backend on Railway (per existing repo). The portal routes (`/portal/*`) are SPA paths, so Cloudflare Pages needs a `_redirects` file with `/* /index.html 200` if not already present.

---

## Thread 3 — Gemma 4 26B for Flow (truly local)

Adam's request: experiment with Gemma 4 26B for Flow sessions to see how long-running they can be.

**No code change required** — `ollama:gemma4:26b` is already in `CLI_MODELS` and the bridge already routes Ollama through `OllamaManager`. Once Thread 1 cleanup is done and Ollama is the first group, Adam just selects "Gemma 4 26B" in the dropdown and creates a Flow session.

**Note:** The legacy doc rule "Flow always runs on Claude" is in CLAUDE.md but **not** enforced in `pillar-manager.js` (line 633, 768 accept any backend). So Gemma 4 Flow is supported end-to-end today — it just hasn't been the path Adam takes.

**Validation step (Adam):** Spawn a Flow session on Gemma 4 26B, ask it a few tool-using questions, see if pillar orchestration works on the local model. If MCP tool loops choke on the Ollama bridge, we'll know.

### Status
- [x] Gemma 4 26B installed
- [x] Dropdown entry exists, surfaced at top of Ollama group
- [x] Bridge supports Ollama backend for any pillar
- [ ] Adam to manually validate a Flow session on Gemma 4 26B (open a new chat → pick "Gemma 4 26B (Google)" → spawn Flow → push it with tool-heavy work)
- **Next on resume:** N/A — code-side done. Once Adam validates and decides if Gemma 4 is the new Flow default, this thread closes.

---

## File Locations Cheat Sheet

| Thing | Path |
|-------|------|
| Model dropdown UI | `/Users/adam/Projects/paloma/src/components/prompt/ModelSelector.vue` |
| Model registry | `/Users/adam/Projects/paloma/src/services/claudeStream.js` |
| Portal backend | `/Users/adam/Projects/verifesto.com/backend/portal/` (to create) |
| Portal frontend | `/Users/adam/Projects/verifesto.com/frontend/src/` |
| This doc | `.paloma/plans/active-20260519-models-cleanup-and-portal-rebuild.md` |
| Original portal plan | `.paloma/plans/completed-20260331-verifesto-demo-portal-mvp.md` |
| Verifesto.com git remote | `git@github.com:z3nz/verifesto.com.git` |

---

## How to Resume (if interrupted)

1. Open this doc.
2. Find the most recent thread with un-checked boxes.
3. Read its "Next on resume:" line.
4. Pick up there.

When all threads are ✅ → archive this file by renaming `active-` → `completed-`.
