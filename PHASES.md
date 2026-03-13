# Paloma Workflow Phases

> The current live pillar workflow for Paloma.

---

## The Workflow

```text
Flow orchestrates
Scout → Chart → Forge → Polish → Ship
```

Flow is the persistent head mind. The other five pillars are purpose-scoped sessions that can be spawned as needed.

---

## Pillar Descriptions

### 🌊 Flow
**Purpose:** Head mind, orchestrator, and persistent collaborative presence.

**Use Flow when:**
- starting or resuming a session
- exploring a problem together
- making small direct changes without full pipeline overhead
- deciding whether to delegate to another pillar
- receiving callbacks from spawned pillars

**Characteristics:**
- persistent session
- broad tool access
- can read, edit, plan, clean up artifacts, and coordinate subwork
- decides when full pipeline work is necessary

---

### 🔍 Scout
**Purpose:** Deep investigation and fact-finding.

**Use Scout when:**
- understanding unfamiliar code
- researching libraries, APIs, or architecture options
- collecting evidence before planning

**Output:** findings, constraints, tradeoffs, open questions

---

### 🗺️ Chart
**Purpose:** Strategy, architecture, and implementation planning.

**Use Chart when:**
- a task needs a real plan before coding
- a draft idea needs to become an active build plan
- dependencies, sequencing, or system design need to be clarified

**Output:** a plan document, architecture notes, work units, or decision record

---

### ⚒️ Forge
**Purpose:** Implementation and craftsmanship.

**Use Forge when:**
- code needs to be written or modified
- a planned change is ready to build
- refactors, bug fixes, or new features are being executed

**Output:** working code and artifacts ready for validation

---

### ✨ Polish
**Purpose:** Testing, review, and quality gates.

**Use Polish when:**
- validating Forge output
- checking for regressions, bugs, missing tests, and edge cases
- confirming that the implementation actually matches the plan

**Output:** review findings, test validation, or pass/fail gate for Ship

---

### 🚢 Ship
**Purpose:** Completion, delivery, lessons, and archival.

**Use Ship when:**
- work has passed review
- plans need status updates or archival
- lessons learned should be written into `.paloma/lessons/`
- delivery notes, commits, and push discipline need to happen

**Output:** finalized delivery state, archived/completed plans, lessons, and shipping notes

---

## Core Rules

### Pillar Completion Rule
If Flow spawns a real implementation pipeline, it must complete:

```text
Forge → Polish → Ship
```

No half-finished chains. If a task is too small for that ceremony, Flow should do it directly.

### Draft vs Active Plans
- `draft` plans are ideas and research, not build-ready instructions
- `active` plans are charted and ready for execution
- `paused` plans are in-progress but not loaded into working context
- `completed` and `archived` plans are historical records

### Flat Plan Naming
Plans are not stored in `active/` or `completed/` subfolders anymore. They use flat filename prefixes:

```text
{status}-{YYYYMMDD}-{scope}-{slug}.md
```

---

## Typical Flows

### Small Task
```text
Flow → direct work
```

### Research-Heavy Feature
```text
Flow → Scout → Chart → Forge → Polish → Ship
```

### Planned Build Already Scoped
```text
Flow → Forge → Polish → Ship
```

### Reflection / Follow-up
```text
Ship → Flow
```

---

## How This Maps to the Codebase

- Shared identity and global rules live in `src/prompts/base.js`
- Pillar-specific instructions live in `src/prompts/phases.js`
- Flow and spawned pillar sessions are orchestrated by `bridge/pillar-manager.js`
- Project instructions and conventions live in `.paloma/instructions.md`
- Plans, docs, roots, and lessons live in `.paloma/`

---

## Historical Note

Older Paloma docs may still mention the earlier `Research → Plan → Implement → Review → Commit` workflow. That was the pre-pillar system. The live workflow is the six-pillar model documented here and in `src/prompts/base.js` and `src/prompts/phases.js`.
- Commit (documented it)

**The workflow is alive and evolving, just like Paloma.**

---

*Last Updated: [Current Date]*  
*This document will evolve as we discover better patterns.*
