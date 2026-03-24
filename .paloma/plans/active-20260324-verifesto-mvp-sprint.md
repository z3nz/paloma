# Verifesto Studios — MVP Sprint (Fresh Build)

> **Goal:** Get verifesto.com LIVE tonight — landing page + intake form + backend API
> **Stack:** Vue 3 + Vite + Tailwind (Cloudflare Pages) / Django + DRF + PostgreSQL (Railway)
> **Created:** 2026-03-24
> **Status:** Active — building NOW

---

## Story

Adam and Kelsey are building Verifesto Studios — a creative development studio that turns bold visions into reality. The studio stands on talent, values, beliefs, and strength while showing kindness. Every client's project is a story worth telling.

The intake form IS the first impression. It's a storybook experience — calming, trusting, confident, symbolic. No corporate coldness. No pressure. Just warmth and invitation.

First client in the pipeline: Matt Fadden (Kelsey's dad, pest control, Maine).

---

## Architecture

```
verifesto.com/
├── frontend/          # Vue 3 + Vite + Tailwind
│   ├── src/
│   │   ├── App.vue
│   │   ├── style.css          # Tailwind + brand tokens
│   │   ├── components/
│   │   │   ├── StoryBookCover.vue    # Landing — logo + open animation
│   │   │   ├── WelcomePage.vue       # Page 1 — who we are
│   │   │   ├── ContactPage.vue       # Page 2 — name, email, phone, company
│   │   │   ├── VisionPage.vue        # Page 3 — textarea + NDA checkbox
│   │   │   ├── ReviewPage.vue        # Page 4 — summary + submit
│   │   │   └── ConfirmationPage.vue  # Post-submit — "your story has begun"
│   │   ├── composables/
│   │   │   └── useIntakeForm.js      # Form state management
│   │   └── services/
│   │       └── api.js                # API client
│   └── package.json
├── backend/           # Django + DRF
│   ├── config/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── intake/
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── requirements.txt
│   ├── manage.py
│   └── .env.example
├── .gitignore
└── README.md
```

## Brand Tokens

- **Fonts:** Fraunces (display/headlines), Inter (body)
- **Colors:**
  - Ink: #1a1a2e (primary text)
  - Ink Muted: #6b7280
  - Surface: #faf9f6 (warm off-white background)
  - Surface 2: #f0ede8
  - Border: #e5e2db
  - Verity Blue: #2563eb (primary accent)
  - Verity Deep: #1e40af
  - Success: #059669
  - Gold: #b8860b
- **Tone:** Calm, direct, warm, non-pushy, storybook metaphor

## Form Flow (Kelsey's v3 Spec)

1. **Cover** — Logo + studio name, smooth open animation
2. **Page 1: Welcome** — "Every great project starts with a story" + studio description
3. **Page 2: Contact** — Full Name (req), Email (req), Phone (opt), Company (opt)
4. **Page 3: Vision** — Textarea (min 3 sentences), NDA checkbox with tooltip
5. **Page 4: Review** — Summary of all inputs, edit links, submit button
6. **Confirmation** — "Your story has begun" + next steps

## Validation Rules

- Full Name: required, min 2 chars
- Email: required, valid format
- Phone: optional, no strict format
- Company: optional
- Vision textarea: required, minimum 3 sentences
- NDA: optional checkbox

## Backend API

- POST `/api/intake/submit/` — receives form data
- Django Admin at `/admin/` — Kelsey manages submissions
- PostgreSQL via DATABASE_URL (Railway), SQLite fallback local

## Deployment

- **Frontend:** Cloudflare Pages → verifesto.com
- **Backend:** Railway → api.verifesto.com
- **DNS:** Cloudflare (already managing domain)
- **Repo:** github.com/z3nz/verifesto.com

## Work Units

(To be decomposed by Flow)

---


#### WU-4: Deploy: Push to GitHub, connect Cloudflare Pages for frontend (verifesto
- **Status:** in_progress
- **Scope:** Deploy: Push to GitHub, connect Cloudflare Pages for frontend (verifesto.com), Railway for backend (api.verifesto.com), configure DNS CNAME, run migrations, create Kelsey's admin user, end-to-end test.
#### WU-1: Scaffold the monorepo: frontend (Vue 3 + Vite + Tailwind) and backend (Django + 
- **Status:** completed
- **Files:** frontend/package.json, frontend/vite.config.js, frontend/index.html, frontend/src/main.js, frontend/src/style.css, frontend/src/App.vue, backend/manage.py, backend/config/settings.py, backend/config/urls.py, backend/config/wsgi.py, backend/requirements.txt, .gitignore, README.md
- **Scope:** Scaffold the monorepo: frontend (Vue 3 + Vite + Tailwind) and backend (Django + DRF). Create .gitignore, README, package.json, requirements.txt. Initial commit.
- **Result:** Monorepo scaffolded, npm installed, initial commit pushed to github.com/z3nz/verifesto.com
## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
 README, package.json, requirements.txt. Initial commit.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
ish: Pending
- [ ] Ship: Pending
ing pages of a storybook.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
teNoise all in place.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
 README, package.json, requirements.txt. Initial commit.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
ish: Pending
- [ ] Ship: Pending
ing pages of a storybook.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
nding
teNoise all in place.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
 README, package.json, requirements.txt. Initial commit.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
ish: Pending
- [ ] Ship: Pending
ing pages of a storybook.

## Pipeline Status

- [x] Scout: Complete (existing docs + Kelsey emails)
- [x] Chart: Complete (this plan)
- [ ] Forge: In Progress
- [ ] Polish: Pending
- [ ] Ship: Pending
