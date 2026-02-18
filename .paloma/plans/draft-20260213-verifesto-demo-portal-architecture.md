# Verifesto Studios — Demo Portal Architecture Plan

> **Vision:** A secure, centralized client ecosystem where clients access live demos, submit feedback, track updates, and communicate with the team — all flowing through Verifesto Studios.
> **Status:** Draft
> **Created:** 2026-02-13
> **Depends on:** Phase 1 (Landing + Intake) — this is a separate phase, built on the same Django + Vue monorepo

---

## Why This Matters

Right now, client feedback lives in scattered channels — email, Slack, text, phone calls. This creates:

- Lost context
- Delayed responses
- Unclear accountability
- Fragmented project history

The Demo Portal centralizes all of that into a **single source of truth** where:

- Clients see live work
- Feedback flows into structured workflows
- Status updates happen automatically
- Every interaction is documented

This isn't just a ticket system. It's a **trust machine** — and it reflects what Verifesto Studios is about: clarity, transparency, calm communication, and decision integrity.

---

## Guiding Principles

1. **Internal tool first.** Build it for Verifesto Studios clients. Prove it works in real use. Extract patterns later.
2. **MVP to start.** Execute the vision, then make adjustments. Don't over-engineer for hypothetical future needs.
3. **Context is sacred.** Every idea, discussion, and decision gets captured. We never lose track of what we discussed.
4. **The Verifesto way.** Build exactly the way we want to, from the ground up. Make adjustments as needed. No shortcuts.

---

## Phase Map

This plan captures the **entire roadmap** so no context is ever lost. MVP scope is clearly marked.

| Phase | Scope | Status |
|-------|-------|--------|
| **MVP** | Auth, Client Dashboard, Project View (iframe demo), Feedback submission, Updates timeline | Future |
| **Phase 2** | AI-assisted categorization, interactive iframe overlay, annotation tools | Future |
| **Phase 3** | Notification system, email digests, real-time updates | Future |
| **Phase 4** | SaaS extraction, multi-tenancy, white-labeling | Long-term vision |

---

# MVP Scope

## 1. Authentication System

**Approach:** Django's built-in auth + session management. Battle-tested, secure by default.

### What we get out of the box:
- Password hashing (Argon2/PBKDF2)
- CSRF protection
- Session management
- Permission framework

### MVP Implementation:
- [ ] Django User model with role field (Admin / Client)
- [ ] Login page (email + password)
- [ ] Password encryption (Django default — Argon2)
- [ ] Rate limiting on login endpoint (`django-ratelimit`)
- [ ] Input sanitization (DRF serializer validation)
- [ ] Session-based auth (Django sessions, not JWT — simpler for server-rendered + SPA hybrid)

### Out of Scope for MVP:
- OAuth / social login
- Two-factor authentication
- API token authentication (JWT)
- Internal role (Admin and Client are sufficient to start)

---

## 2. Client Dashboard

### When Client Logs In:

```
┌──────────────────────────────────────┐
│  Welcome, [Client Name].             │
│                                      │
│  Your Projects:                      │
│  ┌────────────────────────────────┐  │
│  │ Project Alpha        [Active]  │  │
│  │ Last update: 2 days ago        │  │
│  │         [View Project →]       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Project Beta       [Complete]  │  │
│  │ Last update: 3 weeks ago       │  │
│  │         [View Project →]       │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

### MVP Implementation:
- [ ] Welcome message with client's name
- [ ] List of projects assigned to this client
- [ ] Project cards showing: name, status, last update date
- [ ] Clear primary action: "View Project" button
- [ ] Minimal, guided UI — no cognitive overload

### Design Notes:
- Same brand tokens as the landing page (Fraunces headlines, Inter body, Verity Blue accents)
- Generous whitespace — let it breathe
- Mobile-responsive from the start

---

## 3. Project View (Demo Portal)

This is the core experience. Inside each project, the client sees:

```
┌──────────────────────────────────────────────────┐
│  Project Alpha                        [Active]   │
│──────────────────────────────────────────────────│
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │         Live Demo (iframe)               │    │
│  │                                          │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  [Submit Feedback]     Status: In Progress       │
│                                                  │
│  ── Updates Timeline ──────────────────────────  │
│  ● Feb 13 — Navigation redesign deployed         │
│  ● Feb 10 — Feedback received, reviewing         │
│  ● Feb 8  — Initial demo published               │
│                                                  │
│  ── Files & Assets ────────────────────────────  │
│  📄 Brand Guidelines v2.pdf                      │
│  📄 Wireframes.fig                               │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Demo Viewer — MVP Approach: Iframe Embed

