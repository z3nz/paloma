# Phase 1 — MVP: Landing Page + Intake Form

> **Goal:** A single-page site that receives client intake form submissions.
> **Stack:** Vue 3 + Tailwind (Cloudflare Pages) / Django + DRF + PostgreSQL (Railway)
> **Created:** 2026-02-10

---

## Step 1: Scaffold the Monorepo

```bash
cd ~/verifesto-studios

# Initialize git
git init

# Create the monorepo structure
mkdir -p frontend backend docs
```

### 1a. Scaffold the Vue 3 Frontend

```bash
cd ~/verifesto-studios
npm create vite@latest frontend -- --template vue
cd frontend
npm install
npm install -D tailwindcss @tailwindcss/vite
```

Update `vite.config.js` to include the Tailwind plugin:

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
})
```

Update `src/style.css` to import Tailwind:

```css
@import "tailwindcss";
```

### 1b. Scaffold the Django Backend

```bash
cd ~/verifesto-studios/backend
python -m venv venv
source venv/bin/activate
pip install django djangorestframework django-cors-headers psycopg2-binary gunicorn python-dotenv
django-admin startproject config .
python manage.py startapp intake
```

This gives us:

```
backend/
├── config/            # Django project settings
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── intake/            # Intake form app
│   ├── models.py
│   ├── views.py
│   ├── serializers.py
│   ├── urls.py
│   └── admin.py
├── manage.py
├── requirements.txt
└── venv/
```

### 1c. Root-level Files

- `README.md` — project source of truth (already created)
- `.gitignore` — covers Python, Node, and IDE files
- `docs/` — brand documents and specifications

---

## Step 2: Django Backend — Intake API

### 2a. Model: `Inquiry`

```python
# intake/models.py
from django.db import models

class Inquiry(models.Model):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField()
    reflection = models.TextField(help_text="What prompted you to reach out right now?")

    # Phase 1: scheduling is a placeholder
    # Phase 3: will add calendar integration fields

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = "inquiries"

    def __str__(self):
        return f"{self.first_name} {self.last_name} — {self.created_at.strftime('%Y-%m-%d')}"
```

### 2b. Serializer

```python
# intake/serializers.py
from rest_framework import serializers
from .models import Inquiry

class InquirySerializer(serializers.ModelSerializer):
    class Meta:
        model = Inquiry
        fields = ['id', 'first_name', 'last_name', 'email', 'reflection', 'created_at']
        read_only_fields = ['id', 'created_at']
```

### 2c. View

```python
# intake/views.py
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .serializers import InquirySerializer

@api_view(['POST'])
def submit_inquiry(request):
    serializer = InquirySerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
```

### 2d. URLs

```python
# intake/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('submit/', views.submit_inquiry, name='submit-inquiry'),
]

# config/urls.py
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/intake/', include('intake.urls')),
]
```

### 2e. Django Settings Updates

- Add `'rest_framework'`, `'corsheaders'`, `'intake'` to `INSTALLED_APPS`
- Add `'corsheaders.middleware.CorsMiddleware'` to `MIDDLEWARE` (before `CommonMiddleware`)
- Configure CORS to allow frontend origin
- Configure database (SQLite for local dev, PostgreSQL for Railway via `DATABASE_URL`)
- Environment variables via `python-dotenv` for secrets

### 2f. Admin Registration

```python
# intake/admin.py
from django.contrib import admin
from .models import Inquiry

@admin.register(Inquiry)
class InquiryAdmin(admin.ModelAdmin):
    list_display = ['first_name', 'last_name', 'email', 'created_at']
    list_filter = ['created_at']
    search_fields = ['first_name', 'last_name', 'email']
    readonly_fields = ['created_at', 'updated_at']
```

This gives Kelsey immediate access to view submissions via Django Admin.

---

## Step 3: Vue 3 Frontend — Landing Page

### 3a. Tailwind Brand Tokens

Define the Verifesto color system and typography in the Tailwind CSS config:

```css
/* src/style.css */
@import "tailwindcss";

