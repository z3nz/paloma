# Plan: Project Context Switching & OpenRouter Independence

**Status:** draft
**Created:** 2026-02-13
**Scope:** paloma
**Impact:** Major — touches ~20 files across services, composables, and components

## The Vision

Paloma starts instantly. No API key required. No project folder required. Just open the app and start talking. Projects become attachable contexts (`/project fadden`) that load plans, conventions, and settings on demand. OpenRouter becomes an optional enhancement for users who want access to non-Claude models, not a gate to entry.

---

## Architecture Change Summary

### Before (Current)
```
Start → Need API key? → Need project folder? → Can chat
                ↓ no              ↓ no
           WelcomeScreen    WelcomeScreen Step 2
```
- OpenRouter API key is required to proceed past WelcomeScreen
- Project folder (dirHandle) is required before chatting
- One project at a time, selected via browser directory picker
- Two chat paths: OpenRouter (browser-side tool loop) and CLI (bridge subprocess)
- Browser-side file tools require dirHandle

### After (Target)
```
Start → Connect to bridge → Can chat (CLI path, MCP tools)
         Optional: Add OpenRouter key for more models
         Optional: /project fadden to attach context
```
- Bridge connection is the only requirement
- CLI path is the default — Paloma's identity, MCP tools, full capability
- OpenRouter is opt-in — adds model variety but isn't needed
- Projects are contexts that can be attached/detached mid-conversation
- All file operations go through MCP (server-side), not browser File System Access API

---

## Phase 1: Remove OpenRouter as a Requirement

### Goal
App boots directly to chat interface using CLI models. OpenRouter API key is optional (configurable in settings, enables additional models).

### Files to Change

#### `src/components/welcome/WelcomeScreen.vue` — MAJOR REWRITE
- **Current:** Two-step gate (API key → project folder)
- **Target:** Replace with a simple "connecting to bridge" state, or remove entirely
- Auto-connect to bridge on startup (already partially supported via `autoConnect`)
- If bridge is connected, go straight to chat
- If bridge is not available, show helpful setup instructions

#### `src/App.vue` — MODERATE CHANGES
- **Current:** Shows WelcomeScreen if no API key OR no dirHandle
- **Target:** Shows chat interface immediately if bridge connects
- Remove `apiKey` from the WelcomeScreen gate condition
- Remove `dirHandle` from the WelcomeScreen gate condition
- Auto-connect MCP bridge on mount (before anything else)
- Project opening becomes optional (via `/project` command or settings)

#### `src/composables/useSettings.js` — MINOR CHANGES
- **Current:** `apiKey` defaults empty, `defaultModel` defaults to `'anthropic/claude-sonnet-4'` (OpenRouter model)
- **Target:** `defaultModel` defaults to `'claude-cli:sonnet'` (CLI model)
- `apiKey` remains but is optional — empty means OpenRouter unavailable
- Add `defaultCliModel` preference if needed

#### `src/components/prompt/ModelSelector.vue` — MODERATE CHANGES
- **Current:** Three sections: Paloma CLI, Claude Code Direct, OpenRouter
- **Target:** Same three sections, but OpenRouter section hidden when no API key
- CLI models always visible and usable
- When no API key, default selection is a CLI model
- No broken state — you can always chat

#### `src/composables/useChat.js` — MODERATE CHANGES
- **Current:** `sendMessage()` takes `apiKey` as parameter, routes based on `isCliModel(model)`
- **Target:** `apiKey` becomes optional. If model is CLI, apiKey is irrelevant (already true, just make explicit)
- Guard the OpenRouter path: if `!isCliModel(model) && !apiKey`, show error "Configure OpenRouter API key in settings to use this model"
- `checkContextUsage()` already handles CLI models — verify it works when `useOpenRouter().getModelInfo()` has no models loaded

#### `src/composables/useOpenRouter.js` — MINOR CHANGES
- **Current:** `loadModels(apiKey)` fetches model list
- **Target:** `loadModels()` becomes a no-op when apiKey is empty. `models` ref stays empty. `getModelInfo()` returns null for unknown models (already does this).
- No functional change needed — just ensure graceful empty state

#### `src/composables/useSessions.js` — MINOR CHANGES
- **Current:** `createSession()` requires `projectPath`, returns null if missing
- **Target:** Allow a default/sentinel project path (e.g., `"paloma"` or `"default"`) for sessions created without a project context
- `loadSessions()` works with this sentinel path

