# Stack Reference: Django + DRF + PostgreSQL

> Verifesto Studios backend standard. Use this for every client project that needs a backend.

---

## Scaffold

```bash
cd project-root
mkdir backend && cd backend
python -m venv venv
source venv/bin/activate
pip install django djangorestframework django-cors-headers psycopg2-binary gunicorn python-dotenv
django-admin startproject config .
```

## Standard Project Structure

```
backend/
├── config/                # Django project settings
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── [app_name]/            # Django apps (one per domain)
│   ├── __init__.py
│   ├── models.py
│   ├── views.py
│   ├── serializers.py
│   ├── urls.py
│   ├── admin.py
│   └── tests.py
├── manage.py
├── requirements.txt
└── venv/
```

## Settings Essentials

```python
# config/settings.py

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'rest_framework',
    'corsheaders',
    # Local apps
    'your_app',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # MUST be before CommonMiddleware
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# CORS — allow frontend origin
CORS_ALLOWED_ORIGINS = [
    os.environ.get('FRONTEND_URL', 'http://localhost:5173'),
]

# Database — SQLite for local dev, PostgreSQL for production
import dj_database_url
DATABASES = {
    'default': dj_database_url.config(
        default='sqlite:///db.sqlite3',
        conn_max_age=600,
    )
}

# DRF defaults
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}
```

## Environment Variables

Use `python-dotenv` and a `.env` file (never committed):

```bash
# .env
SECRET_KEY=your-secret-key
DATABASE_URL=postgres://user:pass@host:5432/dbname
FRONTEND_URL=https://your-frontend.pages.dev
ALLOWED_HOSTS=api.yourdomain.com,localhost
DEBUG=False
```

```python
# config/settings.py (top)
from dotenv import load_dotenv
import os

load_dotenv()

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key')
DEBUG = os.environ.get('DEBUG', 'True') == 'True'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost').split(',')
```

## Standard Patterns

### Model

```python
from django.db import models

class Customer(models.Model):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['last_name', 'first_name']

    def __str__(self):
        return f"{self.first_name} {self.last_name}"
```

### Serializer

```python
from rest_framework import serializers
from .models import Customer

class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']
```

### ViewSet (preferred over raw views)

```python
from rest_framework import viewsets
from .models import Customer
from .serializers import CustomerSerializer

class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
```

### URLs with Router

```python
# app/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'customers', views.CustomerViewSet)

urlpatterns = [
    path('', include(router.urls)),
]

# config/urls.py
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('your_app.urls')),
]
```

### Admin Registration

```python
from django.contrib import admin
from .models import Customer

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ['first_name', 'last_name', 'email', 'created_at']
    list_filter = ['created_at']
    search_fields = ['first_name', 'last_name', 'email']
```

## Deployment: Railway

1. Create Railway project
2. Add Django service from repo (root directory: `backend`)
3. Add PostgreSQL service
4. Set environment variables:
   - `DATABASE_URL` (auto-set by Railway PostgreSQL)
   - `SECRET_KEY`
   - `ALLOWED_HOSTS`
   - `FRONTEND_URL` (for CORS)
   - `DEBUG=False`
5. Build command: `pip install -r requirements.txt && python manage.py migrate`
6. Start command: `gunicorn config.wsgi`
7. Add custom domain (e.g., `api.yourdomain.com`)

## Requirements File

```txt
django>=5.0
djangorestframework>=3.15
django-cors-headers>=4.3
psycopg2-binary>=2.9
gunicorn>=22.0
python-dotenv>=1.0
dj-database-url>=2.1
```

## Key Conventions

- One Django app per domain/feature
- Always register models in admin (gives Kelsey instant access to data)
- Use ViewSets + Router for standard CRUD
- Use `@api_view` for one-off endpoints
- CORS middleware MUST be first in middleware list
- Never commit `.env` or `db.sqlite3`
- Always use `auto_now_add`/`auto_now` for timestamps

## Notes

- Django Admin is a massive time-saver for early stages — Kelsey can manage data without us building UI
- For demo/prototype projects, you may not need a backend at all — mock data in the frontend is faster
- PostgreSQL on Railway auto-provisions and sets `DATABASE_URL`
