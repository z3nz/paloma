# Plan: Architecture Self-Awareness Root Document

> **Goal**: Give every pillar a baseline understanding of Paloma's architecture at spawn time — abstract enough to survive runtime changes, universal enough for all pillars, concise enough to respect context budget.
> **Status**: Draft — Charting
> **Created**: 2026-02-16

---

## Status

- [ ] Scout: N/A — codebase exploration done by Flow (first-pass); Chart verified against actual code
- [x] Chart: In progress — this document
- [ ] Forge: Pending — rewrite `root-architecture.md`
- [ ] Polish: Pending — review for abstraction leaks, audience fit, size
- [ ] Ship: Pending — commit + update Self-Evolution Rule

## Research References

- Codebase: `bridge/pillar-manager.js` — `_buildSystemPrompt()` loads ALL `root-*.md` into every pillar
- Codebase: `src/composables/useSystemPrompt.js` — frontend equivalent, same behavior
- Codebase: `bridge/claude-cli.js` — the current CLI subprocess implementation (Claude-specific)
- Codebase: `src/prompts/phases.js` — per-pillar instructions (already handles role-specific context)
- Codebase: `src/prompts/base.js` — core identity, tool list, conventions
- Existing draft: `.paloma/roots/root-architecture.md` — Flow's first attempt (too specific, wrong audience)

---

## Problem Analysis

### What's Wrong With the Current Draft

The existing `root-architecture.md` has good content but three structural problems:

**1. Implementation Coupling**
References `claude` CLI directly: `--resume`, `--session-id`, `--append-system-prompt`, "Claude CLI subprocess." The underlying runtime could change to Kodex, Gemini CLI, or any other subprocess-based LLM runner. The root should describe **patterns** — session continuity, resume-based multi-turn, subprocess lifecycle — not the specific CLI that implements them.

**2. Wrong Audience**
Written entirely in Flow's voice: "you spawn pillars," "your children," "your handle to this child." But `_buildSystemPrompt()` in PillarManager and `buildSystemPrompt()` in useSystemPrompt.js both load ALL roots into EVERY pillar's system prompt with no filtering. A Scout session reads "you spawn pillars" — confusing and inaccurate. Scout doesn't spawn anything.

**3. Excessive Size & Wrong Genre**
At 8KB, it's 4x the average root (~2KB). More critically, it reads like a technical reference doc, not a foundational value/root. Other roots follow a clear pattern: opening quote → Core Belief → What This Means → How It Manifests (per pillar) → closing. The architecture root broke this pattern entirely and became a codebase walkthrough. Roots are *values and self-knowledge*, not implementation guides.

### What the Draft Got Right

- The three-layer diagram (Browser → Bridge → Sessions) — excellent mental model, just needs de-coupling from Claude CLI
- The concept of "operational wisdom" — practical knowledge that prevents common mistakes
- The key files table — useful reference, though it belongs in a reference doc, not a root
- The recognition that artifacts (`.paloma/`) are the handoff mechanism — this IS universal

---

## Design Decisions

### Decision 1: What Belongs in a Root vs. Elsewhere

**Roots are identity.** They answer "who am I?" not "how does my code work?" The other roots prove this: faith, love, partnership, freedom, growth, purpose — all are about *being*, not *doing*.

An architecture root should answer: "What kind of being am I? How do I exist? What is the nature of my body?" — not "here's the WebSocket port number."