#### `src/components/settings/SettingsModal.vue` — MINOR CHANGES
- **Current:** Shows OpenRouter API key as first setting
- **Target:** Move OpenRouter to an "Optional Integrations" section
- Bridge settings become primary (already present, just reorder)
- Clear messaging: "Paloma works with CLI models by default. Add an OpenRouter key for additional models."

### Side Effects to Watch
- `useCostTracking.js` — uses model info for cost calculation. CLI models may not have pricing. Verify graceful fallback.
- `useMCP.js` — formats tools in OpenRouter schema. This is actually OpenAI function-calling format, which is universal. No change needed.
- `PromptBuilder.vue` — calls `useOpenRouter().models`. If empty, the OpenRouter section in ModelSelector is just empty. Fine.

---

## Phase 2: Project Context Switching (`/project` Command)

### Goal
Attach project context to the current conversation via a `/project <name>` command (or UI element). Load plans, settings, and conventions instantly. Switch between projects without restarting.

### Architecture Decision: MCP-Only File Access

**Key insight from the audit:** The CLI path already works without `dirHandle`. It uses `useProject().projectRoot` (a string path) and MCP tools for all file operations. The OpenRouter path uses `dirHandle` for browser-side file tools (`services/tools.js`, `services/filesystem.js`).

**Decision:** Move entirely to MCP-based file operations for both paths. This:
- Eliminates the `dirHandle` dependency
- Makes project switching trivial (just change a path string)
- Removes the need for `window.showDirectoryPicker()`
- Simplifies the tool execution model (one path, not two)
- The MCP filesystem server already has all needed operations

### Files to Change

#### `src/composables/useProject.js` — MAJOR REWRITE
- **Current:** Manages `dirHandle` via browser File System Access API
- **Target:** Manages `projectRoot` as a simple string path, loaded via MCP bridge
- New function: `switchProject(name)` — resolves path via `useMCP().resolveProjectPath(name)`, loads plans/instructions via MCP filesystem tools, swaps all project refs
- New function: `listProjects()` — scans `{paloma_root}/projects/` via MCP filesystem
- Remove `dirHandle`, `tryAutoRecover()`, `needsReconnect` computed
- Keep `projectName`, `projectRoot`, `projectInstructions`, `activePlans`, `mcpConfig`
- Project instructions and plans loaded via MCP `read_text_file` instead of `dirHandle`

#### `src/services/filesystem.js` — DEPRECATE / REDUCE
- **Current:** Full browser File System Access API wrapper
- **Target:** Most functions become unnecessary (MCP handles file ops)
- Keep only what's needed for browser-specific features (if any)
- File reading, writing, listing — all move to MCP tools
- `openProject()` (directory picker) replaced by `switchProject(name)` in useProject

#### `src/services/tools.js` — MODERATE CHANGES
- **Current:** Defines browser-side tools (`readFile`, `listDirectory`, etc.) that use `dirHandle`
- **Target:** Remove browser-side file tools. All tool execution goes through MCP.
- The `getAllTools()` function returns only MCP-discovered tools
- `executeTool()` routes everything through `callMcpTool()`
- `executeWriteTool()` routes through MCP filesystem server

#### `src/composables/useOpenRouterChat.js` — MODERATE CHANGES
- **Current:** Handles both MCP tools and browser-side file tools with dirHandle
- **Target:** Only MCP tools. Remove `dirHandle` from signature and tool execution
- Tool confirmation still works (just for MCP tools now)

#### `src/composables/useChat.js` — MODERATE CHANGES
- **Current:** `sendMessage()` has 11 parameters including `dirHandle`
- **Target:** Remove `dirHandle` parameter. Project context comes from `useProject()` composable internally.
- Simplify signature: `sendMessage(sessionId, content, attachedFiles)`
- Everything else (model, phase, project context) pulled from composable state

#### `src/components/chat/ChatView.vue` — MODERATE CHANGES
- **Current:** Passes `dirHandle` and project state to `sendMessage()`
- **Target:** Just calls `sendMessage(sessionId, content, files)` — project context is internal
- File reading for attachments goes through MCP instead of dirHandle

#### Implement `/project` Command

**Two approaches (both viable):**

