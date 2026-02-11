# Verifesto Studios

> **Help people move from uncertainty → clarity → aligned action.**

Verifesto Studios is a human-centered consulting practice founded by Adam and Kelsey. This repository contains the website and platform that serves as the digital front door for the business.

**Domain:** [verifesto.com](https://verifesto.com)

---

## Table of Contents

- [Brand Philosophy](#brand-philosophy)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Hosting & Deployment](#hosting--deployment)
- [Phase Roadmap](#phase-roadmap)
- [Brand Identity](#brand-identity)
- [Intake Flow](#intake-flow)
- [Development](#development)

---

## Brand Philosophy

Verifesto believes:

- Clarity removes the need for persuasion
- Pressure corrupts decision-making
- Truth creates momentum when handled with care
- People already know more than they think — they need help seeing it

The role of Verifesto is not to convince, but to **reveal**.

**Brand archetype:** Calm Authority — speaks plainly, doesn't over-explain, is comfortable with silence, lets clarity do the work.

**What success feels like for clients:**
> "This is done, settled in, and I feel clear about my decision."

---

## Architecture

Monorepo with cleanly separated frontend and backend.

```
verifesto-studios/
├── frontend/          # Vue 3 + Vite + Tailwind CSS
├── backend/           # Django + Django REST Framework
├── docs/              # Brand documents, specs, design decisions
├── README.md          # This file — project source of truth
└── .gitignore
```

### Why a monorepo?

- Single source of truth for the entire platform
- Shared documentation and brand assets
- Simplified development workflow
- Easy to extend with new services later

---

## Tech Stack

### Frontend
| Technology | Purpose | Why |
|---|---|---|
| **Vue 3** (Composition API) | UI framework | Reactive, composable, excellent DX. Adam's preferred framework. |
| **Vite** | Build tool | Fast HMR, native ES modules, Vue-optimized |
| **Tailwind CSS** | Styling | Enforces design consistency, utility-first, brand-aligned tokens |

### Backend
| Technology | Purpose | Why |
|---|---|---|
| **Django** | Web framework | Batteries-included: ORM, admin panel, auth, migrations |
| **Django REST Framework** | API layer | Clean serializers, viewsets, browsable API |
| **PostgreSQL** | Database | Robust, scalable, Railway-managed |
| **Python** | Language | Best-in-class AI/ML ecosystem for future agent automation |

### Why Django over Node.js?

The decision came down to future vision:

1. **Admin panel for free** — Kelsey needs a management interface to handle clients, projects, conversations. Django Admin provides this immediately with minimal configuration.
2. **AI/agent ecosystem** — Python is the dominant language for AI tooling. Future plans include automated agents that kick off when clients reach out, AI-prefilled responses, and background task automation. Python gives direct access to the best libraries.
3. **Batteries included** — User auth, ORM, migrations, admin, CSRF protection, form validation — all built in. With Node.js, each of these would be a separate dependency to evaluate, install, and maintain.
4. **Documentation** — Django's documentation is legendary. Combined with Python's general documentation quality, this makes AI-assisted development more reliable.

---

## Hosting & Deployment

### Strategy: Cloudflare Pages (Frontend) + Railway (Backend)

A hybrid approach optimized for cost, performance, and developer experience.

#### Frontend → Cloudflare Pages

| Aspect | Detail |
|---|---|
| **Cost** | Free tier (500 builds/month, unlimited bandwidth) |
| **Why** | Domain is already on Cloudflare. Zero DNS configuration. Edge-cached globally. Automatic SSL. Preview deployments on PRs. |
| **Build command** | `npm run build` |
| **Output directory** | `dist` |
| **Root directory** | `frontend/` |

#### Backend → Railway

| Aspect | Detail |
|---|---|
| **Cost** | ~$5-15/month (Hobby plan, usage-based billing) |
| **Why** | First-class Django support, managed PostgreSQL, official MCP server for AI-native deployment workflow |
| **Services** | Django app + PostgreSQL database |
| **Root directory** | `backend/` |
| **API subdomain** | `api.verifesto.com` |

#### Why this hybrid?

1. **Cost efficiency** — Free frontend hosting. Only pay for backend compute/database.
2. **Performance** — Static assets served from Cloudflare's global edge network. API calls go to Railway.
3. **Native Cloudflare integration** — Domain is already there. Zero friction.
4. **Railway MCP server** — `@railway/mcp-server` integrates with Claude Code. Deploy, check logs, manage infrastructure without leaving the editor.
5. **Independent scaling** — Frontend and backend scale independently. Frontend is essentially infinite (edge CDN). Backend scales on Railway as needed.

#### DNS Configuration (Cloudflare)

```
verifesto.com      → Cloudflare Pages (frontend)
api.verifesto.com  → Railway (backend CNAME)
```

---

## Phase Roadmap

### Phase 1 — MVP: Landing Page + Intake Form ← CURRENT

**Goal:** A single-page site that receives client intake form submissions.

**Scope:**
- One-page landing site with brand presentation
- "Verifesto Studios" name and concise copy about who we are
- Client intake form (3 steps: Contact → Reflect → Schedule)
- Django backend to receive and store form submissions
- Basic, clean, on-brand design (Tailwind + brand tokens)
- Deploy frontend to Cloudflare Pages, backend to Railway

**Explicitly excluded from Phase 1:**
- Fancy animations (handwriting logo, book metaphor transitions)
- Admin dashboard
- Calendar integration for scheduling (placeholder in Phase 1)
- Email notifications / reminders

---

### Phase 2 — Animations & Polish

**Goal:** Bring the book metaphor and brand experience to life.

**Scope:**
- Handwritten "Verifesto Studios" logo animation
- Book metaphor for intake form (cover → chapters → pages)
- "Chapter 1" animations between form steps
- Smooth page-turn transitions
- Micro-interactions and hover states
- Loading states and form validation UX

---

### Phase 3 — Calendar Integration & Notifications

**Goal:** Complete the intake flow with real scheduling.

**Scope:**
- Live calendar integration (Google Calendar / Calendly API)
- Real-time availability display
- Automatic slot reservation on booking
- Confirmation emails after booking
- Reminder emails before calls
- Reconfirmation ~1 hour before call
- Anti-no-show measures

---

### Phase 4 — Admin Dashboard

**Goal:** Give Kelsey a centralized command center for managing clients.

**Scope:**
- Custom admin UI (beyond Django Admin)
- Project-based organization (all client data grouped by project)
- Unified inbox (emails, texts, form submissions — one place)
- Client status tracking and pipeline view
- TODO list with AI-prefilled action items
- Respond to clients from the dashboard

---

### Phase 5 — AI Automation & Agents

**Goal:** Automated workflows triggered by client activity.

**Scope:**
- Background agents triggered when clients reach out
- AI-prefilled responses for review
- Automated contract drafting
- Smart task prioritization
- Pattern recognition across client interactions

---

## Brand Identity

### Color System

#### Core Palette
| Token | Hex | Usage |
|---|---|---|
| Primary Ink | `#0B1220` | Primary text |
| Muted Ink | `#5B6475` | Secondary text |
| Surface | `#F7F8FA` | Primary background |
| Surface 2 | `#FFFFFF` | Cards, panels |
| Border | `#E6E8EE` | Dividers, borders |

#### Accent Colors
| Token | Hex | Usage |
|---|---|---|
| Verity Blue | `#2F6BFF` | Primary actions, key emphasis |
| Deep Blue | `#1F4FE0` | Hover states, emphasis |

#### Semantic Colors
| Token | Hex | Usage |
|---|---|---|
| Success | `#16A34A` | Success states |
| Warning | `#F59E0B` | Warning states |
| Error | `#DC2626` | Error states |

#### Special
| Token | Hex | Usage |
|---|---|---|
| Verifesto Gold | `#C9A227` | Rare highlights, signature moments only |

### Typography

| Role | Typeface | Style |
|---|---|---|
| Headlines / Display | **Fraunces** | Serif, editorial, warm |
| Body / UI Text | **Inter** | Sans-serif, clean, legible |

**Rules:**
- Headlines are short and confident
- Sentence case preferred over title case
- Generous line-height for readability
- No compressed or aggressive type treatments

### Visual Principles
- Calm, minimal, premium, clear, grounded
- Design should never compete with the message
- Prefer natural light, real textures, minimal compositions
- Avoid saturated stock photos, loud gradients, trend-heavy visuals

---

## Intake Flow

### Philosophy

The intake creates **intentional friction** without pressure.

**Flow:** Contact → Reflect → Commit

### Step 1 — Contact Information

**Purpose:** Establish identity and a reliable point of contact.

| Field | Required |
|---|---|
| First name | Yes |
| Last name | Yes |
| Email address | Yes |

Cognitive load is kept minimal. No extra fields at this stage.

### Step 2 — Reflection

**Purpose:** Surface intent without interrogation.

**The question:**
> "What prompted you to reach out right now?"

- Minimum: 1 complete sentence
- Maximum: No limit
- Includes a live markdown editor (WYSIWYG) with basic formatting
- Signals that depth is welcome but not required

This single question does the work of many:
- Tests intention
- Reveals urgency (self-generated vs external)
- Shows how the person thinks and communicates

### Step 3 — Scheduling

**Purpose:** Convert intent into a real commitment.

- Discovery call is **mandatory** (30 minutes)
- User selects from live availability
- Slot is immediately reserved
- Calendar invitation sent after booking

**Phase 1 note:** Step 3 will be a placeholder (simple "we'll be in touch to schedule" message) until calendar integration is built in Phase 3.

### Post-Submission

- Confirmation that a real call is being booked
- Calendar invitation
- Reminder(s) before the call
- Reconfirmation ~1 hour before

### Tone

Even with friction, the experience must feel calm, clear, respectful, and human. Friction is **structural**, never emotional.

---

## Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL (local or Docker)

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:5173`

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API runs at `http://localhost:8000`

### Deployment

#### Frontend (Cloudflare Pages)

Connected to the repository. Pushes to `main` auto-deploy.

- Build command: `npm run build`
- Output directory: `frontend/dist`

#### Backend (Railway)

Connected to the repository. Pushes to `main` auto-deploy.

- Root directory: `backend/`
- MCP server: `npx -y @railway/mcp-server`

---

## Brand Guardrails (Non-Negotiables)

Verifesto **must never**:

- Create artificial urgency
- Pressure decisions
- Guilt users into action
- Overpromise outcomes
- Sacrifice clarity for aesthetics

> If a choice violates decision integrity, it is off-brand.

---

## Voice & Tone Quick Reference

**Prefer:** "Let's get clear on what's true." · "No pressure to decide today." · "Clean decisions." · "Decision integrity."

**Avoid:** "Act now" · "Limited time" · "Don't miss out" · "Guaranteed results"

---

*Founded by Adam & Kelsey. Built with Paloma.*
