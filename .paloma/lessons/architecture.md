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

### Lesson: Establish a single source of truth for rules
- **Context:** Before this work, the most correct rules lived in CLAUDE.md — a file that bridge-spawned pillars never see. base.js, phases.js, instructions.md, and CLAUDE.md all had overlapping rules that drifted. When rules changed in one place, they weren't updated everywhere.
- **Insight:** Having multiple files with the same rules creates a maintenance nightmare and guarantees drift. When the drift includes contradictions (file A says do X, file B says don't do X), the system behavior becomes unpredictable based on which file the session happened to prioritize.
- **Action:** Established a clear hierarchy: phases.js (pillar DNA, authoritative) → base.js (shared foundation) → instructions.md (project conventions) → CLAUDE.md (CLI pointer). Each file has a distinct role. Rules live in ONE place. CLAUDE.md no longer duplicates — it references. When a rule changes, it changes in the DNA and flows downward.
- **Applied:** YES — WU-3 started this (moved Flow content to phases.js), WU-4 will complete it (slim CLAUDE.md and instructions.md to remove duplication)