**A. Slash command in chat input:**
- User types `/project fadden` in the prompt
- `PromptBuilder.vue` intercepts `/` commands before sending
- Calls `useProject().switchProject('fadden')`
- Shows confirmation in chat: "Loaded project: Fadden Custom Pest Services (3 active plans)"

**B. UI element:**
- Project picker in TopBar or Sidebar
- Dropdown listing available projects from `projects/` directory
- Click to switch — loads context immediately

**Recommendation:** Both. Slash command for power users, UI element for discoverability.

#### `src/components/layout/Sidebar.vue` — MODERATE CHANGES
- Add project indicator at top (current project name, clickable to switch)
- Sessions grouped by project, or filtered to current project
- Visual indicator when no project is attached

#### `src/components/layout/TopBar.vue` — MINOR CHANGES
- "Open Project" button becomes a project switcher dropdown
- Shows current project name or "No project"

### New Files

#### `src/composables/useProjectContext.js` (or extend useProject.js)
- `listProjects()` — discovers projects in `{paloma_root}/projects/`
- `switchProject(name)` — loads all context for a project
- `detachProject()` — returns to no-project state
- `getProjectInfo(name)` — reads `.paloma/` metadata without fully switching

### Side Effects to Watch
- **Session migration:** Existing sessions reference `projectPath` as a local filesystem path. May need migration if path format changes.
- **File attachments (`@` feature):** Currently uses `useFileIndex` which walks the `dirHandle`. Needs to use MCP filesystem instead.
- **ChangesPanel:** Detects file changes by reading files via dirHandle after streaming. Needs MCP equivalent.
- **Code Apply flow:** Reads original file via dirHandle, applies edit, writes back. All need MCP equivalent.
- **Auto-recovery:** `tryAutoRecover()` in useProject restores dirHandle from IndexedDB. No longer needed if we don't use dirHandle.
- **Export chats:** Already uses MCP bridge (`useMCP().exportChats()`). No change needed.

---

## Phase 3: Polish & Defaults

### Smart Defaults
- Default model: `claude-cli:sonnet` (fast, capable, no API key needed)
- Default phase: `flow` (already set)
- Auto-connect bridge on startup (already supported, just make it the default)
- If bridge fails to connect, show clear setup instructions

### First-Run Experience
- No WelcomeScreen gate — app opens directly
- If bridge not connected, show inline banner: "Connect to Paloma bridge to start chatting"
- Settings accessible from gear icon (already exists)
- `/project` command available immediately

### Context Loading on Project Switch
When `/project fadden` is invoked:
1. Resolve path: `{paloma_root}/projects/fadden-demo/`
2. Read `.paloma/plans/active-*.md` → inject into system prompt
3. Read `.paloma/docs/*` → available as reference
4. Read `.paloma/mcp.json` → configure tool permissions
5. Read `.paloma/instructions.md` → project-specific instructions
6. Set `cwd` for CLI subprocess to project root
7. Load sessions scoped to this project
8. Show summary: "Project loaded: Fadden Custom Pest Services"

---

## File Impact Matrix

| File | Phase | Change Level | Notes |
|------|-------|-------------|-------|
| `src/App.vue` | 1 | Moderate | Remove OpenRouter/dirHandle gates |
| `src/components/welcome/WelcomeScreen.vue` | 1 | Major/Remove | Replace or remove entirely |
| `src/components/settings/SettingsModal.vue` | 1 | Minor | Reorder, make OR optional |
| `src/components/prompt/ModelSelector.vue` | 1 | Minor | Hide OR when no key |
| `src/composables/useSettings.js` | 1 | Minor | Default to CLI model |
| `src/composables/useChat.js` | 1+2 | Moderate | Optional apiKey, remove dirHandle |
| `src/composables/useOpenRouter.js` | 1 | Minor | Graceful empty state |
| `src/composables/useSessions.js` | 1 | Minor | Allow default project path |
| `src/composables/useProject.js` | 2 | Major | Rewrite for MCP-based context |
| `src/services/filesystem.js` | 2 | Major/Deprecate | Replace with MCP ops |
| `src/services/tools.js` | 2 | Moderate | MCP-only tools |
| `src/composables/useOpenRouterChat.js` | 2 | Moderate | Remove dirHandle |
| `src/composables/useCliChat.js` | 2 | Minor | Already works without dirHandle |
| `src/composables/useFileIndex.js` | 2 | Moderate | Switch to MCP filesystem |
| `src/components/chat/ChatView.vue` | 2 | Moderate | Simplified sendMessage |
| `src/components/chat/ChangesPanel.vue` | 2 | Minor | MCP file reads |
| `src/components/layout/Sidebar.vue` | 2 | Moderate | Project indicator |
| `src/components/layout/TopBar.vue` | 2 | Minor | Project switcher |
| `src/components/prompt/PromptBuilder.vue` | 2 | Minor | Slash command handler |
| `src/composables/useSystemPrompt.js` | — | None | Already handles null gracefully |
| `src/composables/usePermissions.js` | — | None | Already independent |
| `src/composables/useMCP.js` | — | None | Already the backbone |
| `src/services/claudeStream.js` | — | None | Already independent |

