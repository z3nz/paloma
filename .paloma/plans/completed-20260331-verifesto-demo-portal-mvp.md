# Verifesto Demo Portal MVP — Charted Plan

> **Vision:** A client can log in, see their projects, and view a live demo in an iframe. That's it.
> **Status:** Active
> **Created:** 2026-03-31
> **Charted by:** Flow + Chart (Opus)
> **Repo:** `/home/adam/paloma/projects/verifesto-studios/`
> **First client:** Fadden

---

## Scope — Three Screens, Nothing More

| Screen | What it does |
|--------|-------------|
| **Login** | Email + password → Django session auth |
| **Dashboard** | Welcome message + list of projects assigned to this client |
| **Project View** | Full iframe showing the project's demo URL |

### Explicitly NOT in scope
- Feedback form / submission
- Updates timeline
- File/asset uploads
- Email notifications
- Self-registration / invite flow
- JWT / token auth
- Custom admin UI (Django admin is sufficient)
- AI-assisted anything

---

## Existing Codebase (as of 2026-03-31)

**Backend:**
- Django 6.0.2 + DRF 3.16.1 + CORS + dj-database-url
- One app: `intake` (Inquiry model — intake form)
- Django admin wired up
- SQLite locally, Postgres-ready
- Session middleware already in MIDDLEWARE
- No `REST_FRAMEWORK` config block yet
- No client-facing auth

**Frontend:**
- Vue 3.5 + Vite 6 + Tailwind 4 (CSS-first via `@tailwindcss/vite`)
- Single-view app (App.vue wraps StoryBook intake form)
- No Vue Router
- `api.js` service with hardcoded `http://localhost:8000/api` base URL
- Composables pattern: `useIntakeForm.js`
- Icons: `lucide-vue-next`

**Brand tokens (from Verifesto brand doc):**
- Headlines: Fraunces
- Body: Inter
- Surface: `#F7F8FA`
- Ink: `#0B1220`
- Accent: `#2F6BFF` (Verity Blue)

---

## Backend — New `portal` Django App

### 1. Create app: `backend/portal/`

```
backend/portal/
├── __init__.py
├── admin.py
├── apps.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── permissions.py
├── management/
│   └── commands/
│       └── seed_portal.py
└── migrations/
```

### 2. Model: `Project`

```python
class Project(models.Model):
    name = models.CharField(max_length=200)
    client = models.ForeignKey(User, on_delete=models.CASCADE, related_name='portal_projects')
    demo_url = models.URLField(help_text="URL to display in the iframe")
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=[
            ('active', 'Active'),
            ('in_review', 'In Review'),
            ('paused', 'Paused'),
            ('complete', 'Complete'),
        ],
        default='active',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

That's the only model. One model, one table.

### 3. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/portal/login/` | No | Email + password → create session |
| POST | `/api/portal/logout/` | Yes | Destroy session |
| GET | `/api/portal/me/` | Yes | Return current user info (name, email) |
| GET | `/api/portal/projects/` | Yes | List projects for current user |
| GET | `/api/portal/projects/:id/` | Yes | Single project detail |

### 4. Auth Design

