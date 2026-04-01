# Django + Railway Deployment Lessons

Lessons from shipping verifesto.com backend on Railway (2026-03-26).

---

### Lesson: `railway add -d postgres` CLI auth bug
- **Context:** Ran `railway add -d postgres` while logged in — returned "Unauthorized" despite valid login.
- **Insight:** Known Railway CLI bug. The CLI auth token sometimes can't authorize resource creation even when `railway status` shows logged in.
- **Action:** Use the Railway web UI as fallback: project → "New" → "Database" → "Add PostgreSQL". Then use "auto-connect" to link it to the service. Auto-connect injects `DATABASE_URL` and `DATABASE_PUBLIC_URL` into the service environment automatically.
- **Applied:** N/A — documented in `django-railway-deployment-guide.md`

---

### Lesson: Internal vs public DATABASE_URL — local management commands require public URL
- **Context:** Railway's `DATABASE_URL` uses hostname `postgres.railway.internal` — only reachable inside Railway's private network. Any local management command (createsuperuser, migrate, shell) that tries to connect via this URL will hang or fail with connection refused.
- **Insight:** Railway also exposes `DATABASE_PUBLIC_URL` in the Postgres service variables. This uses a public proxy hostname (e.g., `caboose.proxy.rlwy.net:PORT`). Use this for any local machine access.
- **Action:** For local management commands: `DATABASE_URL="<DATABASE_PUBLIC_URL>" python backend/manage.py <command>`. `railway run` injects the internal URL automatically and routes it through Railway's network — so `railway run` still works.
- **Applied:** YES — added to deployment guide under "Create Superuser" step.

---

### Lesson: Gmail SMTP beats Resend for Django email on Railway
- **Context:** Started with `django-anymail[resend]` (Resend API). Switched to Django's built-in SMTP backend with Gmail SMTP.
- **Insight:** `django.core.mail.backends.smtp.EmailBackend` + `smtp.gmail.com:587` works perfectly on Railway. No third-party service, no API key management, no domain verification — just a Google Workspace account with an App Password. Railway blocks port 25 but 587 (STARTTLS) is open.
- **Action:** Remove `django-anymail` from requirements. Set `EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'`, `EMAIL_HOST = 'smtp.gmail.com'`, `EMAIL_PORT = 587`, `EMAIL_USE_TLS = True`. Set `EMAIL_HOST_USER` and `EMAIL_HOST_PASSWORD` (App Password) as Railway env vars.
- **Applied:** YES — deployment guide updated, Verifesto settings.py updated (commit 960de45).

---

### Lesson: Google Workspace App Passwords require 2-Step Verification
- **Context:** Tried to generate an App Password on the Google Workspace account for `hello@verifesto.com` — the option was hidden.
- **Insight:** App Passwords only appear in the Google account security settings AFTER 2-Step Verification is enabled. This is a hard prerequisite, not just a recommendation.
- **Action:** Enable 2-Step Verification first (myaccount.google.com → Security). App Passwords then appear under Security → App Passwords.
- **Applied:** YES — added to deployment guide under "Email Setup (Gmail SMTP)".

---

### Lesson: `EmailMultiAlternatives` required for HTML email with Reply-To
- **Context:** Forge initially planned to use `send_mail()` for email dispatch. But `send_mail()` doesn't support the `reply_to` parameter.
- **Insight:** `EmailMultiAlternatives` is the correct Django pattern for emails that need both: (a) HTML body and (b) custom Reply-To header. It supports `reply_to=[address]` and `.attach_alternative(html, 'text/html')` in one clean API.
- **Action:** Use `EmailMultiAlternatives` for all HTML emails that need Reply-To. `send_mail` is only appropriate for plain-text emails with no custom headers.
- **Applied:** N/A — already in Verifesto's views.py.

---