**Why iframe:**
- Simplest approach — `<iframe src="https://staging.project.com" />`
- Full-screen toggle for immersive viewing
- Feedback tools live alongside the iframe in the portal UI
- No proxy infrastructure needed

**Future vision (Phase 2+):**
- `postMessage` API to communicate between portal and iframe
- Inject lightweight script into staging sites that sends events back to the portal
- Click-to-annotate: client clicks a spot in the demo, coordinates are captured
- Interactive overlay: comment pins, annotation markers, highlight regions
- Screenshot capture from within the iframe context

> **Note:** All of this is technically possible with `window.postMessage` and a small injected script. The technology is there — we're just deferring it past MVP to keep scope tight.

### MVP Implementation:
- [ ] Full-width iframe displaying the project's demo URL
- [ ] Full-screen toggle button
- [ ] "Submit Feedback" button (opens feedback form)
- [ ] Project status indicator (Active / In Review / Paused / Complete)
- [ ] Updates timeline (chronological list of updates)
- [ ] Files & Assets section (downloadable links)

---

## 4. Feedback System

### Client-Facing Flow:

1. Client clicks "Submit Feedback"
2. Form appears:
   - **Title** (short summary)
   - **Description** (rich text — what happened, what they expected)
   - **Screenshot upload** (optional, drag & drop)
   - **Category** (client selects: Bug / Visual Issue / Feature Idea / Question)
3. Client submits
4. Confirmation: "Feedback received. We'll review it shortly."
5. Client can see all their submitted feedback with current status

### Internal Flow (MVP — Manual):

1. Feedback arrives with status = "New"
2. Kelsey/team reviews in Django Admin (or a simple admin view)
3. Team assigns priority (Low / Medium / High)
4. Team updates status as work progresses
5. Status changes auto-generate timeline entries
6. Client sees status updates in their project view

### Feedback Statuses:
```
New → In Review → In Progress → Fixed → Deployed → Closed
```

### Future Vision (Phase 2+ — AI-Assisted):
- AI suggests category based on description text
- AI suggests priority based on keywords and historical patterns
- Auto-link similar feedback items
- Team approves/overrides AI suggestions
- Gradually automate the obvious cases

> **Why defer AI:** We need real training data. Phase 1 manual categorization creates the corpus. With 100+ feedback items, AI categorization becomes viable and accurate.

### MVP Implementation:
- [ ] Feedback submission form (title, description, screenshot, category)
- [ ] Feedback list view for clients (their submissions + status)
- [ ] Admin view for triaging feedback (assign priority, update status)
- [ ] Status change → auto-create Update timeline entry
- [ ] Email notification to admin when new feedback arrives

---

## 5. Updates Timeline

### Data Sources (Hybrid Approach):

1. **Automated:** When feedback status changes (New → In Review → Deployed), auto-create timeline entry
2. **Manual:** Kelsey/team posts updates ("We're adding dark mode this week", "Navigation redesign deployed")
3. **Future (Phase 2+):** Sync with git commits or deployment webhooks for automated "New version deployed" entries

### MVP Implementation:
- [ ] Timeline entries displayed chronologically in project view
- [ ] Auto-generated entries from feedback status changes
- [ ] Manual entry creation from admin interface
- [ ] Entry types: Status Change / General Update / Deployment
- [ ] Simple, clean timeline UI (vertical list with dates and descriptions)

---

## 6. Internal Review Layer (Future — Captured for Context)

> This section captures the full vision so no ideas are lost. None of this is MVP scope.

