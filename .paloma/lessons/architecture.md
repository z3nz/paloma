# Lessons: Architecture and System Design

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

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
