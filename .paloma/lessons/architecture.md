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

---

### Lesson: Use a backends map for multi-backend abstraction
- **Context:** Adding Codex CLI required PillarManager to support two AI subprocess managers. The naive approach (branching everywhere on a `backend` field) would multiply with every new backend. The original design passed a single `cliManager` instance.
- **Insight:** A backends map (`{ claude: ClaudeCliManager, codex: CodexCliManager }`) is the clean pattern. PillarManager holds the map, resolves the correct manager per-session, and keeps a `this.cliManager = backends.claude` alias for code paths that always use Claude (Flow notifications). Backward compatibility is free — all existing `this.cliManager` references still work. Adding a third backend requires zero changes to PillarManager routing logic.
- **Action:** Applied to `bridge/pillar-manager.js`. Pattern: constructor accepts `backends` map, `session.backend` drives all routing, alias for always-Claude paths.
- **Applied:** YES — committed as 1643ce3

### Lesson: Don't normalize events when backends have distinct rendering needs
- **Context:** The chart plan called for normalizing all events to a common format (`cli_text`, `cli_done`, `cli_error`) to avoid backend branching in PillarManager. This would have required changing `claude-cli.js` event emission.
- **Insight:** Normalization adds complexity without enough benefit when the browser composable needs backend context anyway (Claude streams character-by-character; Codex emits complete blocks). The simpler approach: keep backend-specific event types (`codex_stream`/`claude_stream`, etc.), use boolean flags in `_handleCliEvent`. Zero risk of breaking existing rendering, zero changes to `claude-cli.js`.
- **Action:** Applied in `bridge/pillar-manager.js` and `src/composables/useMCP.js`. Boolean flags (`isStream`, `isDone`, `isError`) handle both backends cleanly.
- **Applied:** YES — committed as 1643ce3

### Lesson: Subprocess CLI session IDs may be async — design for it
- **Context:** Claude CLI returns a session ID synchronously on spawn. Codex generates thread IDs server-side, emitting them via a `thread.started` JSONL event asynchronously after the process starts.
- **Insight:** Don't assume subprocess session IDs are available synchronously. For Codex, `session.cliSessionId` must be updated from the `done` event (which carries the threadId captured from the async event). Future CLI integrations should follow this pattern.
- **Action:** Pattern codified in `bridge/codex-cli.js`. PillarManager updates `session.cliSessionId` from `event.sessionId` on the done event.
- **Applied:** YES — committed as 1643ce3

### Lesson: System prompt injection when CLI lacks --append-system-prompt
- **Context:** Claude CLI has `--append-system-prompt` for injecting multi-KB system prompts. Codex CLI has no equivalent. Options: `-c` config flag (shell escaping nightmare), temp TOML config file (complex, unverified), XML prompt prepending.
- **Insight:** Prepending with XML delimiters (`<SYSTEM_INSTRUCTIONS>...\n\n{prompt}`) is the most reliable approach with `spawn()`. No shell escaping issues (string goes directly to child process), GPT models respect XML-delimited boundaries, and it works for arbitrarily large prompts. Only inject on new sessions (not resumes) to avoid doubling instructions.
- **Action:** Applied in `bridge/codex-cli.js`. Pattern: `if (systemPrompt && !sessionId) { fullPrompt = '<SYSTEM_INSTRUCTIONS>\n...\n</SYSTEM_INSTRUCTIONS>\n\n' + prompt }`.
- **Applied:** YES — committed as 1643ce3

### Lesson: Phase 3 (per-pillar config) can ship with Phase 2 when it's trivial
- **Context:** The plan separated Phase 2 (subprocess backend) and Phase 3 (per-pillar config) as distinct Forge sessions. In practice, Phase 3 was a one-liner in `_defaultModel()` and a one-line DNA update.
- **Insight:** When a planned phase turns out to be trivially small (< 5 lines), fold it into the current commit rather than creating overhead for a separate session. Plans should be treated as guides, not rigid contracts.
- **Action:** Awareness only — no code change needed.
- **Applied:** N/A — awareness only