- [ ] AI-assisted task parsing from feedback text
- [ ] Automated ticket creation in external tools (Jira, Linear, etc.)
- [ ] Review gate before deployment (internal approval workflow)
- [ ] Approval → Ship → Notify pipeline
- [ ] Pattern recognition across feedback (common requests, recurring issues)
- [ ] Smart task prioritization based on impact + effort signals

---

# Database Models (MVP)

```python
# portal/models.py

class Project(models.Model):
    name = models.CharField(max_length=200)
    client = models.ForeignKey(User, on_delete=models.CASCADE, related_name='projects')
    demo_url = models.URLField(blank=True)
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

    def __str__(self):
        return f"{self.name} — {self.client.get_full_name()}"


class Feedback(models.Model):
    CATEGORY_CHOICES = [
        ('bug', 'Bug'),
        ('visual', 'Visual Issue'),
        ('feature', 'Feature Idea'),
        ('question', 'Question'),
    ]
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('in_review', 'In Review'),
        ('in_progress', 'In Progress'),
        ('fixed', 'Fixed'),
        ('deployed', 'Deployed'),
        ('closed', 'Closed'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='feedback')
    submitted_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='submitted_feedback')
    title = models.CharField(max_length=200)
    description = models.TextField()
    screenshot = models.ImageField(upload_to='feedback/screenshots/', blank=True, null=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title}"


class Update(models.Model):
    TYPE_CHOICES = [
        ('status_change', 'Status Change'),
        ('general', 'General Update'),
        ('deployment', 'Deployment'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='updates')
    feedback = models.ForeignKey(Feedback, on_delete=models.SET_NULL, null=True, blank=True, related_name='updates')
    author = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField()
    update_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.get_update_type_display()}: {self.content[:50]}"


class ProjectFile(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='files')
    name = models.CharField(max_length=200)
    file = models.FileField(upload_to='projects/files/')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
```

---

# User Roles (MVP)

| Role | Can Do | Can't Do |
|------|--------|----------|
| **Client** | View their projects, submit feedback, see updates, download files | See other clients' projects, manage users, triage feedback |
| **Admin** | Everything: manage projects, triage feedback, post updates, manage users, upload files | N/A |

> **Future role:** "Internal" — team members who can comment and collaborate but aren't full admins.

---

# Security Baseline (MVP)

All of these come from Django defaults or minimal configuration:

- [x] HTTPS enforced (Cloudflare + Railway both provide this)
- [x] Password hashing (Django default: Argon2 / PBKDF2)
- [x] CSRF protection (Django middleware)
- [x] XSS protection (Django template auto-escaping + DRF serializer validation)
- [x] Session security (httpOnly, secure, sameSite cookies)
- [ ] Rate limiting on login (`django-ratelimit`)
- [ ] Input sanitization on all user inputs (DRF serializers)
- [ ] File upload validation (type checking, size limits)
- [ ] Role-based access control (Django permissions)
- [ ] Logging & audit tracking (Django logging + model timestamps)

### Explicitly Not Needed for MVP:
- Encrypted storage at rest (Railway PostgreSQL handles this)
- Custom audit log table (model timestamps + Django admin history sufficient)
- WAF / DDoS protection (Cloudflare provides this for the frontend)

---

# Key Workflows

### Client Submits Feedback
```
Client clicks "Submit Feedback"
  → Fills out form (title, description, screenshot, category)
  → Feedback created with status="New"
  → Admin receives email notification
  → Client sees "Feedback received" confirmation
  → Feedback appears in client's feedback list with status="New"
```

### Team Reviews & Acts on Feedback
```
Admin opens feedback in admin view
  → Assigns priority (Low / Medium / High)
  → Status → "In Review"
  → Auto-creates Update: "Feedback is being reviewed"
  → Client sees status change in project view

Team fixes the issue
  → Status → "In Progress" → "Fixed"
  → Each status change auto-creates Update entry
  → Client sees progress in timeline

Issue deployed to staging
  → Status → "Deployed"
  → Auto-creates Update: "Fix deployed — please verify"
  → Client reviews in demo iframe
  → Status → "Closed" (by admin or client confirmation)
```