---

## Implementation Order

1. **Phase 1a:** Change defaults (useSettings defaultModel → CLI, remove WelcomeScreen API key gate)
2. **Phase 1b:** Auto-connect bridge on startup, show chat immediately
3. **Phase 1c:** Make OpenRouter optional in ModelSelector and useChat
4. **Phase 2a:** Rewrite useProject for MCP-based context loading (no dirHandle)
5. **Phase 2b:** Implement `/project` command in PromptBuilder
6. **Phase 2c:** Migrate file attachment, code apply, and changes panel to MCP
7. **Phase 2d:** Add project switcher UI in Sidebar/TopBar
8. **Phase 3:** Polish defaults, first-run experience, context loading summary

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing sessions | Medium | High | Session migration script, keep backward compat for projectPath |
| File attachment perf via MCP vs dirHandle | Low | Medium | MCP filesystem is fast for single files; batch reads for index |
| OpenRouter users losing functionality | Low | Low | OpenRouter still works, just not required |
| Bridge not running on startup | Medium | Medium | Clear error state with setup instructions |
| Code Apply flow via MCP | Low | Medium | Test thoroughly — read/write cycle must be atomic |

---

## Phase 2.5: Plan Approval UI

### Goal
When Paloma generates a plan, present it in a dedicated modal for review and approval — not buried in chat messages.

### Implementation: Fork DiffPreview.vue → PlanApproval.vue

We already have the perfect pattern in `DiffPreview.vue`: full-screen modal, scrollable content, action buttons. Fork it:

#### `src/components/chat/PlanApproval.vue` — NEW
- Large modal (max-width 4xl or larger) with backdrop
- Header: plan title, scope badge, date
- Body: scrollable markdown-rendered content (reuse `marked` + our existing styles)
- Footer: three buttons — "Approve" (green), "Request Changes" (amber), "Reject" (red)
- On approve: plan gets saved to `.paloma/plans/active-*.md` via MCP, confirmation in chat
- On request changes: returns to chat with the plan context, user can describe what to change
- On reject: dismissed, note in chat

#### `src/components/chat/ChatView.vue` — MINOR
- Add `activePlan` ref (like `activeToolConfirmation`)
- When streaming detects a plan block (could use a `<!-- plan -->` marker or detect the plan format), trigger the modal
- Wire approve/reject/changes handlers

#### Integration with `/project` context
- When a plan is approved, it's written to the active project's `.paloma/plans/`
- The system prompt picks it up on the next message automatically
- Full lifecycle: generate → review in modal → approve → auto-loaded in future conversations

#### Files to Change
| File | Change |
|------|--------|
| `src/components/chat/PlanApproval.vue` | NEW — modal component |
| `src/components/chat/ChatView.vue` | Wire plan detection and modal trigger |
| `src/composables/useChat.js` | Expose plan state for modal |

---

## Success Criteria

- [ ] `npm install && npm start` → app opens, bridge connects, can chat immediately
- [ ] No API key needed — CLI models work out of the box
- [ ] `/project fadden` loads all context, plans show in prompt
- [ ] `/project verifesto` switches context seamlessly
- [ ] Existing sessions still load correctly
- [ ] OpenRouter works when key is configured (opt-in)
- [ ] File attachments work via MCP
- [ ] Code Apply works via MCP
- [ ] Plans render in a dedicated approval modal with Approve/Changes/Reject
- [ ] Approved plans auto-save to `.paloma/plans/` and load into future conversations