---

### Lesson: OAuth2 Desktop App pattern for MCP servers needing external API auth
- **Context:** Gmail MCP server needed OAuth2 auth against the Gmail API without a public HTTPS redirect URI. Desktop App flow supports `localhost` as the redirect target.
- **Insight:** The pattern: (1) Store credentials in `~/.paloma/{service}-oauth-keys.json`, tokens in `~/.paloma/{service}-tokens.json` — outside the repo, never committed. (2) CLI subcommand (`node server.js auth`) starts an ephemeral HTTP server on a fixed port, opens the browser best-effort via `exec()` with platform detection, saves the tokens on callback, exits. (3) Use `prompt: 'consent'` to always get a `refresh_token` — without it, Google only provides one on first authorization, so token file loss requires manual revocation. (4) Register a `oauth2Client.on('tokens', ...)` handler to persist refreshed tokens automatically. This pattern is reusable for any Google API (Calendar, Drive, Sheets) with zero structural changes.
- **Action:** Pattern codified in `mcp-servers/gmail.js`. Reuse for future Google API MCP servers.
- **Applied:** YES — committed as 0b8f9a3

### Lesson: Poll+snapshot pattern for detecting new items in a mutable collection
- **Context:** `email_wait` needs to block until a new message appears in a Gmail thread. Push/webhooks require a public HTTPS server — impractical in WSL2 dev. Polling was the right choice, but the naive approach (comparing message count) is fragile if messages are deleted.
- **Insight:** The snapshot pattern: (1) On first poll, capture all known item IDs into a Set (`knownIds`). (2) On each subsequent poll, fetch current IDs and find any NOT in `knownIds` via `filter`. (3) New items found → fetch full content → return. This is robust against deletions, reordering, or pre-existing items in the collection. The Set lookup is O(1) per item. This pattern generalizes to any "wait for new item" problem (Slack messages, GitHub PR comments, etc.).
- **Action:** Applied in `handleWait()` in `mcp-servers/gmail.js`. Use this pattern whenever building a polling wait tool.
- **Applied:** YES — committed as 0b8f9a3

---

### Lesson: Python warnings on stderr cause false failures in Node MCP servers
- **Context:** `mcp__paloma__voice__speak` was reporting "Speech failed" errors even when audio was playing correctly. The 30s fixed timeout was also too short for longer text. Root cause: Python's torch and HuggingFace libraries emit `UserWarning` and `FutureWarning` messages to stderr on startup. The Node MCP server checked `exit code !== 0` as the failure indicator and included `stderr` content in its error message — so warnings looked like failures.
- **Insight:** Python ML libraries (torch, transformers, huggingface_hub) routinely emit deprecation and performance warnings to stderr. These aren't errors — they're informational noise. Any Node process that spawns Python and treats stderr as an error signal will have false positives. Two-part fix: (1) Suppress at source — call `warnings.filterwarnings('ignore', ...)` BEFORE any torch/HF imports in the Python script. (2) Filter known patterns in the Node error handler — parse stderr line by line and discard lines matching known warning signatures before reporting as an error. Both layers are needed: suppression at source handles clean runs; Node-side filtering handles anything that slips through.
- **Action:** For any Python subprocess called from Node that uses torch/HF: (1) Add `import warnings; warnings.filterwarnings('ignore', category=UserWarning); warnings.filterwarnings('ignore', category=FutureWarning)` at the TOP of the Python file, before all other imports. (2) In the Node caller's `close` handler, filter stderr through a deny-list of known warning patterns before treating stderr as an error. (3) Scale the timeout proportionally to input size (see timeout lesson below).
- **Applied:** YES — both fixes applied in `mcp-servers/voice-speak.py` (suppress at source) and `mcp-servers/voice.js` (filter + dynamic timeout)

