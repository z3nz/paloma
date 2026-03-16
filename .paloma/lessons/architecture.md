# Architecture Lessons

### Lesson: HMR state preservation is a symptom, not a solution
- **Context:** 10 composables had `window.__PALOMA_*__` singleton preservation to survive Vite HMR hot reloads. This was boilerplate in every file.
- **Insight:** HMR state tricks exist to paper over the fundamental problem: dev server restarts lose state. The real fix is to not rely on the dev server at all. Production builds + supervisor restarts = clean slate every time, no state to preserve.
- **Action:** When you see HMR preservation boilerplate accumulating, treat it as a signal that the serving strategy needs rethinking — not a reason to add more boilerplate.
- **Applied:** YES — removed all `window.__PALOMA_*__` from 7 composables and `import.meta.hot.accept()` from 3 more as part of the production supervisor migration.

### Lesson: Supervisor IPC is cleaner than HTTP endpoints for internal coordination
- **Context:** WU-3 needed the supervisor to query the bridge for active session count before triggering a restart. Options were HTTP endpoint, IPC message, or state file.
- **Insight:** IPC (`process.send()` / `process.on('message')`) between supervisor and bridge child process is the right tool here — zero port allocation, zero auth concerns, naturally scoped to the parent-child relationship. HTTP endpoints are for external consumers.
- **Action:** For internal process coordination between a supervisor and its managed child, prefer IPC over HTTP.
- **Applied:** YES — bridge/index.js uses IPC `idle_check` / `idle_status` / `prepare_restart` message types.

### Lesson: Graceful restart requires three phases: check → signal → wait
- **Context:** Supervisor needed to restart bridge without killing active pillar sessions.
- **Insight:** A clean graceful restart needs: (1) check if idle (retry up to N times with delay), (2) signal the child to wrap up and broadcast warning to clients, (3) wait for child exit before respawning. Skipping any phase causes either killed sessions or hung restarts.
- **Action:** Any future "graceful shutdown" pattern should follow this three-phase structure.
- **Applied:** YES — paloma-supervisor.js implements 10×30s idle polling (5 min grace), then `prepare_restart` IPC, then bridge exits with code 75.

### Lesson: Exit codes as semantic signals between supervisor and child
- **Context:** Supervisor needed to distinguish between "planned restart" (exit 75), "unexpected crash" (other non-zero), and "intentional shutdown" (exit 0).
- **Insight:** Exit codes are a clean, reliable signaling mechanism between processes. Using a specific code (75) for "supervisor-initiated restart" lets the supervisor know whether to rebuild + respawn, just respawn, or stop entirely.
- **Action:** When building supervisor/child process pairs, define a small exit code vocabulary upfront.
- **Applied:** YES — exit code 75 = supervisor restart (rebuild + respawn), 0 = clean exit (no respawn), other = crash (respawn after 1s, no rebuild).

### Lesson: Commit plan changes separately and first — always
- **Context:** This WU-5 delivery involved both plan updates and 10 code file changes.
- **Insight:** Plan diffs are large and semantically distinct from code changes. Mixing them into one commit makes `git log` harder to read and `git diff` harder to review. Committing plan first also establishes the "what was intended" before the "how it was done."
- **Action:** Always stage and commit `.paloma/plans/` changes in their own commit before code commits.
- **Applied:** N/A — awareness only (this is already documented in instructions.md, this lesson reinforces the why).
