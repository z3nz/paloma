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
