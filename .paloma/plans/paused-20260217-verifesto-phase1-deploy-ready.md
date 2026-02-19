# Phase 1 MVP — Deployment-Ready

> **Goal:** Get Verifesto Studios live tonight with all deployment blockers resolved  
> **Status:** Chart complete, ready for Forge execution  
> **Timeline:** 2-4 hours focused work to live site  
> **Created:** 2026-02-17

---

## Status

- [x] Scout: Complete — findings in `.paloma/docs/scout-verifesto-phase1-mvp-20260217.md`
- [x] Chart: Complete — this deployment-ready plan
- [ ] Forge: Pending — fix 7 deployment blockers
- [ ] Polish: Pending — end-to-end testing
- [ ] Ship: Pending — final commit + docs

---

## Research References

- **Phase 1 MVP Assessment:** `.paloma/docs/scout-verifesto-phase1-mvp-20260217.md`
- **Original Phase 1 Plan (completed):** `.paloma/plans/completed-20260210-verifesto-phase1-mvp-landing-intake.md`

---

## Executive Summary

**Current Reality:** Phase 1 MVP code is 90% complete. Frontend and backend are built, brand-compliant, and working locally. Code quality is excellent. The gap is deployment configuration, not implementation.

**Remaining Work:** 7 configuration items block deployment. All are quick fixes (2-4 hours total).

