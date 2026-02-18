# Work Unit Format Reference

> Work units are how Flow decomposes large projects into focused, session-sized pieces. Each unit gets its own Forge dispatch.

---

## Work Unit Specification

Work units live **inline** in the parent plan document under a `## Work Units` section. They are grouped by feature and identified with `WU-{N}` IDs.

### Heading Format

```
#### WU-{N}: {title}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| **Status** | Yes | `pending`, `in_progress`, `completed`, `failed`, `skipped` |
| **Depends on** | Yes | Comma-separated WU-IDs that must complete first, or `—` for none |
| **Files** | Yes | Exhaustive list of files this unit will create or modify |
| **Scope** | Yes | 1-3 sentence description of what to build |
| **Acceptance** | Yes | Testable criteria for verifying success |
| **Pipeline** | No | Which pillars to run (default: `forge` only, since Chart already planned) |
| **Result** | No | Added by Flow after completion — 1-2 sentence summary |

### Full Example

```markdown
#### WU-2: Auth API Endpoints
- **Status:** completed
- **Depends on:** WU-1
- **Files:** backend/apps/accounts/serializers.py, backend/apps/accounts/views.py, backend/apps/accounts/urls.py
- **Scope:** Registration, login, logout, and password reset endpoints using DRF with JWT authentication.
- **Acceptance:** All endpoints return correct status codes. Login returns a JWT token pair. Registration validates email uniqueness.
- **Result:** 4 endpoints built. JWT auth via djangorestframework-simplejwt. Tests pass locally.
```

---

## Plan Document Structure

The `## Work Units` section is added to an existing plan after Chart completes and Flow decides to decompose.

### Complete Example

```markdown
# Build the Verifesto SaaS Platform

## Status
- [x] Scout: Complete — .paloma/docs/scout-verifesto-saas-20260301.md
- [x] Chart: Complete
- [x] Decomposition: 9 work units across 3 features
- [ ] Forge: In Progress (4/9 complete, 1 in progress)
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References
- Architecture: .paloma/docs/scout-verifesto-saas-20260301.md

## Goal
Build the Verifesto Studios SaaS platform with user auth, intake forms, and deployment config.

## Architecture Overview
{Brief design from Chart — kept to ~2-3 KB}

## Work Units

### Feature: User Authentication

#### WU-1: Backend Auth Models
- **Status:** completed
- **Depends on:** —
- **Files:** backend/apps/accounts/models.py, backend/apps/accounts/admin.py
- **Scope:** Create User model extending AbstractUser, Profile model with bio and avatar fields.
- **Acceptance:** Models exist, makemigrations succeeds, admin registered.
- **Result:** Models created, migration 0001 generated cleanly.

#### WU-2: Auth API Endpoints
- **Status:** completed
- **Depends on:** WU-1
- **Files:** backend/apps/accounts/serializers.py, backend/apps/accounts/views.py, backend/apps/accounts/urls.py
- **Scope:** Registration, login, logout, and password reset endpoints using DRF with JWT.
- **Acceptance:** All endpoints return correct status codes, tokens issued on login.
- **Result:** 4 endpoints built with djangorestframework-simplejwt.

#### WU-3: Frontend Auth Forms
- **Status:** in_progress
- **Depends on:** WU-2
- **Files:** frontend/src/views/LoginView.vue, frontend/src/views/RegisterView.vue, frontend/src/composables/useAuth.js
- **Scope:** Login and registration forms with validation, auth state management composable.
- **Acceptance:** Forms render, validation works, successful login stores token and redirects.

### Feature: Intake Form

#### WU-4: Intake Models & API
- **Status:** completed
- **Depends on:** —
- **Files:** backend/apps/intake/models.py, backend/apps/intake/serializers.py, backend/apps/intake/views.py, backend/apps/intake/urls.py
- **Scope:** Inquiry model with contact fields, multi-step reflection data. DRF endpoint for form submission.
- **Acceptance:** POST /api/intake/submit/ returns 201, data persists to database.
- **Result:** Model + endpoint working. Admin registered for Kelsey access.

#### WU-5: Intake Form UI
- **Status:** pending
- **Depends on:** WU-4
- **Files:** frontend/src/views/IntakeFormView.vue, frontend/src/components/intake/StepContact.vue, frontend/src/components/intake/StepReflection.vue
- **Scope:** Multi-step intake form with validation. Submits to backend API.
- **Acceptance:** All steps render, validation fires, submission succeeds, confirmation shown.

### Feature: Deployment

#### WU-6: Production Settings
- **Status:** completed
- **Depends on:** —
- **Files:** backend/config/settings.py, backend/.env.example, backend/requirements.txt
- **Scope:** DATABASE_URL parsing, STATIC_ROOT, CORS env var, psycopg2-binary dependency.
- **Acceptance:** Backend starts locally with SQLite (no DATABASE_URL). Runs with PostgreSQL when DATABASE_URL is set.
- **Result:** dj-database-url added, STATIC_ROOT configured, .env.example created.

#### WU-7: Frontend Build & Deploy Config
- **Status:** pending
- **Depends on:** —
- **Files:** frontend/vite.config.js, .gitignore
- **Scope:** Verify Vite build succeeds, set up root .gitignore, configure VITE_API_URL env var.
- **Acceptance:** npm run build succeeds, dist/ created, .gitignore covers node_modules/dist/venv/.env.

#### WU-8: API Client & CORS Integration
- **Status:** pending
- **Depends on:** WU-4, WU-5
- **Files:** frontend/src/lib/api.js, backend/config/settings.py
- **Scope:** Frontend API client with base URL from env. Verify CORS accepts production origin.
- **Acceptance:** Frontend can POST to backend locally. CORS headers correct.

#### WU-9: Final Integration
- **Status:** pending
- **Depends on:** WU-3, WU-5, WU-6, WU-7, WU-8
- **Files:** README.md, .paloma/plans/{this-plan}.md
- **Scope:** End-to-end verification. All features working together locally.
- **Acceptance:** Full user flow works: register, login, submit intake, view in admin.

## Execution Log
- 2026-03-01 14:00 — WU-1 dispatched to Forge (pillarId: abc-123)
- 2026-03-01 14:12 — WU-1 completed successfully
- 2026-03-01 14:13 — WU-2 dispatched to Forge (reused pillarId: abc-123)
- 2026-03-01 14:28 — WU-2 completed successfully
- 2026-03-01 14:29 — WU-3 dispatched to Forge (reused pillarId: abc-123)
- 2026-03-01 14:29 — WU-4 dispatched to Forge (pillarId: def-456) [parallel — file-disjoint with WU-3]
- 2026-03-01 14:38 — WU-4 completed successfully
- 2026-03-01 14:40 — WU-6 dispatched to Forge (reused pillarId: def-456)
- 2026-03-01 14:45 — WU-3 completed successfully
- 2026-03-01 14:48 — WU-6 completed successfully
```