---

### Lesson: Scale subprocess timeouts proportionally to input size
- **Context:** The voice TTS server had a fixed 30s timeout for all speech. Short text ("Done, sir.") would finish in 3s. Long text (a paragraph-length explanation) could legitimately take 45s+. The fixed timeout caused intermittent failures on longer speech that had nothing to do with actual errors.
- **Insight:** Fixed timeouts are appropriate only when execution time is independent of input. When execution time scales with input (TTS synthesis, file transcoding, embedding generation, chunked LLM inference), the timeout must scale too. The formula: `base_timeout + (input_size / processing_unit) * time_per_unit`. For TTS: `30_000 + Math.ceil(text.length / 100) * 2000` — 30s base, ~2s per 100 characters. This is conservative; real synthesis is faster, but generous is better than tight for background audio work.
- **Action:** When a subprocess takes variable time: (1) Measure typical performance at different input sizes. (2) Define a base timeout (handles startup + fixed overhead). (3) Add a scaling term proportional to input size. (4) Make the formula a named constant or comment so it's obvious why it's not a round number.
- **Applied:** YES — `mcp-servers/voice.js` now uses `const timeoutMs = 30_000 + Math.ceil(text.length / 100) * 2000`

---

### Lesson: Establish a single source of truth for rules
- **Context:** Before this work, the most correct rules lived in CLAUDE.md — a file that bridge-spawned pillars never see. base.js, phases.js, instructions.md, and CLAUDE.md all had overlapping rules that drifted. When rules changed in one place, they weren't updated everywhere.
- **Insight:** Having multiple files with the same rules creates a maintenance nightmare and guarantees drift. When the drift includes contradictions (file A says do X, file B says don't do X), the system behavior becomes unpredictable based on which file the session happened to prioritize.
- **Action:** Established a clear hierarchy: phases.js (pillar DNA, authoritative) → base.js (shared foundation) → instructions.md (project conventions) → CLAUDE.md (CLI pointer). Each file has a distinct role. Rules live in ONE place. CLAUDE.md no longer duplicates — it references. When a rule changes, it changes in the DNA and flows downward.
- **Applied:** YES — WU-3 started this (moved Flow content to phases.js), WU-4 will complete it (slim CLAUDE.md and instructions.md to remove duplication)

---

### Lesson: Use balanced-brace extraction, not regex, to parse JSON in model text
- **Context:** Ollama models writing tool calls as text instead of using native `tool_calls` API. The original parser used a regex (`/\{[^{}]*"name"...[^{}]*\}/g`) which silently failed on any tool call with nested JSON arguments — which is virtually all real tool calls.
- **Insight:** `[^{}]*` is fundamentally broken for matching JSON — it stops at the first nested brace. The correct approach is character-by-character balanced-brace counting: walk the text, track depth, handle quoted strings and escape sequences, extract the complete JSON substring when depth returns to 0, then try `JSON.parse()`. This handles arbitrary nesting, multi-line JSON, and code fences (strip them before scanning). The extractor returns `{ parsed, raw }` pairs — the `raw` string is needed for text stripping too. Any time you need to extract JSON from unstructured text (LLM output, log scraping, config detection), this is the pattern.
- **Action:** Applied as `_extractJsonObjects(text)` in `bridge/ollama-manager.js`. Copy this pattern any time JSON needs to be extracted from freeform text.
- **Applied:** YES — committed as 97cd5f7

### Lesson: Always strip tool call JSON from text content, even when native tool_calls succeed
- **Context:** Ollama models sometimes return both native `tool_calls` (which execute correctly) AND write the JSON as text in the response content. Without stripping, the raw JSON appears in chat alongside the proper tool result — double display of the same action.
- **Insight:** When processing LLM responses that include tool calls, the text content path and the tool execution path are NOT mutually exclusive. A model can populate both simultaneously. Always sanitize `fullAssistantText` before sending it to the frontend: run the JSON extractor on the text, remove any matches, strip leftover code fence markers, trim whitespace. This applies to BOTH the native tool_calls path and the text-parsed fallback path — two separate locations that need the same treatment.
- **Action:** Applied in both branches of `_streamChat()` in `bridge/ollama-manager.js`. When adding future LLM backends, include this stripping step in both tool-call execution paths.
- **Applied:** YES — committed as 97cd5f7

---

### Lesson: Self-contained autonomous service pattern for EmailWatcher
- **Context:** Email auto-response timeout system needed to track sessions, set retry timers, check Gmail reply status, and spawn retry sessions — all without touching any other bridge file.
- **Insight:** EmailWatcher already owned its own `this.gmail` client, `this.cliManager` reference, and `this.broadcast` callback. Adding a `this.threadTracker` Map and inline Gmail API check (`_isThreadReplied` using `this.gmail.users.threads.get` with `format: 'metadata'`) kept everything self-contained. `index.js` only calls `start()` and `shutdown()` — it never needs to know about retry logic. This pattern works because the service already owns all its dependencies. When extending a service class: always check what `this` already owns before reaching outside.
- **Action:** Pattern for `bridge/email-watcher.js`. Reuse: any autonomous long-running service should own its timer management and cleanup in `shutdown()`. Never leak timers.
- **Applied:** N/A — awareness only (no structural change needed)

### Lesson: OAuth token refresh must be persisted to disk for long-running Node processes
- **Context:** `email-watcher.js` used the Gmail OAuth2 client but didn't register a `tokens` event handler. When the access token expired and the client auto-refreshed it, the new token was held only in memory. On next bridge restart, the stale token on disk caused silent auth failures.
- **Insight:** `google-auth-library`'s `OAuth2Client` emits a `tokens` event whenever it obtains a new access token. If you don't listen for it and write the new tokens to disk, the refresh only lasts until the process exits. For any Google API client used in a long-running process: register `oauth2Client.on('tokens', newTokens => { /* merge + write to disk */ })` at initialization. The merge matters: the refresh event only includes the new `access_token` and `expiry_date`, not the `refresh_token` — always spread existing tokens first.
- **Action:** Applied in `bridge/email-watcher.js` as part of commit `46632d2`. Pattern: `oauth2Client.on('tokens', newTokens => { tokens = { ...tokens, ...newTokens }; fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens)) })`.
- **Applied:** YES — committed as 46632d2

---

### Lesson: FIFO spawn queue requires a dequeue trigger at every slot-freeing event
- **Context:** WU-4 of Qwen Recursive Singularity added a spawn queue so Ollama sessions queue instead of being rejected when `MAX_CONCURRENT_OLLAMA` (4) is hit.
- **Insight:** A FIFO queue is only as good as its dequeue triggers. A slot frees whenever a session ends — by any means. Miss one and the queue stalls silently. The complete set of triggers in `bridge/pillar-manager.js`: (1) `stop()` — explicit stop, (2) `stopTree()` — recursive stop, (3) `isDone` in `_handleCliEvent` — natural completion, (4) `isError` in `_handleCliEvent` — error exit. And a 5th, subtler trigger: (5) when a parent session registers a pending-child Promise and the child's spawn returned `status: 'queued'` — the parent is now blocked and no longer consuming inference capacity, so its slot effectively frees and dequeue runs immediately. Without trigger 5, the parent-waits-on-queued-child scenario stalls until another unrelated session finishes. When adding any code path that terminates OR blocks a session, ask: does this free a slot? If yes, call `_dequeueOllamaSpawns()`.
- **Action:** In `bridge/pillar-manager.js`. Enumerate all slot-freeing events at design time when building any concurrency-limited queue.
- **Applied:** YES — committed as 86b46a2

### Lesson: Prevent concurrency deadlock by excluding blocked parents from the active count
- **Context:** Recursive Ollama spawning: parent P spawns child C, then awaits C's output via a Promise in `_pendingChildCompletions`. If P holds a concurrency slot while waiting and the limit is full, C can never start — classic deadlock.
- **Insight:** The fix is in `_countActiveOllamaSessions()`. It walks `_pendingChildCompletions`, finds each pending child's `parentPillarId`, and adds those parents to a `waitingParents` Set. The count loop skips sessions in `waitingParents`. A waiting parent holds no active inference capacity — it's blocked on I/O — so excluding it is semantically correct. The invariant: the active count represents sessions actively consuming inference capacity, not sessions that merely exist. Generalizes: for any concurrency-limited resource, distinguish "consuming the resource" from "holding a slot while blocked on something else."
- **Action:** In `bridge/pillar-manager.js`, `_countActiveOllamaSessions()`. Reuse this pattern whenever building concurrency limits on async recursive work.
- **Applied:** YES — committed as 86b46a2

### Lesson: Create placeholder session records before async work for immediate visibility
- **Context:** When a spawn is queued, there's a gap between "session requested" and "session starts." Without a record in `this.pillars`, that session is invisible to `list()` and `getStatus()` until it dequeues.
- **Insight:** `_enqueueSpawn()` immediately creates a full session object in `this.pillars` with `status: 'queued'` and `queuePosition`, and broadcasts `pillar_queued` to the browser. When `_executeSpawn()` later runs, it upgrades the placeholder in-place. The `pillarId` is reserved at enqueue time, not execution time — so the session is observable, stoppable, and reportable from the moment it's requested. `stop()` handles queued sessions by removing them from the queue; `sendMessage()` rejects them gracefully. Queued sessions are first-class citizens.
- **Action:** Pattern for any async resource allocation: create the record immediately with a pending status, upgrade in-place when the resource is granted. Avoids phantom sessions and gives real-time queue visibility.
- **Applied:** YES — committed as 86b46a2

### Lesson: Pre-clear shared state at the top of a tree-kill operation (Polish observation)
- **Context:** `stopTree()` deletes `_pendingChildCompletions` entries for descendants before stopping each session. If a child's `stop()` also tries to resolve the pending completion in its cleanup path, there's a theoretical race where the resolve fires after `stopTree()` already removed it.
- **Insight:** No data corruption occurs (the Map entry is already gone, so the resolve is a no-op). But pre-clearing all entries at the top of `stopTree()` — before the stop loop begins — makes intent explicit: "this tree is being destroyed, no completions should fire." The general rule: in a tree-kill operation, invalidate all shared state first, then destroy nodes.
- **Action:** Future improvement in `bridge/pillar-manager.js`: move all `_pendingChildCompletions.delete()` calls to the top of `stopTree()` before the stop loop. Low priority; current behavior is correct.
- **Applied:** NO — proposed for future improvement

---

### Lesson: Separate personal/business tools from Paloma's core repo
- **Context:** Adam requested a social media cross-posting tool. Rather than adding it to `mcp-servers/` inside Paloma's repo, he established a clear boundary: tools built *for Adam* (not for Paloma herself) live in `projects/` with their own git repos.
- **Insight:** Two categories of MCP servers exist: (1) **Paloma-native** — tools that make Paloma work (filesystem, git, voice, memory, gmail, etc.) → live in `mcp-servers/`, version-controlled with Paloma. (2) **Personal/business tools** — tools built for Adam's specific needs that happen to be exposed as MCP servers → live in `projects/{name}/` with their own git repos, gitignored from Paloma's repo. This separation means personal tools can be open-sourced independently, don't bloat Paloma's repo, and have their own commit history. The `projects/` directory is already gitignored.
- **Action:** When building a new tool, ask: "Is this making Paloma work, or is this a tool for Adam?" Paloma-native → `mcp-servers/`. Personal/business → `projects/`. Always init a separate git repo for projects/ tools.
- **Applied:** YES — established as permanent architecture principle

---

### Lesson: Promises awaiting child session completion need timeout + settlement guard
- **Context:** In the recursive Qwen architecture, a parent Ollama session spawns a child and blocks on a Promise awaiting the child's completion. The resolve function is stored in a Map (`_pendingChildCompletions`). If the child crashes without emitting a done event, the parent hangs forever.
- **Insight:** Any Promise that awaits an external subprocess completion needs: (1) A timeout that rejects after a reasonable duration (35 minutes — slightly longer than the session's own MAX_RUNTIME_MS). (2) A settlement flag (`let settled = false`) to prevent race conditions where both the timeout and the child completion fire in close succession. (3) Resolution in the `stop()` method — when a child is force-stopped, the parent must unblock. Without these three safeguards, parent sessions can hang indefinitely.
- **Action:** Applied in `bridge/pillar-manager.js`. Pattern: Promise wraps timeout + settlement flag, `_pendingChildCompletions` resolves in both `_handleCliEvent` (normal completion) and `stop()` (force stop).
- **Applied:** YES — committed as 06ad59c

### Lesson: Set cooldowns AFTER successful send, not before
- **Context:** Notification cooldown (`notificationCooldown.set(pillarId, now)`) was called before `_sendFlowNotification()`. If the send failed (e.g. WebSocket closed), the pillarId was still marked as "recently notified" and blocked for 5 seconds — silently dropping the notification with no retry.
- **Insight:** Rate-limiting/cooldown timestamps should be set AFTER the action succeeds, not before. Setting before means a failure counts as "done" and prevents retry. This applies to any cooldown/dedup mechanism: email dedup, API rate limiting, event debouncing. The general rule: record "last sent" only when you've confirmed the send worked.
- **Action:** Moved `notificationCooldown.set(pillarId, now)` from before the send to after `_sendFlowNotification()`.
- **Applied:** YES — committed as 06ad59c

### Lesson: Wrap CLI-first scripts as MCP tools via subprocess, not imports
- **Context:** `mcp-servers/ollama-eval.js` needed to expose `runner.js`, `reporter.js`, and `prompt-engine.js` as MCP tools. Those scripts auto-execute `main()` on module load — importing them would trigger CLI behavior immediately.
- **Insight:** When a script calls `main()` at module level (common pattern for CLI tools), it cannot be imported as a library without side effects. The correct pattern is to spawn it as a child process via `child_process.spawn` with `stdio: 'pipe'`, collect stdout/stderr, and return the output as the tool result. This converts any CLI-first script into an MCP tool with zero refactoring of the original script. The subprocess boundary also enforces timeout control cleanly via `AbortController`.
- **Action:** Use `spawn(process.execPath, [scriptPath, ...args], { stdio: 'pipe' })` pattern in MCP servers wrapping CLI scripts. This is the canonical approach for `mcp-servers/` wrapping `scripts/`.
- **Applied:** YES — committed as cef0646

### Lesson: Keep MCP servers self-contained — inline shared constants instead of cross-directory imports
- **Context:** `ollama-eval.js` needed the same path constants and JSONL utilities as the scripts it wraps. The temptation was to import from `scripts/ollama-eval/utils.js`.
- **Insight:** MCP servers that import from sibling directories create deployment coupling — if path layouts change or the server is moved, imports break. Inlining small constants (5–10 lines) and simple utilities (JSONL line counter) keeps the server fully self-contained. This matches the pattern of `memory.js` and `ollama.js`. The rule: if the shared code is under ~20 lines and only needed in one MCP server, inline it. Only create a shared module if 3+ servers need the same logic.
- **Action:** Default to self-contained MCP servers. If genuinely shared logic grows beyond ~20 lines across multiple servers, extract to `mcp-servers/shared/`.
- **Applied:** YES — committed as cef0646

---

### Lesson: NEVER spawn AI agents from SessionStart hooks — recursive process bomb (CRITICAL)
- **Context:** On 2026-03-18, `scripts/paloma-sync.sh` was registered as a SessionStart hook in `.claude/settings.json`. When it detected git merge conflicts, it spawned `claude -p --model sonnet` to auto-resolve them. That spawned Claude session also triggered the SessionStart hook, which detected the same unmerged files, spawned another `claude -p`, and so on — creating an infinite recursive process bomb. 78 sessions were spawned before the system became unresponsive and had to be manually recovered.
- **Insight:** SessionStart hooks run on EVERY new Claude session, including sessions spawned by `claude -p` (pipe mode). Any hook that can spawn a new Claude process creates an infinite recursion risk. The specific chain: hook → script → detects conflict → `claude -p` → hook → script → same conflict → `claude -p` → ... forever. Contributing factors: (1) No recursion guard or lock file. (2) Pre-existing merge conflict from a stash pop guaranteed the "auto-resolve" branch always triggered. (3) `Bash(claude:*)` permission allowed recursive spawns without user confirmation.
- **Action:** Three iron rules for hooks: (1) NEVER spawn `claude`, `codex`, `copilot`, or any AI CLI agent from a SessionStart hook — this is the direct cause of recursive bombs. (2) All hook scripts MUST have a recursion guard (environment variable check + lock file). (3) Hook scripts should be fast, safe, and non-interactive — fetch + fast-forward only, abort on conflicts. The sync script was rewritten to follow these rules.
- **Applied:** YES — `scripts/paloma-sync.sh` rewritten with recursion guards, lock file, and NO AI agent spawning. `.claude/settings.json` hook removed.

---

### Lesson: System prompt size MUST stay under 128KB — Linux MAX_ARG_STRLEN limit (CRITICAL)
- **Context:** On 2026-03-18, Paloma became completely non-functional. Every attempt to start a Claude CLI session via the bridge failed with `spawn E2BIG`. The system prompt passed via `--append-system-prompt` CLI argument had grown to ~136KB — exceeding Linux's 128KB per-argument limit (`MAX_ARG_STRLEN = PAGE_SIZE * 32 = 131072 bytes`). This happened because the system prompt included content already provided by CLAUDE.md via `@` references: `.paloma/instructions.md` (13.5KB) and all 8 root files (~29KB) were duplicated. Combined with 5 active plan files (~74KB), BASE_INSTRUCTIONS (~12KB), and phase instructions (~7KB), the total crossed the threshold. The system was completely unusable until this was diagnosed and fixed.
- **Insight:** Linux's `execve` syscall enforces `MAX_ARG_STRLEN` (128KB) on EACH individual argument, separate from the total `ARG_MAX` limit (which is ~2-3MB). The system prompt is a single `--append-system-prompt` argument, so it must fit in 128KB. Three rules: (1) **Never duplicate content between CLAUDE.md and --append-system-prompt.** Claude CLI reads CLAUDE.md automatically — roots and instructions are already loaded via `@` references. (2) **Active plans are the variable-size risk.** They're the only dynamic content not in CLAUDE.md. With 5 plans at ~74KB, that's already over half the budget. (3) **Monitor the size.** `claude-cli.js` now logs a warning when the system prompt exceeds 120KB. If you see this warning, archive stale active plans.
- **Action:** Three changes applied: (1) `src/composables/useSystemPrompt.js` — removed roots and projectInstructions from `buildSystemPrompt()`. (2) `bridge/pillar-manager.js` — `_buildSystemPrompt()` skips roots and instructions for Claude backend (keeps them for Ollama/Codex/Copilot which don't have CLAUDE.md). (3) `bridge/claude-cli.js` — added size check with warning at 120KB threshold. Result: system prompt dropped from ~136KB to ~95KB with 33KB headroom.
- **Applied:** YES — committed as part of the E2BIG fix on 2026-03-18.

### Lesson: Express 5 / path-to-regexp v8+ breaks bare wildcard routes
- **Context:** `scripts/static-server.js` SPA fallback route `app.get('*', ...)` crashed with `PathError: Missing parameter name at index 1` after an Express/dependency update.
- **Insight:** Express 5 uses `path-to-regexp` v8+ which requires named parameters for wildcards. The old `'*'` syntax is no longer valid. Use `'/{*splat}'` instead (named wildcard parameter). This applies to any Express route using `*` — check all routes when upgrading Express.
- **Action:** Replace `app.get('*', ...)` with `app.get('/{*splat}', ...)` in any Express 5+ app.
- **Applied:** YES — fixed in `scripts/static-server.js`.

---

### Lesson: Per-session temp directory pattern for backends that lack --mcp-config
- **Context:** Gemini CLI has no `--mcp-config` flag (unlike Claude/Copilot). MCP config must live in `.gemini/settings.json` relative to the process cwd. Gemini also uses `GEMINI_SYSTEM_MD` env var pointing to a file path — not an inline string flag — for its system prompt. Both constraints require writable temp files per session.
- **Insight:** Bundle BOTH temp needs into a single per-session directory: `/tmp/paloma-gemini-{requestId}/` containing `.gemini/settings.json` (MCP config) and `system-prompt.md` (system prompt). Use that directory as the process `cwd`. Point `--include-directories` at the actual project root so Gemini still has workspace file context. Cleanup: `rmSync(sessionDir, { recursive: true, force: true })` in close/stop/error handlers. One `rm -rf` covers everything. This pattern will apply to any future CLI backend that stores config in cwd-relative files rather than accepting flags.
- **Action:** Applied in `bridge/gemini-cli.js`. Reuse this pattern for any CLI backend that requires cwd-relative config files instead of explicit flag paths.
- **Applied:** YES — committed as f19bee1

### Lesson: GEMINI_SYSTEM_MD replaces the system prompt — not appends — design accordingly
- **Context:** Claude CLI's `--append-system-prompt` adds to the built-in system prompt. Gemini's `GEMINI_SYSTEM_MD` env var fully REPLACES it. Gemini's built-in prompt includes interactive terminal conventions that conflict with Paloma's pillar behavior.
- **Insight:** When a CLI backend replaces rather than appends the system prompt, you lose the model's baseline defaults but gain a clean slate. For Paloma this is an advantage — include only Paloma pillar instructions, no need to prepend Gemini's defaults. The model is capable of tool calling without them. If behavior is broken, prepend extracted defaults (`GEMINI_WRITE_SYSTEM_MD=1 gemini` exports them). Default to clean-slate; add base prompt only if needed.
- **Action:** For any new CLI backend: check whether its system prompt mechanism replaces or appends, then decide whether to include the model's defaults. Start simple.
- **Applied:** YES — established as design decision AD-2. `bridge/gemini-cli.js` uses GEMINI_SYSTEM_MD pointing to Paloma instructions only.

### Lesson: CLI session IDs may be pre-generated, async-event, or done-event — design for whichever
- **Context:** Claude CLI accepts `--session-id` (pre-generated UUID). Codex assigns a thread ID server-side, emitted via `thread.started` JSONL. Gemini assigns its own session ID returned in an `init` JSONL event. Three different patterns across three backends.
- **Insight:** Don't assume you control session ID assignment. When a CLI assigns its own IDs: start with `null` sessionId in the process map, watch for the init event, update in-place, include in the `done` payload so PillarManager can store it for `--resume`. The general rule: document which pattern a CLI uses before writing the manager. The three patterns are: (1) sync pre-generated (Claude), (2) async init event (Gemini), (3) async done event (Codex).
- **Action:** Pattern captured in `bridge/gemini-cli.js` (async init event). When adding future CLI backends, identify which pattern applies first.
- **Applied:** YES — committed as f19bee1
