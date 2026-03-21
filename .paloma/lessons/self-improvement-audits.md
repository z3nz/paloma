# Self-Improvement Audit Lessons

### Lesson: `startsWith()` path validation is a classic traversal vulnerability
- **Context:** `exec.js`, `fs-extra.js`, and `web.js` all used `path.startsWith('/home/adam')` for access control. This matches `/home/adamsmith/...` — a textbook path traversal bypass.
- **Insight:** String prefix matching for path validation MUST include the trailing separator. `startsWith('/home/adam/')` is safe; `startsWith('/home/adam')` is not. This is a well-known vulnerability class but easy to miss in code review because it "looks right."
- **Action:** Any path validation using `startsWith()` must append `/` to the allowed prefix (or use exact match for the prefix itself). Grep for `startsWith` in security-sensitive code during audits.
- **Applied:** YES — fixed in all 3 MCP servers (exec.js, fs-extra.js, web.js) to require exact match OR trailing `/`.

### Lesson: highlight.js full import adds ~940KB to bundle — tree-shake it
- **Context:** `src/utils/highlight.js` imported `import hljs from 'highlight.js'` which pulls in all 190+ language grammars. The highlight chunk was 940KB (312KB gzipped).
- **Insight:** Import `highlight.js/lib/core` and register only the languages you need. For a coding assistant, ~30 languages covers 99% of use cases. This cut the chunk from 940KB to 21KB (8KB gzipped) — a 97% reduction.
- **Action:** Never import highlight.js (or similar grammar-heavy libraries) as a full bundle. Always use the core + selective registration pattern. Check bundle size after changes with `npx vite build`.
- **Applied:** YES — created shared singleton in `src/utils/highlight.js` with 30 registered languages.

### Lesson: Module-level singletons in Vue composables can create O(n²) reactivity
- **Context:** `useCostTracking()` returned fresh `computed()` properties on every call. Since `MessageItem.vue` called it per-message, a chat with 100 messages created 100 identical computed watchers, each iterating all messages — O(n²).
- **Insight:** Vue composables that return computed properties derived from global state should hoist those computeds to module scope (singleton pattern). Only return the pre-computed refs, never create new `computed()` inside the function body if the function is called per-component.
- **Action:** When a composable is called from a list-rendered component, audit whether it creates new reactive state per call. If yes, hoist to module scope.
- **Applied:** YES — `useCostTracking` now creates `sessionCost` and `sessionTokens` computeds once at module level.

### Lesson: `execSync` in hot paths blocks the event loop for ALL connections
- **Context:** `copilot-cli.js` called `execSync('gh auth token')` inside `chat()` — every new Copilot session blocked the entire bridge event loop while shelling out to `gh`.
- **Insight:** Any `execSync` call in a WebSocket server's request path blocks ALL connected clients, not just the requesting one. Even if the call is fast (50ms), it's unacceptable in a server handling real-time streaming. Cache results or use async alternatives.
- **Action:** Grep for `execSync` in bridge code during audits. Move to `execFile` (async) or cache results at construction time. The `_warmAuth()` pattern (async call at construction, cache the result) works well.
- **Applied:** YES — replaced `execSync('gh auth token')` with async `_warmAuth()` at CopilotCliManager construction.

### Lesson: Dead code accumulates silently — periodic audits catch it
- **Context:** Found 6+ dead computed properties, 1 unused component (`ToolActivity.vue`), 1 unused Map (`flowSessions`), and duplicated utility functions — all invisible to normal development because they cause no errors.
- **Insight:** Dead code doesn't break anything, so it never gets flagged in normal workflows. It accumulates over refactors when old code is replaced but not removed. Periodic self-audits (reading every file, checking references) are the only way to catch it.
- **Action:** Schedule periodic codebase audits. Focus on: unused imports, unreferenced computed properties, components that are defined but never mounted, Map/Set fields that are written but never read.
- **Applied:** YES — removed `consumedToolIds` (MessageList), `formatArgs`/`truncatedResult`/`expanded` (MessageItem), `flowSessions` (PillarManager), `ToolActivity.vue`.

### Lesson: Gmail OAuth client should be cached, not recreated per-call
- **Context:** `mcp-servers/gmail.js` `ensureAuth()` was reading the token file from disk and constructing a new OAuth2 client on every single MCP tool call.
- **Insight:** OAuth clients are stateless after construction — the token doesn't change between calls. Reading the token file synchronously on every call adds unnecessary I/O and latency, especially when tools are called in rapid succession (e.g., email_list → email_read × N).
- **Action:** Cache the authenticated client after first construction. Only re-read the token file if the cached client fails with an auth error.
- **Applied:** YES — `ensureAuth()` now returns cached client on subsequent calls.

### Lesson: Backdrop clicks on confirmation modals are a UX hazard
- **Context:** `ToolConfirmation.vue` treated backdrop clicks as "deny" — same as clicking the deny button. Accidental clicks while the AI was streaming would kill the active tool call with no undo.
- **Insight:** When the deny/cancel action is destructive (kills an active stream, deletes data), backdrop clicks should NOT trigger it. The cost of an accidental deny is much higher than the convenience of dismissing by clicking outside. Only use backdrop-dismiss for non-destructive modals (info dialogs, settings).
- **Action:** For any modal where the dismiss action has side effects beyond closing the modal, disable backdrop click handling. Require explicit button clicks.
- **Applied:** YES — removed `@click.self="deny"` from ToolConfirmation.vue overlay.

### Lesson: Self-improvement audits are high-value, low-risk work
- **Context:** A single self-improvement session found ~30 issues across security (path traversal), performance (940KB bundle, O(n²) reactivity, blocking execSync), data integrity (race conditions in memory writes), and UX (accidental stream kills).
- **Insight:** Codebase self-audits have exceptional ROI. They find issues that normal feature development never surfaces because the issues don't cause visible failures — they're silent performance drains, latent security holes, or subtle UX hazards. The audit mindset (read every line, question every assumption) is fundamentally different from the build mindset.
- **Action:** Periodic self-improvement sessions should be a regular practice, not just when things feel wrong. Target: once per major feature cycle or weekly, whichever comes first.
- **Applied:** N/A — awareness for future planning.