---

## State Machine

```
pending ──→ in_progress ──→ completed
                        └──→ failed ──→ pending  (Adam approves retry)
                                    └──→ skipped  (Adam decides to skip)
```

**Transitions:**
- `pending → in_progress` — Flow dispatches a Forge for this unit
- `in_progress → completed` — Forge completes successfully, Flow verifies and adds Result
- `in_progress → failed` — Forge errors or produces incorrect results. Flow adds failure reason to Result
- `failed → pending` — Adam approves a retry (Flow resets the unit, clears Result)
- `failed → skipped` — Adam decides to skip this unit and adjust dependents

Flow does NOT auto-retry failed units. Human judgment is required.

---

## Execution Order Algorithm

```
1. Read the plan document from disk
2. Find all work units with Status = "pending"
3. For each pending unit:
   a. Check if ALL units in "Depends on" have Status = "completed"
   b. If yes → unit is "ready"
   c. If no → unit is "blocked"
4. From ready units:
   a. If no Forge is currently running → dispatch the first ready unit
   b. If a Forge IS running → check file-disjointness:
      - Intersection of Files lists is empty → can parallelize (max 2 concurrent)
      - Intersection is non-empty → must wait
5. Update dispatched unit's Status to "in_progress" on disk
6. Wait for Forge callback
7. On callback → update Status to "completed", add Result, append to Execution Log
8. Return to step 1
```

---

## File-Disjoint Parallelism

Two work units can run in parallel ONLY if their `Files` lists share zero entries.

```
WU-3 Files: frontend/src/views/LoginView.vue, frontend/src/composables/useAuth.js
WU-4 Files: backend/apps/intake/models.py, backend/apps/intake/views.py

Intersection: empty → SAFE to parallelize
```

```
WU-5 Files: frontend/src/router/index.js, frontend/src/views/IntakeFormView.vue
WU-8 Files: frontend/src/lib/api.js, frontend/src/router/index.js

Intersection: frontend/src/router/index.js → NOT safe, must run sequentially
```

**Limits:**
- Maximum 2 concurrent Forge sessions
- Sequential is the default — parallelism is an optimization
- All work happens on the same branch, same working directory

---

## Granularity Guide

| Property | Target | Too Small | Too Large |
|----------|--------|-----------|-----------|
| **Files** | 1-5 | Single import change | 10+ files |
| **Time** | 5-20 min | <2 min | >30 min |
| **Description** | 1-3 sentences | "Add a comma" | "Build the entire API" |
| **Context** | Fits in one Forge session | — | Requires reading 20+ files |

The sweet spot is **one logical change**: "Add the user auth endpoints," "Build the dashboard layout," "Configure PostgreSQL for production."

---

## Flow's Forge Dispatch Prompt

When dispatching a Forge for a specific work unit, Flow crafts a targeted prompt — NOT the full plan. Include:

1. **Task description** (from Scope)
2. **Files to create/modify** (from Files)
3. **Context from completed dependencies** (what was already built, key decisions)
4. **Acceptance criteria** (from Acceptance)
5. **References to Scout docs** (if relevant)

The active plan is already in the Forge session's system prompt for broad context. The dispatch prompt provides the focused, actionable spec.