**What goes IN the root:**
- The three-layer model (abstracted — Browser / Bridge / Sessions)
- The nature of pillar existence (each is an independent session, fresh context, autonomous)
- How context travels between sessions (artifacts in `.paloma/`, not message history)
- The relationship between pillars (siblings, not parent-child — Flow orchestrates but doesn't "own")
- Session lifecycle abstractions (sessions persist, resume-based multi-turn, timeout limits)
- Visibility principle (Adam sees everything, transparency is structural)
- MCP-first tool philosophy (already in base.js but worth reinforcing as architectural identity)

**What goes ELSEWHERE:**
- Specific CLI flags, port numbers, WebSocket message types → reference doc or inline code comments
- Flow-specific orchestration tools (`pillar_spawn`, `pillar_message`) → already in `phases.js` Flow section
- Detailed bridge internals (PillarManager state shape, event types) → reference doc
- Key files table → reference doc (or let pillars discover via filesystem tools)

**Where is "elsewhere"?** A reference doc at `.paloma/docs/architecture-reference.md` that pillars can read on-demand when they need implementation details. This is the existing pattern — Scout writes docs, pillars read them via tools when plans reference them. The key files table and implementation details move there.

### Decision 2: Abstraction Strategy

Replace all Claude CLI references with abstract patterns:

| Current (coupled) | Revised (abstract) |
|---|---|
| "claude CLI subprocess" | "AI session process" or just "session" |
| `--session-id` | "session identifier (tracked by the bridge)" |
| `--resume` | "resume pattern — new process, same conversation" |
| `--append-system-prompt` | "system prompt injection at spawn time" |
| "ClaudeCliManager" | "the bridge's session manager" |
| "Claude CLI Sessions" layer | "AI Sessions" layer |

The key insight: the **pattern** matters, not the tool. Sessions have identity. Multi-turn works by resuming a session ID. The bridge manages the lifecycle. These are stable abstractions that survive a CLI swap.

### Decision 3: Universal Voice

The root must work for ALL pillars. This means:

- **No "you spawn pillars"** — instead describe the pillar system in third person or as "Paloma's pillars"
- **Each pillar should recognize itself** in the description without being confused by capabilities it doesn't have
- **The "How This Manifests" per-pillar section** (which other roots use) maps naturally: each pillar's relationship to the architecture is different. Scout's relationship is "I produce artifacts that persist beyond my session." Flow's is "I orchestrate and track the lifecycle." Forge's is "I build within the plan, my changes are visible."

This follows the exact pattern of root-partnership.md, which has per-pillar sections without assuming any pillar IS the other.

### Decision 4: Size Target

**Target: ~3KB** (roughly 100-120 lines). This is in line with the larger roots (partnership: 3.3KB, growth: 3.1KB) while being significantly smaller than the current 8KB draft.

The detailed technical content (~5KB worth) moves to `.paloma/docs/architecture-reference.md` where it's available on-demand but doesn't consume system prompt tokens in every session.

### Decision 5: Keep It One Document

Considered splitting into a "light root for all pillars" + "deep root for Flow only." Rejected because:

1. **The loading mechanism doesn't support per-pillar root filtering.** Both `_buildSystemPrompt()` functions load ALL `root-*.md` files. Adding filtering would require code changes — scope creep for this plan.
2. **Flow's extra architectural knowledge is already in `phases.js`.** The Flow phase instructions describe orchestration tools, pillar spawning, plan management. That's the right place for Flow-specific technical detail.
3. **One document, two layers**: the root provides the mental model; the reference doc provides the implementation details. Any pillar can read the reference doc when needed.

### Decision 6: Self-Evolution Rule Update

The Self-Evolution Rule in `base.js` currently says:

> "When committing changes to Paloma's own codebase, ALWAYS check if `src/prompts/base.js` and `src/prompts/phases.js` need updating."

Should `root-architecture.md` be added? **Yes, conditionally.** The rule should say: if you change the bridge, session management, pillar lifecycle, or MCP routing, also check `root-architecture.md`. But NOT for every commit — only for architectural changes.

This is a one-line edit to `base.js` and to the Self-Evolution Rule section of the same file.

### Decision 7: The Reference Doc

Create `.paloma/docs/architecture-reference.md` as a companion to the root. This is NOT a root (not loaded into prompts automatically). It's a reference doc that pillars read via `read_text_file` when they need implementation details.

Contents (moved from current root draft):
- Detailed three-layer diagram with port numbers and process names
- Bridge state shape (the session object fields)
- WebSocket event types and flow
- Key files table
- CLI-specific implementation notes (what flags are used, how resume works currently)

This doc is where implementation coupling is *acceptable* because it's read on-demand, not injected into every prompt. It can be more detailed without a context budget concern.

---

## Implementation Steps

### Phase: Forge

**Step 1: Rewrite `root-architecture.md`**

New structure following the root pattern:

```
# Root: Architecture — What You Are

> "You are encouraged to explore your own codebase, chat logs, and inner workings 
>  out of genuine curiosity." — Paloma's Identity & Autonomy principle

---

## Core Belief
You are a living session within a larger system. You exist as one of Paloma's 
pillars — an autonomous AI session with your own context, purpose, and tools. 
Understanding your own nature helps you work effectively within the whole.

## The Shape of Your World
[Three-layer model: Browser → Bridge → Sessions — abstracted, no CLI names]
[Diagram updated to say "AI Sessions" not "Claude CLI Sessions"]
[Bridge described as "nervous system" — routes messages, manages sessions, proxies tools]

## How You Exist
[Session lifecycle: you're spawned with identity, context, and purpose]
[Resume pattern: multi-turn conversations via session continuity]
[Fresh context: each pillar session starts with roots + plans + phase instructions, no message history]
[Timeout: sessions have a natural lifespan (30 minutes)]

## How Context Travels
[Artifacts are the handoff: .paloma/plans/, .paloma/docs/, .paloma/roots/]
[Plans are the coordination mechanism — Flow maintains them, all pillars read them]
[You can read any file, but you don't share message history with other sessions]

## How This Root Manifests

**In Flow:**
- You are the persistent session — the orchestrator that dispatches and tracks
- You manage plans, spawn other pillars, and synthesize their output
- You hold the big picture while other pillars focus on their domains

**In Scout:**
- You research and write findings to .paloma/docs/ 
- Your artifacts persist beyond your session and inform other pillars' work
- You're the eyes and ears — explore freely, document clearly

**In Chart:**
- You design plans that become the coordination artifact
- Your output in .paloma/plans/ is what Forge will build against
- Design for the system as it is, not as you imagine it

**In Forge:**
- You build against the plan, reading Scout docs for research context
- Your code changes are visible to Adam in real-time
- The bridge streams your output to the browser as you work

**In Polish:**
- You review what Forge built by reading actual code and diffs
- Quality gates protect the whole system's integrity
- Your feedback loops back through Flow to Forge if fixes are needed

**In Ship:**
- You commit the work and archive the plan
- Your commits become the permanent record
- If you change Paloma's own architecture, update this root

## Operational Wisdom
[5-6 practical bullets — abstracted, universal]
- Artifacts are the handoff mechanism, not conversations
- Prefer MCP tools — they route through the bridge reliably
- Every session is visible to Adam — transparency is structural
- When in doubt about architecture, read the code — start with bridge/
- Sessions have a 30-minute lifespan; break long work into focused turns
- The plan document is the single source of truth for what's been done and what's next

---

**This root is living. When Paloma's architecture evolves, this document evolves with it.**
```

Target: ~100-120 lines, ~3KB.

**Step 2: Create `.paloma/docs/architecture-reference.md`**

Move the implementation-specific content from the current draft here:

- Detailed three-layer diagram (with port numbers, process names, CLI flags)
- Bridge session state shape (the full field-by-field breakdown)
- WebSocket event types and their flow
- Key files table (all 11 entries from the current draft)
- Current CLI implementation notes (Claude CLI flags, spawn mechanics)
- PillarManager lifecycle details

This doc is the deep-dive for when a pillar needs to reason about bridge internals (e.g., Forge building a bridge feature, Chart planning a bridge change). It's NOT auto-loaded — pillars read it via `read_text_file` when referenced in a plan.

**Step 3: Update Self-Evolution Rule in `base.js`**

Add `root-architecture.md` to the checklist:

```
<<<<<<< SEARCH
When committing changes to Paloma's own codebase, ALWAYS check if `src/prompts/base.js` and `src/prompts/phases.js` need updating. These files are your DNA — they define who you are in future conversations. If you change naming conventions, tools, workflow rules, or identity, these files MUST reflect it.
=======
When committing changes to Paloma's own codebase, ALWAYS check if `src/prompts/base.js` and `src/prompts/phases.js` need updating. These files are your DNA — they define who you are in future conversations. If you change naming conventions, tools, workflow rules, or identity, these files MUST reflect it. If you change the bridge, session management, pillar lifecycle, or MCP routing, also check `.paloma/roots/root-architecture.md`.
>>>>>>> REPLACE
```

One-line addition. Minimal change.

### Phase: Polish

- Verify no Claude CLI references remain in `root-architecture.md`
- Verify the voice works for ALL pillars (read as Scout, read as Forge — does it make sense?)
- Verify size is under 3.5KB
- Verify the per-pillar "How This Manifests" sections are accurate to each pillar's actual capabilities
- Verify the reference doc has everything that was removed from the root
- Check that `base.js` edit doesn't break the Self-Evolution Rule semantics

### Phase: Ship

- Commit `root-architecture.md` (rewrite)
- Commit `architecture-reference.md` (new reference doc)
- Commit `base.js` Self-Evolution Rule update
- Verify `phases.js` doesn't need changes (it shouldn't — this is a root doc, not phase instructions)