**First Client Context:** Matt Fadden (Kelsey's dad, pest control, Maine) is in the pipeline. Adam and Kelsey want this live tonight. Speed matters, but brand integrity is non-negotiable.

**Key Decision:** WYSIWYG markdown editor is deferred to Phase 2. The plain textarea in ReflectionStep is functional and brand-compliant for MVP. This removes a blocker and accelerates time-to-live.

---

## The 7 Deployment Blockers

Scout identified these issues. All are configuration tasks, not code rewrites:

### 🔴 Critical (Must Fix Before Deploy)

1. **No git commits** — All code is untracked. Cannot deploy without commits.
2. **No root .gitignore** — Risk of committing sensitive files (.env, node_modules, venv).
3. **Missing PostgreSQL support** — `requirements.txt` lacks `psycopg2-binary` and `dj-database-url`.
4. **No DATABASE_URL parsing** — Backend settings.py only configured for SQLite.
5. **Missing STATIC_ROOT** — Django admin CSS/JS won't load in production.
6. **No environment variables documentation** — Need `.env.example` for Railway setup.
7. **Frontend build not tested** — Unknown if `npm run build` succeeds.

### ✅ Intentionally Deferred

- **WYSIWYG markdown editor** → Phase 2. Plain textarea is sufficient for MVP.

---

## Implementation Plan — Forge Phase

### Block 1: Git Setup (Blocker #1, #2)

**Objective:** Enable version control and safe deployment.

**Tasks:**
1. Create root `.gitignore` with comprehensive exclusions
2. Verify backend `.gitignore` is complete
3. Stage all files (`git add .`)
4. Create initial commit with proper message
5. Verify `git status` shows clean working tree

**Files to create/modify:**
- `.gitignore` (root level) — NEW
- Verify `backend/.gitignore` exists and is complete

**Expected outcome:** Clean git history, safe to push to Cloudflare/Railway.

---

### Block 2: PostgreSQL Production Config (Blockers #3, #4)

**Objective:** Backend can connect to Railway-managed PostgreSQL.

**Tasks:**
1. Add to `backend/requirements.txt`:
   - `psycopg2-binary==2.9.9`
   - `dj-database-url==2.2.0`
2. Update `backend/config/settings.py` with DATABASE_URL parsing:
   ```python
   import dj_database_url
   
   DATABASES = {
       'default': dj_database_url.config(
           default=f'sqlite:///{BASE_DIR / "db.sqlite3"}',
           conn_max_age=600,
       )
   }
   ```
3. Verify SQLite still works locally (fallback in `default` parameter)

**Files to modify:**
- `backend/requirements.txt`
- `backend/config/settings.py`

**Expected outcome:** Backend works locally with SQLite, automatically switches to PostgreSQL when `DATABASE_URL` env var is set by Railway.

---

### Block 3: Static Files Config (Blocker #5)

**Objective:** Django admin CSS/JS loads correctly in production.

**Tasks:**
1. Add to `backend/config/settings.py`:
   ```python
   STATIC_ROOT = BASE_DIR / 'staticfiles'
   ```
2. Add `staticfiles/` to `backend/.gitignore`
3. Test `python manage.py collectstatic` locally (optional verification)

**Files to modify:**
- `backend/config/settings.py`
- `backend/.gitignore`

**Expected outcome:** `collectstatic` command works. Railway can serve admin static files.

---

### Block 4: Environment Variables Documentation (Blocker #6)

**Objective:** Document required env vars for deployment.

**Tasks:**
1. Create `backend/.env.example` with all required variables
2. Document expected values and where to get them

**File to create:**
- `backend/.env.example`

**Template:**
```bash
# Django Settings
SECRET_KEY=your-secret-key-here-generate-with-django
DEBUG=False
ALLOWED_HOSTS=api.verifesto.com

# Database (Railway auto-sets this)
DATABASE_URL=postgresql://user:password@host:port/dbname

# CORS
CORS_ALLOWED_ORIGINS=https://verifesto.com
```

**Expected outcome:** Clear documentation for Railway environment setup.

---

### Block 5: Frontend Build Verification (Blocker #7)

**Objective:** Confirm Vite build succeeds and output is correct.

**Tasks:**
1. Run `cd frontend && npm run build`
2. Verify `frontend/dist/` is created
3. Check that `dist/index.html` exists and looks correct
4. Verify `dist/assets/` contains JS/CSS bundles
5. Add `frontend/dist/` to root `.gitignore` (build artifacts should not be committed)

**Expected outcome:** Successful build, ready for Cloudflare Pages deployment.

---

### Block 6: Production CORS Configuration

**Objective:** Ensure API accepts requests from production frontend.

**Tasks:**
1. Verify `settings.py` CORS logic is correct (already implemented)
2. Document Railway env var: `CORS_ALLOWED_ORIGINS=https://verifesto.com`

**Note:** No code changes needed. Settings.py already handles this via env var. Just needs Railway configuration during deployment.

**Expected outcome:** Production frontend can call production API.

---

### Block 7: Final Git Commit

**Objective:** All configuration changes tracked in version control.

**Tasks:**
1. Stage all changes from Blocks 1-6
2. Create commit with message:
   ```
   feat(deploy): add production deployment configuration
   
   - Add root .gitignore for project-level exclusions
   - Add PostgreSQL support (psycopg2-binary, dj-database-url)
   - Configure DATABASE_URL parsing in settings.py
   - Add STATIC_ROOT for Django admin static files
   - Document required environment variables in .env.example
   - Verify frontend build process
   
   Phase 1 MVP is now deployment-ready for Cloudflare Pages + Railway.
   
   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ```
3. Verify commit with `git show HEAD`

**Expected outcome:** All deployment prep is version-controlled and ready to push.

---

## Deployment Steps — After Forge Completes

### Cloudflare Pages (Frontend)

1. **Connect repository to Cloudflare Pages**
   - Framework preset: Vue
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
   
2. **Set environment variable:**
   - `VITE_API_URL=https://api.verifesto.com`
   
3. **Deploy** — Push to main branch triggers auto-deploy

4. **Configure custom domain:**
   - Add `verifesto.com` to Cloudflare Pages project
   - DNS already managed by Cloudflare (zero config needed)

**Expected URL:** `https://verifesto.com`

---

### Railway (Backend)

1. **Create new Railway project**
   - Connect GitHub repository
   - Root directory: `backend`
   
2. **Add PostgreSQL service**
   - Railway automatically sets `DATABASE_URL` env var
   
3. **Configure Django service:**
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn config.wsgi`
   
4. **Set environment variables:**
   ```bash
   SECRET_KEY=<generate-with-django>
   DEBUG=False
   ALLOWED_HOSTS=api.verifesto.com
   CORS_ALLOWED_ORIGINS=https://verifesto.com
   ```
   
5. **Run migrations:**
   - Railway dashboard → Django service → Console
   - Run: `python manage.py migrate`
   
6. **Create superuser for Kelsey:**
   - Railway console: `python manage.py createsuperuser`
   - Save credentials for Kelsey
   
7. **Add custom domain:**
   - Railway dashboard → Settings → Domains
   - Add: `api.verifesto.com`
   - Railway provides CNAME target
   
8. **Update Cloudflare DNS:**
   - Add CNAME record: `api` → Railway's provided domain
   - Proxy status: Proxied (orange cloud)

**Expected URLs:**
- API: `https://api.verifesto.com`
- Admin: `https://api.verifesto.com/admin/`

---

## Testing Checklist — Polish Phase

### Local Testing (Before Deploy)

- [ ] Backend runs locally with SQLite: `python manage.py runserver`
- [ ] Frontend runs locally: `npm run dev`
- [ ] Frontend can submit to local backend (CORS working)
- [ ] Submission appears in Django Admin locally
- [ ] Frontend build succeeds: `npm run build`
- [ ] Built frontend serves correctly: `npx vite preview`

### Production Testing (After Deploy)

- [ ] `https://verifesto.com` loads landing page with correct styling
- [ ] "Inquire" button transitions to intake form
- [ ] Step 1 (Contact) validates required fields and email format
- [ ] Step 2 (Reflection) accepts textarea input, validates minimum length
- [ ] Step 3 (Schedule) shows placeholder message
- [ ] Form submission sends data to `https://api.verifesto.com/api/intake/submit/`
- [ ] Submission succeeds (201 response)
- [ ] Confirmation view shows with user's first name
- [ ] Inquiry appears in Django Admin at `https://api.verifesto.com/admin/`
- [ ] Kelsey can log in to admin and view submissions
- [ ] Responsive on mobile, tablet, desktop
- [ ] No console errors in browser DevTools
- [ ] No 500 errors in Railway logs

---

## Ship Phase — Final Documentation

### Tasks

1. **Final commit** (if any fixes from Polish)
2. **Update README.md** with live URLs and deployment status
3. **Archive this plan** — move to `completed-20260217-verifesto-phase1-deploy-ready.md`
4. **Create Phase 2 plan** (optional, can wait)
5. **Celebrate** — First Verifesto Studios site is live!

### Deliverables

- Live site at `verifesto.com`
- Live API at `api.verifesto.com`
- Kelsey has admin access
- Clean git history
- Documented environment variables
- Phase 1 marked complete in project records

---

## Known Limitations (Intentional MVP Scope)

These are **not bugs** — they're Phase 2+ features:

- ❌ No handwriting logo animation
- ❌ No book metaphor transitions
- ❌ Plain textarea instead of WYSIWYG markdown editor
- ❌ No live calendar integration (placeholder message only)
- ❌ No email notifications
- ❌ No reminder system
- ❌ No custom admin dashboard UI

**Why this is OK for MVP:**
- Matt Fadden (first client) is a relationship contact (Kelsey's dad)
- Core functionality is complete: intake form → database → admin access
- Brand integrity is maintained (voice, tone, visual design all correct)
- Can collect real client data immediately
- Phase 2 enhancements can be added without disrupting the live site

---

## Broader Roadmap Context

This plan completes **Phase 1** of a 5-phase roadmap:

### Completed
- ✅ **Phase 1:** MVP Landing + Intake Form (this plan)

### Upcoming
- **Phase 2:** Animations & Polish
  - Handwriting logo animation
  - Book metaphor transitions
  - WYSIWYG markdown editor
  - Micro-interactions

- **Phase 3:** Calendar Integration & Notifications
  - Live scheduling (Google Calendar/Calendly API)
  - Confirmation emails
  - Reminder system
  - Anti-no-show measures

- **Phase 4:** Admin Dashboard
  - Custom admin UI for Kelsey
  - Project-based organization
  - Unified inbox
  - Client status tracking
  - AI-prefilled action items

- **Phase 5:** AI Automation & Agents
  - Background agents triggered by client activity
  - Automated contract drafting
  - Smart task prioritization
  - Pattern recognition

---

## Critical Success Factors

### Brand Integrity (Non-Negotiable)
- ✅ Voice is calm, direct, no pressure (verified by Scout)
- ✅ Visual design is clean, minimal, premium (verified by Scout)
- ✅ Copy avoids urgency/persuasion tactics (verified by Scout)
- ✅ All 12 brand color tokens correctly implemented
- ✅ Typography uses Fraunces + Inter as specified

### Speed to Live (High Priority)
- Goal: Live site tonight
- Current blockers: 7 configuration tasks (2-4 hours)
- Risk: Low (no code rewrites needed, just config)

### Quality (Non-Negotiable)
- No bugs in production
- All form validation working
- CORS configured correctly
- Admin access working for Kelsey
- Responsive design verified on all devices

---

## Risk Assessment

### Low Risk ✅
- Git setup (standard process)
- PostgreSQL config (well-documented Django pattern)
- Static files config (one-line setting)
- Frontend build (Vite is stable, Vue 3 is mature)

### Medium Risk ⚠️
- CORS in production (easy to misconfigure)
  - **Mitigation:** Test immediately after deploy, fix env var if needed
- Railway DATABASE_URL parsing (first time with this pattern)
  - **Mitigation:** Fallback to SQLite is built in, can debug locally

### Zero Risk 🎯
- Code quality (Scout verified, no issues found)
- Brand compliance (100% alignment verified)
- Backend models/views (clean Django, no complexity)

---

## Timeline Estimate

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| **Forge** | Fix 7 blockers | 1-2 hours |
| **Deploy** | Cloudflare + Railway setup | 30-45 minutes |
| **Polish** | End-to-end testing | 30-45 minutes |
| **Ship** | Final commit + docs | 15-30 minutes |
| **Total** | | **2.5-4 hours** |

**Best case:** Live site in 2.5 hours  
**Realistic:** Live site in 3-4 hours  
**Worst case:** 5-6 hours (if Railway issues encountered)

---

## Go/No-Go Decision Points

### Before Forge Starts
- ✅ Scout report reviewed
- ✅ Chart plan approved
- ✅ All blockers understood
- ✅ Timeline acceptable

### Before Deployment
- [ ] All 7 blockers resolved
- [ ] Local testing passed
- [ ] Frontend build succeeded
- [ ] Git history clean

### Before Ship
- [ ] Production site loads correctly
- [ ] Form submission works end-to-end
- [ ] Kelsey can access admin
- [ ] No critical bugs found

---

## Success Metrics

**Tonight's definition of success:**
1. ✅ `verifesto.com` is live and loads correctly
2. ✅ Intake form accepts submissions
3. ✅ Submissions appear in Django Admin
4. ✅ Kelsey has admin credentials and can log in
5. ✅ No critical bugs or broken functionality
6. ✅ Brand integrity maintained (voice, tone, visual)

**This is an MVP.** Perfection is not the goal. Working, on-brand, and live is the goal.

---

## Chart Sign-Off

This plan is **deployment-ready**. The code is 90% complete. The remaining work is configuration, not implementation. All blockers are well-understood and straightforward to fix.

**Recommended next step:** Dispatch Forge to execute Blocks 1-7, then proceed to deployment.

**Estimated time to live site:** 2-4 hours of focused work.

---

**Chart phase complete. Ready for Forge execution.**