### Lesson: Split email helpers so one failure can't block the other
- **Context:** Original plan had a single `try/except` block around both admin and client emails.
- **Insight:** If the admin email fails (e.g., bad recipient), the client never gets their confirmation — and vice versa. Independent helpers with their own `try/except` blocks make failures isolated. Forge split these into `_send_admin_notification()` and `_send_client_confirmation()`, each caught separately.
- **Action:** When sending multiple emails in a single request handler, always give each email its own try/except. Use `logger.exception()` (not `print()`) to capture full tracebacks.
- **Applied:** N/A — already implemented in Verifesto's views.py.

---

### Lesson: Manually triggering emails for records saved before email was working
- **Context:** Inquiry #1 (Adam Lynch) was saved to the database before email dispatch was working. Needed to send both admin notification and client confirmation retroactively.
- **Insight:** Since the email logic is in private helper functions (`_send_admin_notification`, `_send_client_confirmation`), they can be called directly from `manage.py shell` against any existing inquiry object.
- **Action:** ```python
  # With DATABASE_URL set to DATABASE_PUBLIC_URL:
  python manage.py shell
  from intake.models import Inquiry
  from intake.views import _send_admin_notification, _send_client_confirmation
  inquiry = Inquiry.objects.get(id=1)
  _send_admin_notification(inquiry)
  _send_client_confirmation(inquiry)
  ```
- **Applied:** YES — added to deployment guide.

---

### Lesson: `CSRF_TRUSTED_ORIGINS` required for Django admin login on custom domain
- **Context:** After deploying to Railway with a custom domain (`api.verifesto.com`), the Django admin login form returned CSRF verification failed.
- **Insight:** Django 4.0+ requires `CSRF_TRUSTED_ORIGINS` to include the full origin (with scheme) of any domain that POSTs to Django. `ALLOWED_HOSTS` is not enough.
- **Action:** Add `CSRF_TRUSTED_ORIGINS = os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',')` to settings. Set the Railway env var: `CSRF_TRUSTED_ORIGINS=https://api.verifesto.com`.
- **Applied:** YES — in Verifesto's settings.py (commit 10e197937).

---

### Lesson: Django session auth for DRF + Vue SPA — the complete pattern
- **Context:** Building the Verifesto client portal (2026-03-31). Needed secure auth for a Vue 3 SPA talking to a DRF backend, without JWTs or third-party auth libraries.
- **Insight:** Django's built-in session auth works cleanly for SPAs when you follow these rules:
  1. Login endpoint must be `@csrf_exempt` (no session exists yet, so CSRF is meaningless pre-auth). Use `@api_view(['POST'])` + `@csrf_exempt` together.
  2. All other endpoints get CSRF protection automatically via `SessionAuthentication` in DRF.
  3. Frontend reads the `csrftoken` cookie (set by Django) and sends `X-CSRFToken` header on all non-GET requests.
  4. `SESSION_COOKIE_SAMESITE = 'Lax'` and `SESSION_COOKIE_HTTPONLY = True` in settings.
  5. In dev, Vite proxy (`/api → localhost:8000`) keeps everything same-origin so cookies flow correctly.
  6. Vue composable `useAuth` should use three-state: `null` (not yet checked), `false` (unauthenticated), `object` (authenticated user). Router guard awaits `checkAuth()` only when `user.value === null`.
- **Action:** Use this pattern as the default for any Django + Vue SPA that needs simple auth. Only reach for JWT if you need stateless auth (mobile clients, third-party API consumers).
- **Applied:** YES — implemented in verifesto-studios portal app (commit 186cf6e).

---

### Lesson: Adding Vue Router to an existing single-view Vue app
- **Context:** The Verifesto frontend was a single-view app (App.vue = intake form). Adding the portal required routing without breaking the existing form.
- **Insight:** The migration is mechanical and safe: (1) install vue-router, (2) move existing App.vue logic into `views/IntakeView.vue` verbatim, (3) replace App.vue with `<router-view />`, (4) register `{ path: '/', component: IntakeView }` as the first route. The existing form continues to work at `/` with zero behavior change. New routes are purely additive.
- **Action:** When adding routing to an existing Vue app, always extract the existing view first before adding new routes. Never refactor the existing logic at the same time — separate commits if possible.
- **Applied:** YES — verifesto-studios frontend (commit 186cf6e).
