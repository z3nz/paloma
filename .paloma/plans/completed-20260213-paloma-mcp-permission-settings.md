# Plan: MCP Permission Management in Settings Modal

**Status:** active
**Created:** 2026-02-13
**Scope:** paloma
**Impact:** Moderate — touches Settings UI, permission composable, and mcp.json

---

## The Problem

The permission system works, but it's invisible. You can't see which servers are auto-approved, you can't toggle them, and session-level approvals vanish silently on refresh. The only way to manage project-level permissions is through the ToolConfirmation dialog's "Always Allow" button, which is reactive (you have to wait for a tool call) rather than proactive.

---

## The Vision

A "Tool Permissions" section in SettingsModal that shows every connected MCP server with its approval status and lets you manage it directly:

```
┌─ Tool Permissions ──────────────────────────────────┐
│                                                      │
│  filesystem    ● Auto-approved (project)   [Revoke]  │
│  brave-search  ● Auto-approved (project)   [Revoke]  │
│  git           ○ Session only              [Promote]  │
│  shell         ○ Ask every time            [Approve ▾]│
│  web           ○ Ask every time            [Approve ▾]│
│  fs-extra      ○ Ask every time            [Approve ▾]│
│                                                      │
│  ─── Session Approvals ───                           │
│  git (expires on refresh)              [Clear]        │
│                                                      │
│  [Clear All Session Approvals]                       │
└──────────────────────────────────────────────────────┘
```

Each server shows:
- **Name** and connected status (from `useMCP().servers`)
- **Approval tier**: project (persisted in mcp.json), session (in-memory), or none
- **Actions**: Promote (session → project), Revoke (project → none), Approve (none → session or project), Clear session

---

## Architecture

### Data Sources (Already Exist)
- `useMCP().servers` — connected servers with tool lists
- `usePermissions().sessionApprovals` — Set of session-approved server names
- `useProject().mcpConfig` — `{ enabled, autoExecute }` from `.paloma/mcp.json`

### Changes Needed

#### `src/components/settings/SettingsModal.vue` — MODERATE
- Add "Tool Permissions" section after "Server Status"
- For each server in `mcpServerList`:
  - Show approval tier badge (project / session / none)
  - Show action buttons based on current tier
- "Clear All Session Approvals" button at bottom
- Actions:
  - **Approve for project** → add to `mcpConfig.autoExecute`, write `.paloma/mcp.json`
  - **Approve for session** → call `approveForSession(serverName)`
  - **Revoke project approval** → remove from `mcpConfig.autoExecute`, write `.paloma/mcp.json`
  - **Clear session approval** → remove from `sessionApprovals` Set
  - **Clear all sessions** → call `clearSession()`

#### `src/composables/usePermissions.js` — MINOR
- Add `revokeSession(serverName)` — remove single server from session Set
- Existing functions cover everything else

#### `src/composables/useProject.js` — MINOR
- Add `updateMcpConfig(newConfig)` — writes updated mcp.json to project root via MCP
- Or expose this as a utility in SettingsModal directly (already done in ChatView's handleToolAllowAlways)

### No New Files Needed

Everything fits cleanly into existing structures.

---

## Implementation Steps

1. Add `revokeSession(serverName)` to usePermissions.js
2. Create a `ToolPermissions` section in SettingsModal.vue
3. Wire approval tier detection: check `mcpConfig.autoExecute` first, then `sessionApprovals`
4. Implement action handlers (approve/revoke/clear)
5. Test: approve for project → verify mcp.json updated, tool calls skip dialog
6. Test: revoke → verify tool calls show dialog again
7. Test: session approve → verify survives within tab, lost on refresh

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race condition: two tabs modifying mcp.json | Low | Medium | Read-modify-write with latest state |
| Revoking while tool is pending | Low | Low | Pending tools keep their approval; revoke affects next call |
| No project loaded (no mcp.json) | Medium | Low | Disable project-level controls, show "No project loaded" |

---

## Success Criteria

- [ ] Settings modal shows all connected servers with approval status
- [ ] Can promote session → project (persists to mcp.json)
- [ ] Can revoke project approval (removes from mcp.json)
- [ ] Can approve/clear session-level permissions
- [ ] Changes take effect immediately (no restart needed)
- [ ] Works when no project is loaded (session-only mode)