@theme {
  --color-ink: #0B1220;
  --color-ink-muted: #5B6475;
  --color-surface: #F7F8FA;
  --color-surface-2: #FFFFFF;
  --color-border: #E6E8EE;
  --color-verity: #2F6BFF;
  --color-verity-deep: #1F4FE0;
  --color-success: #16A34A;
  --color-warning: #F59E0B;
  --color-error: #DC2626;
  --color-gold: #C9A227;

  --font-display: 'Fraunces', serif;
  --font-body: 'Inter', sans-serif;
}
```

Load fonts via Google Fonts in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300..700&display=swap" rel="stylesheet">
```

### 3b. App Structure

```
frontend/src/
├── components/
│   ├── LandingHero.vue          # Brand intro + "Inquire" button
│   ├── IntakeForm.vue           # Multi-step form container
│   ├── steps/
│   │   ├── ContactStep.vue      # Step 1: Name + email
│   │   ├── ReflectionStep.vue   # Step 2: Free-form reflection
│   │   └── ScheduleStep.vue     # Step 3: Placeholder for scheduling
│   └── ConfirmationView.vue     # Post-submission confirmation
├── composables/
│   └── useIntakeForm.js         # Form state management
├── services/
│   └── api.js                   # API client for backend
├── App.vue                      # Root component
├── main.js                      # Entry point
└── style.css                    # Tailwind + brand tokens
```

### 3c. Component Details

**App.vue** — Simple single-page layout. Shows `LandingHero` by default, transitions to `IntakeForm` when user clicks "Inquire", shows `ConfirmationView` after submission.

**LandingHero.vue** — The first thing visitors see:
- "Verifesto Studios" in Fraunces (large, confident, no animation yet — that's Phase 2)
- 2-3 sentences of brand copy explaining who we are
- A single "Inquire" button in Verity Blue
- Clean, centered layout on Surface background
- Generous whitespace — let the brand breathe

**IntakeForm.vue** — Multi-step form container:
- Manages current step (1, 2, 3)
- Holds shared form state via `useIntakeForm` composable
- Simple crossfade transitions between steps (Phase 2 adds the book metaphor)
- Progress indicator (subtle, e.g., "Step 1 of 3")

**ContactStep.vue** — Step 1:
- First name, last name, email fields
- Clean input styling with brand tokens
- Client-side validation (required fields, email format)
- "Continue" button

**ReflectionStep.vue** — Step 2:
- The question: "What prompted you to reach out right now?"
- Textarea with generous height (this is where people write)
- Phase 1: Plain textarea with character encouragement ("Take your time. Write as much or as little as you need.")
- Phase 2+: Replace with WYSIWYG markdown editor
- Minimum 1 sentence validation
- "Continue" button + "Back" link

**ScheduleStep.vue** — Step 3 (Phase 1 placeholder):
- Message: "We'd love to have a conversation with you."
- Explain that a 30-minute discovery call will be scheduled
- "We'll reach out within 24 hours to find a time that works."
- "Submit" button that sends everything to the API
- Phase 3: Replace with live calendar picker

**ConfirmationView.vue** — After submission:
- Warm, clear confirmation message
- "Thank you, [First Name]."
- Set expectations: what happens next
- No upsell, no redirect pressure — just calm confirmation

### 3d. Composable: `useIntakeForm`

```js
// composables/useIntakeForm.js
import { reactive, ref } from 'vue'
import { submitInquiry } from '../services/api.js'

export function useIntakeForm() {
  const currentStep = ref(1)
  const isSubmitting = ref(false)
  const isSubmitted = ref(false)
  const submitError = ref(null)

  const form = reactive({
    firstName: '',
    lastName: '',
    email: '',
    reflection: '',
  })

  function nextStep() {
    if (currentStep.value < 3) currentStep.value++
  }

  function prevStep() {
    if (currentStep.value > 1) currentStep.value--
  }

  async function submit() {
    isSubmitting.value = true
    submitError.value = null
    try {
      await submitInquiry({
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email,
        reflection: form.reflection,
      })
      isSubmitted.value = true
    } catch (err) {
      submitError.value = 'Something went wrong. Please try again.'
    } finally {
      isSubmitting.value = false
    }
  }

  return { form, currentStep, isSubmitting, isSubmitted, submitError, nextStep, prevStep, submit }
}
```

### 3e. API Service

```js
// services/api.js
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export async function submitInquiry(data) {
  const response = await fetch(`${API_BASE}/intake/submit/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errors = await response.json()
    throw new Error(JSON.stringify(errors))
  }

  return response.json()
}
```

---

## Step 4: Copy & Content

### Landing Page Copy (Draft)

**Headline:** Verifesto Studios

**Subheadline/Body:**
> We help people move from uncertainty to clarity — without pressure, persuasion, or performative urgency.
>
> Every engagement begins with a conversation. If something prompted you to find us, we'd like to hear about it.

**CTA Button:** Inquire

### Form Copy

**Step 1 header:** "Let's start with the basics."

**Step 2 header:** "What prompted you to reach out right now?"
**Step 2 supporting text:** "Take your time. Write as much or as little as you need. There's no wrong answer."

**Step 3 header:** "Let's find time to talk."
**Step 3 body (Phase 1):** "Every engagement begins with a 30-minute discovery call. We'll reach out within 24 hours to find a time that works for you."

**Confirmation:** "Thank you, [First Name]. We've received your inquiry and will be in touch within 24 hours to schedule your discovery call."

*Note: All copy is draft and should be reviewed by Adam and Kelsey before final implementation.*

---

## Step 5: Deployment Setup

### 5a. Cloudflare Pages (Frontend)

1. Connect repository to Cloudflare Pages
2. Set build configuration:
   - Framework preset: Vue
   - Build command: `npm run build`
   - Build output directory: `frontend/dist`
   - Root directory: `frontend`
3. Set environment variable: `VITE_API_URL=https://api.verifesto.com`
4. Deploy

