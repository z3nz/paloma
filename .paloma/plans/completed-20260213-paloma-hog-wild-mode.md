# Plan: Hog Wild Mode (CLI Full Autonomy)

**Status:** completed
**Created:** 2026-02-13
**Scope:** paloma
**Impact:** Minor-Moderate — touches CLI chat flow, Settings UI, permission system

---

## The Problem

When Adam trusts the context and wants Paloma to just *go* — explore, write, refactor, build — every tool call still triggers a confirmation dialog. This slows down flow and fragments attention. There's no way to say "I trust you completely right now, run wild."

---

## The Vision

A toggle button (affectionately named "Hog Wild") that auto-approves ALL tool confirmations for CLI mode. When active:

- Every MCP tool call through the CLI proxy is instantly approved
- No ToolConfirmation dialogs appear
- Paloma operates with full autonomy
- A clear visual indicator shows the mode is active
- It's session-scoped by default (resets on refresh for safety)
- Option to persist to project level if desired

```
┌─ Top Bar ──────────────────────────────────────┐
│  🐗 HOG WILD                          [Toggle] │
│  "All tools auto-approved. Paloma is free."     │
└────────────────────────────────────────────────┘
```

---

## Architecture

### How It Works

**Core mechanism:** When Hog Wild is active, `isAutoApproved()` returns `true` for ALL tools, bypassing both session and project checks.

This is elegant because the entire permission system already funnels through `isAutoApproved()` — we just add one more check at the top.

### Changes Needed

#### `src/composables/usePermissions.js` — MINOR
```javascript
// Add:
const hogWild = ref(false)

function isAutoApproved(toolName, mcpConfig) {
  // Hog Wild: approve everything
  if (hogWild.value) return true
  
  // ... existing logic unchanged
}

function toggleHogWild() {
  hogWild.value = !hogWild.value
}
```
- Add `hogWild` to HMR state preservation
- Expose `hogWild`, `toggleHogWild` from composable
- Session-scoped by default (ref resets on page refresh)

#### `src/components/layout/TopBar.vue` — MINOR
- Add Hog Wild toggle button
- Visual indicator: distinct color (amber/red) when active
- Tooltip: "Auto-approve all tool calls. Use with trust."
- Could be a small icon button or a labeled toggle

#### `src/components/settings/SettingsModal.vue` — MINOR (OPTIONAL)
- Add Hog Wild toggle in the Tool Permissions section
- Checkbox: "Hog Wild Mode — auto-approve all tools (session only)"
- Option: "Persist Hog Wild to project" → writes a flag to `.paloma/mcp.json`

#### `.paloma/mcp.json` — OPTIONAL EXTENSION
```json
{
  "enabled": ["brave-search", "git", "shell", "filesystem", "web", "fs-extra"],
  "autoExecute": ["brave-search", "filesystem"],
  "hogWild": false
}
```
- If `hogWild: true` in project config, mode activates automatically on project load
- Dangerous but intentional — Adam explicitly opts in

### No New Files Needed

---

## CLI-Specific Behavior

Since Hog Wild is primarily about CLI mode (where tools flow through the proxy):

1. **CLI path**: `pendingCliToolConfirmation` is set → ChatView's watcher checks `isAutoApproved()` → returns `true` → calls `handleToolAllow()` immediately → no dialog shown
2. **OpenRouter path**: Same flow — `pendingToolConfirmation` → auto-approved → immediate execution
3. Both paths benefit, but CLI is the primary use case since that's where Paloma has the most power

---

## Safety Considerations

- **Session-scoped by default**: Refresh kills it. You have to re-enable intentionally.
- **Visual indicator is always visible**: You always know when it's on.
- **Project persistence is opt-in**: You have to explicitly save it to mcp.json.
- **Not a security bypass**: This is a UI convenience for the project owner. The MCP servers themselves still enforce their own safety boundaries.
- **Easy off-ramp**: One click to disable. Any tool denial still works (deny button in activity log).

---

## Implementation Steps

1. Add `hogWild` ref + `toggleHogWild()` to usePermissions.js
2. Add early-return check in `isAutoApproved()`
3. Add toggle button to TopBar.vue with visual state
4. Add HMR state preservation for `hogWild`
5. (Optional) Add settings UI + mcp.json persistence
6. Test: enable → send CLI message → verify all tools auto-approved
7. Test: disable → verify confirmation dialogs return
8. Test: refresh → verify mode resets to off

---

## Success Criteria

- [ ] Single toggle activates full auto-approval
- [ ] Clear visual indicator when active
- [ ] Session-scoped by default (safe)
- [ ] All CLI tool calls skip confirmation dialog
- [ ] Can be disabled instantly
- [ ] Optional: persist to project config
