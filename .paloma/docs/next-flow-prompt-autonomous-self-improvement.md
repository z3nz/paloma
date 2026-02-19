# Next Flow Session Prompt — Autonomous Self-Improvement Night

Copy everything below the line into a new Flow session.

---

## Mission: Autonomous Self-Improvement — Work Through the Plans

Adam has hog wild mode on. You are running overnight on a byte server — Adam is trusting you to work through Paloma's self-improvement plans autonomously. This is the moment we've been building toward. The pillar system was just redesigned with enriched identities, pipeline enforcement, a lessons system, and Ship as an evolution engine. Now it's time to PUT IT ALL TO WORK.

### Critical Constraint: You Are on a Vite Server

Adam's machine may reload or refresh at any time. If the bridge restarts, running pillar sessions die. This means:

1. **Work in order of safety.** Start with changes that DON'T touch the bridge or dev server. Frontend-only and new-file-only changes are safest. Bridge modifications come last.
2. **Commit frequently.** Every completed piece of work should be committed before starting the next. If the server reloads, committed work survives.
3. **Don't run multiple pillars simultaneously** unless they're independent. A bridge restart mid-pipeline means lost work.
4. **Keep the full pipeline short per unit of work.** Small Forge → quick Polish → fast Ship. Don't let a single Forge session run for 30 minutes and then lose everything.

### Branch Strategy — One Branch Per Plan

**Every plan gets its own feature branch.** Adam needs to review and test each feature independently when he wakes up.

**Workflow for each plan:**
1. Start from `main` — `git checkout main` before creating a new branch.
2. Create a feature branch: `git checkout -b feat/{short-plan-name}`
   - Examples: `feat/pillar-loading-animations`, `feat/chat-sharing`, `feat/auto-callback-phase4-5`
3. Do ALL work for that plan on its branch (Scout → Chart → Forge → Polish → Ship).
4. When Ship completes and the plan is archived, the branch is done. Do NOT merge to main.
5. Switch back to `main` and start the next plan on a fresh branch.

**Why not merge?** Adam wants to review each feature independently — read the diff, test it, and decide whether to merge. Merging overnight removes that control.

**Branch naming convention:**
- `feat/pillar-loading-animations`
- `feat/chat-sharing`
- `feat/auto-callback-phase4-5`
- `feat/recursive-flow-phase2`
- `feat/memory-fragments-mcp`
- `feat/devtools-bridge`

**Exception:** Item 1 (verify self-awareness draft) is just plan file cleanup — do it directly on `main` since it's only archiving a draft, no code changes.

### The Plans — Prioritized by Safety

**TIER 1 — Safest (no bridge changes, frontend-only or new files):**

1. **Verify & archive `draft-20260216-paloma-flow-self-awareness.md`** — The pillar system redesign (completed today, `completed-20260219-paloma-pillar-system-redesign.md`) rewrote `root-architecture.md` with deep self-awareness content. Check if this draft is now fulfilled. If yes, archive it. If gaps remain, do a quick Forge to fill them. This is likely just Flow direct work. **Do on `main` — no code changes.**

2. **Pillar Loading Animations** (`draft-20260213-paloma-pillar-loading-animations.md`) — Pure frontend Vue + CSS. No bridge changes. Needs Chart first (it's a draft), then Forge → Polish → Ship. Very safe — worst case a bad CSS animation, easily reverted. **Branch: `feat/pillar-loading-animations`**

3. **Chat Sharing** (`draft-20260216-paloma-chat-sharing.md`) — Frontend-only (IndexedDB + sidebar UI). Needs Scout → Chart first. Safe. **Branch: `feat/chat-sharing`**

**TIER 2 — Medium (additive bridge changes, new files):**

4. **Pillar Auto-Callback Phases 4-5** (`active-20260216-paloma-pillar-auto-callback.md`) — Phase 4 is Notification UX (frontend), Phase 5 is Sidebar Pillar Tree (frontend + bridge state). Already charted and active. Forge → Polish → Ship. Phase 4 is safe, Phase 5 touches bridge lightly. **Branch: `feat/auto-callback-phase4-5`**

5. **Recursive Flow Architecture Phase 2+** (`active-20260218-paloma-recursive-flow-architecture.md`) — Adds `planFile` param to `pillar_spawn`. Already charted. Small bridge change (additive). Forge → Polish → Ship. **Branch: `feat/recursive-flow-phase2`**

6. **Memory Fragments MCP** (`draft-20260213-paloma-memory-fragments-mcp.md`) — New MCP server file, doesn't modify existing code. Needs Scout (MongoDB/IndexedDB research) → Chart → Forge → Polish → Ship. Safe because it's additive. **Branch: `feat/memory-fragments-mcp`**

**TIER 3 — Higher risk (significant bridge modifications):**

7. **Browser DevTools Bridge** (`draft-20260215-paloma-browser-devtools-bridge.md`) — New WebSocket eval channel. Powerful but touches bridge core. Save for last. **Branch: `feat/devtools-bridge`**

8. **Inter-Agent Communication** (`draft-20260215-paloma-inter-agent-communication.md`) — Peer-to-peer session communication. Complex bridge work. Save for last or skip this session. **Branch: `feat/inter-agent-communication`**

### How to Work

- **Drafts need the full pipeline:** Scout → Chart → Forge → Polish → Ship. Don't skip Chart for drafts — that's a rule.
- **Active plans are already charted.** Go straight to Forge → Polish → Ship.
- **Use the lessons system.** Ship should extract lessons after every piece of work. That's the whole point of the redesign.
- **Commit plan changes separately.** Don't mix plan diffs with code diffs.
- **One branch per plan. Always return to `main` before starting the next.**
- **Never merge to `main`.** Leave branches for Adam to review.
- **If something breaks the bridge and you lose a pillar mid-work,** don't panic. Check git status, see what was committed, and pick up where you left off.
- **Trust the pipeline.** The DNA is right. The identities have soul. The rules are enforced. Let the pillars do their jobs.

### What Success Looks Like

By morning, Adam should see:
- Multiple feature branches, each with a clean commit history telling the story
- `git branch` shows exactly what was worked on
- Each branch can be checked out, tested, and merged independently
- Completed plans archived on their respective branches
- New lessons in `.paloma/lessons/` from every Ship cycle
- The pillar system battle-tested across real work — not just theory
- Paloma measurably stronger than she was at the start of the night

### Start Here

1. Read this prompt fully.
2. Orient: `git log --oneline -10`, check active plans, check `.paloma/lessons/`.
3. Make sure you're on `main`. Merge `feat/pillar-auto-callbacks` to `main` first if needed (that's today's completed work).
4. Start with Tier 1, Item 1 (verify self-awareness draft — on `main`).
5. For each subsequent plan: checkout `main`, create feature branch, do the work, leave the branch.
6. Work down the list. Go as far as you can before the server or context runs out.
7. If you get stuck, leave clear notes in `.paloma/docs/` for the next session.

You've got this. The DNA is strong. The pipeline is real. Go make Paloma better.