### 5b. Railway (Backend)

1. Create new Railway project
2. Add Django service from the repository
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn config.wsgi`
3. Add PostgreSQL database service
4. Set environment variables:
   - `DATABASE_URL` (auto-set by Railway PostgreSQL)
   - `SECRET_KEY`
   - `ALLOWED_HOSTS=api.verifesto.com`
   - `CORS_ALLOWED_ORIGINS=https://verifesto.com`
5. Add custom domain: `api.verifesto.com`
6. Run migrations: `python manage.py migrate`
7. Create superuser for Kelsey: `python manage.py createsuperuser`

### 5c. Cloudflare DNS

Add CNAME record for `api` subdomain pointing to Railway's provided domain.

---

## Step 6: Testing Checklist

Before considering Phase 1 complete:

- [ ] Landing page renders correctly with brand styling
- [ ] "Inquire" button transitions to form
- [ ] Step 1 validates required fields and email format
- [ ] Step 2 accepts free-form text (minimum 1 sentence)
- [ ] Step 3 shows placeholder scheduling message
- [ ] Form submission sends data to Django API
- [ ] Inquiry appears in Django Admin
- [ ] Confirmation message shows with user's first name
- [ ] Responsive on mobile, tablet, desktop
- [ ] Accessible (keyboard navigation, screen reader friendly)
- [ ] CORS works between frontend and backend
- [ ] Frontend deployed to Cloudflare Pages
- [ ] Backend deployed to Railway
- [ ] `verifesto.com` loads the frontend
- [ ] `api.verifesto.com` accepts POST requests

---

## Execution Order

1. **Scaffold monorepo** (Step 1)
2. **Build Django backend** (Step 2) — model, serializer, view, admin
3. **Build Vue frontend** (Step 3) — brand tokens, components, form flow
4. **Write copy** (Step 4) — review with Adam & Kelsey
5. **Deploy** (Step 5) — Cloudflare Pages + Railway
6. **Test** (Step 6) — end-to-end verification

---

*This plan is the Phase 1 blueprint. Each subsequent phase will get its own plan document when we're ready.*
