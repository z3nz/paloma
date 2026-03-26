# Django + Railway Deployment Guide

**Date:** 2026-03-26
**Status:** Living document — update as the stack evolves

---

## Standard Stack

Every Verifesto client backend uses:
- **Django 5.1+** with Django REST Framework
- **PostgreSQL** (Railway-provisioned)
- **Gunicorn** (WSGI server)
- **WhiteNoise** (static files)
- **Gmail SMTP** (transactional email via Google Workspace App Password — no third-party service needed)
- **Railway** (hosting + database)
- **Cloudflare** (DNS + frontend hosting via Pages)

## Project Structure

```
project-name/
├── backend/
│   ├── config/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── <app>/
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   ├── urls.py
│   │   ├── admin.py
│   │   └── templates/emails/
│   ├── manage.py
│   ├── requirements.txt
│   └── venv/
├── frontend/              (Vue 3 + Vite, deployed to Cloudflare Pages)
├── Procfile
└── README.md
```

## One-Command Deploy

```bash
# From paloma repo root
./scripts/railway-django-deploy.sh /path/to/project project-name api.domain.com
```

This handles: project creation, Postgres provisioning, env vars, Procfile, deploy, and domain attachment.

## Manual Setup (Step by Step)

### 1. Railway CLI Login
```bash
brew install railway
railway login
```

### 2. Create Project & Database
```bash
cd /path/to/project
railway init -n project-name
railway add -d postgres
```

> **Gotcha:** `railway add -d postgres` sometimes returns "Unauthorized" even when logged in — a known CLI bug. If this happens, provision Postgres through the Railway web UI: project → "New" → "Database" → "Add PostgreSQL". Then use "auto-connect" to link it to your service. Auto-connect injects `DATABASE_URL` and `DATABASE_PUBLIC_URL` automatically.

### 3. Set Environment Variables
```bash
railway variables set \
    SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
    DEBUG="False" \
    ALLOWED_HOSTS="api.domain.com" \
    CORS_ALLOWED_ORIGINS="https://domain.com" \
    DEFAULT_FROM_EMAIL="Company Name <hello@domain.com>"
```

### 4. Create Procfile (project root, not backend/)
```
web: cd backend && python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 2
```

### 5. Deploy
```bash
railway up -d
```

### 6. Attach Custom Domain
```bash
railway domain api.domain.com
```
Then add CNAME record in Cloudflare pointing to Railway's target.

### 7. Create Superuser

`railway run` injects the internal `DATABASE_URL` (hostname: `postgres.railway.internal`) — only reachable inside Railway's private network, so `railway run` routes it correctly.

```bash
source backend/venv/bin/activate
railway run python backend/manage.py createsuperuser
```

> **If railway run fails:** Use `DATABASE_PUBLIC_URL` from the Postgres service variables (accessible from your local machine):
> ```bash
> DATABASE_URL="<DATABASE_PUBLIC_URL>" python backend/manage.py createsuperuser
> ```

### 8. Set Admin Password (if created with --noinput)
```bash
railway run python backend/manage.py changepassword admin
```

## Email Setup (Gmail SMTP)

Django's built-in SMTP backend + a Google Workspace App Password. No third-party service needed.

### 1. Enable 2-Step Verification on the Google Workspace account
App Passwords require 2-Step Verification first. myaccount.google.com → Security → 2-Step Verification.

### 2. Generate an App Password
myaccount.google.com → Security → App Passwords → create one named "Railway Django". Copy the 16-character password.

### 3. Set Railway env vars
```bash
railway variables set \
    EMAIL_HOST_USER=hello@yourdomain.com \
    EMAIL_HOST_PASSWORD=xxxx-xxxx-xxxx-xxxx \
    DEFAULT_FROM_EMAIL="Company Name <hello@yourdomain.com>"
```

### 4. No DNS records needed
Unlike Resend, Gmail SMTP uses Google's existing infrastructure. No additional SPF/DKIM required.

### Manual email trigger for existing records
If an inquiry was saved before email was working, fire retroactively from the Django shell:
```python
# Run with DATABASE_URL set to DATABASE_PUBLIC_URL:
python backend/manage.py shell

from intake.models import Inquiry
from intake.views import _send_admin_notification, _send_client_confirmation
inquiry = Inquiry.objects.get(id=1)
_send_admin_notification(inquiry)
_send_client_confirmation(inquiry)
```

## Required Django Settings for Railway

```python
# These are the Railway-critical settings in config/settings.py:

import dj_database_url

# Database — Railway auto-injects DATABASE_URL
DATABASES = {
    'default': dj_database_url.config(
        default=f'sqlite:///{BASE_DIR / "db.sqlite3"}',
        conn_max_age=600,
    )
}

# Static files — WhiteNoise serves them
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# Email — Gmail SMTP (built-in Django backend)
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'hello@domain.com')
```

## Required Python Dependencies
```
django==5.1.6
djangorestframework==3.15.2
django-cors-headers==4.6.0
dj-database-url==2.3.0
psycopg2-binary==2.9.10
gunicorn==23.0.0
whitenoise==6.8.2
python-dotenv==1.0.1
```

## Common Operations

```bash
# Check logs
railway logs

# Check status
railway status

# View env vars
railway variables

# Run management commands against prod DB
source backend/venv/bin/activate
railway run python backend/manage.py <command>

# Redeploy
railway up -d

# Rollback
railway down

# Open psql to prod database
railway connect
```

## Troubleshooting

**"No module named 'django'" with railway run:**
Activate the local venv first: `source backend/venv/bin/activate`

**Gmail SMTP works on Railway:**
Railway blocks port 25 (raw SMTP) but port 587 (STARTTLS) works fine. Use `django.core.mail.backends.smtp.EmailBackend` with `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_USE_TLS=True`.

**Static files warning:**
Run `collectstatic` in the Procfile (already included in the standard Procfile above).

**DATABASE_URL not in railway variables output:**
Normal — Railway auto-injects it from the linked Postgres service. It works even though it's not in the explicit variable list.