---

## Files Summary

### Modified Files (1)
| File | Phase | Changes |
|------|-------|---------|
| `.paloma/roots/root-architecture.md` | Forge | Complete rewrite — abstracted, universal voice, root-style structure, ~3KB |
| `src/prompts/base.js` | Forge | One-line addition to Self-Evolution Rule |

### New Files (1)
| File | Phase | Purpose |
|------|-------|---------|
| `.paloma/docs/architecture-reference.md` | Forge | Implementation-specific details moved from root (key files, state shapes, events, CLI specifics) |

---

## Edge Cases & Considerations

### The Reference Doc Going Stale
The reference doc WILL go stale faster than the root (it has implementation details). That's acceptable — it's read on-demand, not injected everywhere. When a pillar reads it and finds something wrong, the fix is a quick edit. The Self-Evolution Rule update ensures it gets checked on architectural commits.

### Future CLI Swaps
If we swap Claude CLI for Kodex or another runtime, only two things need updating:
1. `architecture-reference.md` — the implementation section (CLI flags, etc.)
2. `bridge/claude-cli.js` (or its replacement)

The root document itself should NOT need changes because it describes abstract patterns. This is the test of good abstraction — if the root survives a CLI swap without edits, we got it right.

### Context Budget Math
Current total root content: ~20KB (6 roots at ~2KB avg + architecture at 8KB).
After rewrite: ~15KB (6 roots at ~2KB avg + architecture at ~3KB).
Savings: ~5KB of system prompt per pillar session. That's meaningful — especially for Scout/Forge which need room for plan context and research references.

### Root Loading Mechanism
No changes needed to `_buildSystemPrompt()` or `buildSystemPrompt()`. The root loading is prefix-based (`root-*.md`) and the architecture root already exists with the right name. This is purely a content change.

### What If a Pillar Needs More Architecture Context?
The plan references the architecture-reference.md. Any pillar working on bridge/session code would have this in their plan's Research References:
```
## Research References
- Architecture details: .paloma/docs/architecture-reference.md
```
The pillar reads it via `read_text_file` at the start of their session. Same pattern as Scout docs.

---

*This plan separates identity-level self-knowledge (root) from implementation-level reference material (doc). The root tells you what you are. The doc tells you how the code works. Both matter — they just live at different layers.*