- **Session auth** via Django's built-in `SessionAuthentication` in DRF
- Login view: look up `User` by email, authenticate with username (Django's standard pattern)
- Login endpoint is `@csrf_exempt` (no session exists yet — CSRF is meaningless pre-auth)
- All other endpoints enforce CSRF via `SessionAuthentication` automatically
- Frontend reads `csrftoken` cookie, sends `X-CSRFToken` header on all requests
- **Permission:** Project list/detail filtered to `request.user` — clients can only see their own projects

### 5. DRF Config (add to settings.py)

```python
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}
```

### 6. Admin Config

Register `Project` in Django admin with:
- List display: name, client, status, demo_url, created_at
- List filter: status, client
- Search: name, client username, client email

This is how Kelsey manages everything — no custom admin UI needed.

### 7. Seed Command: `seed_portal`

Management command that creates:
- A client user (email: from args or default)
- A Fadden project with demo URL pointing to the Fadden demo

Usage: `python manage.py seed_portal --email client@fadden.com --demo-url https://fadden-demo.example.com`

### 8. Settings Changes

- Add `'portal'` to `INSTALLED_APPS`
- Add `REST_FRAMEWORK` config block (session auth + IsAuthenticated default)
- Add `SESSION_COOKIE_SAMESITE = 'Lax'` and `SESSION_COOKIE_HTTPONLY = True`

### 9. URL Changes

Add to `config/urls.py`:
```python
path('api/portal/', include('portal.urls')),
```

---

## Frontend Changes

### 1. Install Vue Router

```bash
npm install vue-router@4
```

### 2. Create Router (`frontend/src/router/index.js`)

Routes:
- `/` → `IntakeView` (existing StoryBook intake form)
- `/portal/login` → `PortalLogin`
- `/portal` → `PortalDashboard` (requires auth)
- `/portal/project/:id` → `PortalProject` (requires auth)

Navigation guard: check auth state before entering `/portal/*` routes. Redirect to `/portal/login` if not authenticated.

### 3. Refactor App.vue

Current App.vue contains the StoryBook intake logic. Move that into `views/IntakeView.vue`. App.vue becomes a minimal router shell:

```vue
<template>
  <router-view />
</template>
```

The intake form continues to work at `/` exactly as before — zero behavior change.

### 4. New Views

**`views/PortalLogin.vue`**
- Email + password form
- Verifesto brand styling (Fraunces heading, Inter body, Verity Blue accents)
- Error display for failed login
- On success → redirect to `/portal`

**`views/PortalDashboard.vue`**
- "Welcome, [name]" header
- Grid/list of project cards (name, status badge, last updated)
- Click card → navigate to `/portal/project/:id`
- Logout button in header

**`views/PortalProject.vue`**
- Project name + status badge header
- Full-width iframe (`<iframe :src="project.demo_url" />`)
- Fullscreen toggle button
- Back to dashboard link
- Logout in header

### 5. New Composables

**`composables/useAuth.js`**
- `user` ref (null = loading, false = not auth'd, object = auth'd)
- `login(email, password)` → POST `/api/portal/login/`
- `logout()` → POST `/api/portal/logout/`
- `checkAuth()` → GET `/api/portal/me/` (called once on app init)
- CSRF token handling: read from cookie, attach to all non-GET requests

**`composables/useProjects.js`**
- `projects` ref
- `fetchProjects()` → GET `/api/portal/projects/`
- `fetchProject(id)` → GET `/api/portal/projects/:id/`

### 6. Fix API Base URL

Current `api.js` hardcodes `http://localhost:8000/api`. Change to relative `/api` so the Vite proxy handles it in dev and same-origin works in prod.

### 7. Vite Proxy Config

Add to `vite.config.js`:
```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    }
  }
}
```

---

## File Summary

### New files (backend — 10)
1. `backend/portal/__init__.py`
2. `backend/portal/apps.py`
3. `backend/portal/models.py` — Project model
4. `backend/portal/serializers.py` — ProjectSerializer, LoginSerializer
5. `backend/portal/views.py` — LoginView, LogoutView, MeView, ProjectList, ProjectDetail
6. `backend/portal/urls.py` — 5 routes
7. `backend/portal/permissions.py` — IsProjectOwner
8. `backend/portal/admin.py` — Project admin config
9. `backend/portal/management/__init__.py`
10. `backend/portal/management/commands/seed_portal.py`

### New files (frontend — 7)
1. `frontend/src/router/index.js` — Vue Router with auth guard
2. `frontend/src/views/IntakeView.vue` — moved from App.vue
3. `frontend/src/views/PortalLogin.vue` — login screen
4. `frontend/src/views/PortalDashboard.vue` — project list
5. `frontend/src/views/PortalProject.vue` — iframe viewer
6. `frontend/src/composables/useAuth.js` — auth state + API
7. `frontend/src/composables/useProjects.js` — project data

### Modified files (5)
1. `backend/config/settings.py` — add portal to INSTALLED_APPS, REST_FRAMEWORK config, session cookie settings
2. `backend/config/urls.py` — add portal URLs
3. `frontend/src/App.vue` — simplify to router shell
4. `frontend/src/services/api.js` — fix base URL to relative `/api`
5. `frontend/vite.config.js` — add API proxy

### Unchanged
- `backend/intake/*` — completely untouched
- All existing frontend components (StoryBook, etc.) — moved into IntakeView but logic unchanged

---

## Forge Instructions

1. **Start with backend** — create `portal` app, model, migrate, views, URLs, admin
2. **Seed data** — create seed command, run it to create Fadden client + project
3. **Frontend infra** — install vue-router, create router, refactor App.vue → IntakeView.vue
4. **Portal views** — Login → Dashboard → ProjectView, in that order
5. **Wire up** — Vite proxy, API base URL fix, CSRF handling
6. **Test manually** — login as Fadden client, see dashboard, click project, see iframe
7. **Commit and push**

---

## Success Criteria

- [ ] Client can log in with email + password
- [ ] Dashboard shows only projects assigned to that client
- [ ] Clicking a project shows the demo in an iframe
- [ ] Fullscreen toggle works on the iframe
- [ ] Existing intake form at `/` still works exactly as before
- [ ] Django admin can manage users and projects
- [ ] Seed command creates Fadden as first client
- [ ] Mobile-responsive