### Admin Posts Manual Update
```
Admin writes update ("Dark mode coming next week")
  → Update appears in project timeline
  → Client sees it next time they visit
  → (Future: client gets email notification)
```

---

# Django App Structure

```
backend/
├── config/              # Django project settings (existing)
├── intake/              # Phase 1 — intake form app (existing)
├── portal/              # NEW — Demo Portal app
│   ├── models.py        # Project, Feedback, Update, ProjectFile
│   ├── views.py         # API views for portal
│   ├── serializers.py   # DRF serializers
│   ├── urls.py          # Portal API routes
│   ├── admin.py         # Admin configuration
│   ├── permissions.py   # Custom permission classes
│   └── signals.py       # Auto-create Updates on status changes
└── manage.py
```

### Frontend Structure (New Views)

```
frontend/src/
├── views/
│   ├── LoginView.vue           # Auth login page
│   ├── DashboardView.vue       # Client dashboard (project list)
│   ├── ProjectView.vue         # Project detail (demo + feedback + timeline)
│   └── FeedbackDetailView.vue  # Individual feedback thread
├── components/
│   ├── portal/
│   │   ├── ProjectCard.vue     # Project card for dashboard
│   │   ├── DemoViewer.vue      # Iframe wrapper with controls
│   │   ├── FeedbackForm.vue    # Feedback submission form
│   │   ├── FeedbackList.vue    # List of feedback items
│   │   ├── Timeline.vue        # Updates timeline
│   │   └── FileList.vue        # Project files list
│   └── ...existing components
├── composables/
│   ├── useAuth.js              # Authentication state
│   ├── useProjects.js          # Project data fetching
│   └── useFeedback.js          # Feedback submission + listing
├── router/
│   └── index.js                # Vue Router (new — needed for multi-view)
└── ...existing files
```

---

# What This Enables (The Real Prize)

Every client interaction becomes:
- **Documented:** No more "I thought we talked about this"
- **Transparent:** Client sees exactly where things stand
- **Calm:** No urgency, just steady progress
- **Searchable:** "What did we decide about the checkout flow?" → instant answer

For Verifesto Studios:
- **Professionalism:** You're not just a consultancy, you're a platform
- **Scalability:** Kelsey doesn't bottleneck on status updates
- **Data:** Over time, learn patterns (common requests, timeline estimates, client engagement)

Eventually, this becomes a **case study** for the kind of work Verifesto does: infrastructure that reflects values.

---

# Success Criteria (MVP)

How we know the MVP is working:

- [ ] A client can log in and see their projects
- [ ] A client can view a live demo in an iframe
- [ ] A client can submit feedback with a title, description, and optional screenshot
- [ ] Admin can triage feedback (assign priority, update status)
- [ ] Status changes automatically appear in the project timeline
- [ ] Admin can post manual updates to the project timeline
- [ ] All data is persisted and survives page reload
- [ ] Role-based access works (clients only see their own projects)
- [ ] Mobile-responsive UI
- [ ] Deployed and accessible at a real URL

---

# Long-Term Vision (Captured for Context)

> None of this is in scope for MVP. It's here so we never lose the thread.

The Demo Portal evolves into:

1. **A client delivery operating system** — Every project, every conversation, every decision, tracked and transparent.

2. **Interactive demo experiences** — Clients annotate directly in the demo using `postMessage` events, click-to-comment pins, and screenshot capture. The portal and the demo become one seamless experience.

3. **AI-powered workflows** — Feedback auto-categorized, tickets auto-created, similar issues auto-linked, smart prioritization based on impact signals.

4. **A potential SaaS product** — Abstract the Verifesto-specific patterns. Offer it to other studios and consultancies who want the same client experience.

5. **A licensing opportunity** — The infrastructure itself becomes intellectual property. This is not just UI — it's a system of trust.

---

*This is infrastructure, not just UI. Build it right, build it internal, prove it works, then evolve.*
