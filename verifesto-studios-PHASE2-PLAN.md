# Phase 2 Plan: CLI Tool Call Persistence, Export, and Agent Tooling

## Context

The Phase 1 work (previous sessions) extracted useChat.js into composables, built an MCP proxy server for CLI tool access, added unified tool confirmations, permission persistence (session + project), collapsible tool activity UI, and fixed auto-scroll + schema stripping bugs.

**Remaining issues:**
1. CLI tool calls (tool_use/tool_result) are only displayed in-memory via `toolActivity` but NOT persisted to the database
2. Tool calls aren't included in chat exports
3. Claude CLI needs better awareness of available MCP tools (system prompt enrichment)

---

## Task 1: Persist CLI Tool Calls to Database

### Problem
When using CLI models, tool calls stream through as `tool_use` and `tool_result` events in `useCliChat.js`. These are tracked in `toolUseToActivity` for the ToolActivity UI indicator but are never saved to `db.messages`. When you reload the page or switch sessions, all tool call history is lost.

### Solution
Save tool calls as database messages, similar to how the OpenRouter path does it via `onSaveTool`.

### Modified: `src/composables/useCliChat.js`

In `runCliChat()`, accumulate tool_use and tool_result events, then save them:

```js
// Collect tool calls during streaming
const toolCalls = [] // { id, name, input }
const toolResults = new Map() // toolUseId → result content

// In the streaming loop:
} else if (chunk.type === 'tool_use') {
  toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input })
  // ... existing addActivity code
} else if (chunk.type === 'tool_result') {
  toolResults.set(chunk.toolUseId, chunk.content)
  // ... existing markActivityDone code
}
```

After streaming completes, return the tool data alongside content:
```js
return { content: accumulatedContent, usage, toolCalls, toolResults }
```

### Modified: `src/composables/useChat.js`

In the CLI path of `sendMessage()`, after `runCliChat()` returns:

```js
const { content: cliContent, usage, toolCalls, toolResults } = await runCliChat(...)

// Save tool call messages to DB (if any tool calls occurred)
if (toolCalls?.length) {
  for (const call of toolCalls) {
    // Save as tool message
    const resultContent = toolResults?.get(call.id) || 'OK'
    const toolMsg = {
      sessionId,
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      toolArgs: call.input,
      content: typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent),
      timestamp: Date.now()
    }
    const id = await db.messages.add(toolMsg)
    toolMsg.id = id
    messages.value.push(toolMsg)
  }
}
```

### Key Detail: Tool Result Content
The `tool_result` events from `claudeStream.js` yield `{ type: 'tool_result', toolUseId, content }`. Check that `content` contains the actual tool output text (it may be an array of content blocks from MCP — need to flatten to string).

### Verification
1. Start a CLI chat session, ask it to use tools (read files, list directory, etc.)
2. After streaming completes, check IndexedDB — tool messages should appear with role='tool'
3. Switch to another session and back — tool calls should be visible in history
4. Reload the page — tool call history persists

---

## Task 2: Display Persisted Tool Calls in Message History

### Problem
Even after persisting tool calls, they won't show in the message history because `MessageItem.vue` only renders `user` and `assistant` messages. Tool messages (role='tool') need a compact, collapsible rendering.

### Modified: `src/components/chat/MessageItem.vue`

Add a rendering path for `role === 'tool'` messages. Group consecutive tool messages together and show them collapsed:

Option A (simpler): Filter out tool messages from the message list in `MessageList.vue` and instead display them as a collapsible section between the assistant message that triggered them and the next message.

Option B (recommended): Create a `ToolCallGroup` component that takes an array of consecutive tool messages and renders them as a collapsed group:
```
> 4 tool calls [expand]
  - git_status()         ✓
  - list_directory(src/) ✓
  - read_file(src/App.vue) ✓
  - shell_exec(npm test) ✓
```

### New: `src/components/chat/ToolCallGroup.vue` (~50 lines)
- Props: `toolMessages: Array` (consecutive tool messages)
- Collapsed: shows "N tool calls" with expand chevron
- Expanded: shows each tool name + args summary + status indicator
- Clicking a tool call could show the full result in a popover/expandable section

### Modified: `src/components/chat/MessageList.vue`
- Group consecutive tool messages into arrays
- Render `ToolCallGroup` instead of individual `MessageItem` for tool messages

---

## Task 3: Include Tool Calls in Chat Export

### Problem
The `exportChats()` function in `useMCP.js` already exports tool message data (toolName, toolArgs, toolCallId, toolCalls), but it depends on those fields being present in `db.messages`. Once Task 1 saves CLI tool calls to the DB, they'll automatically be included in exports.

### Verification
After Task 1 is complete:
1. Have a CLI chat session with tool calls
2. Export chats
3. Open the JSON export file — verify tool messages appear with correct toolName, toolArgs, content

### If needed (minor fix)
The export mapping in `useMCP.js:185-193` already handles:
```js
if (m.toolName) msg.toolName = m.toolName
if (m.toolArgs) msg.toolArgs = m.toolArgs
if (m.toolCallId) msg.toolCallId = m.toolCallId
if (m.toolCalls) msg.toolCalls = m.toolCalls
```

This should work as-is once tools are persisted. If the CLI path saves tool calls differently than OpenRouter (e.g., different field names), align the field names.

---

## Task 4: Enrich CLI System Prompt with Available MCP Tools

### Problem
When Claude CLI connects to the MCP proxy, it discovers tools via the MCP protocol's `tools/list`. However, Claude may not know the best way to USE those tools effectively. The system prompt sent via `--append-system-prompt` should include guidance about available tools.

### Modified: `src/composables/useSystemPrompt.js`

In `buildSystemPrompt()`, when MCP tools are available, append a section:

```
## Available MCP Tools

You have access to the following MCP tools via the "paloma" MCP server:

### filesystem
- list_directory(path): List files and directories
- read_file(path): Read file contents
- write_file(path, content): Write to a file

### git
- git_status(): Show working tree status
- git_log(max_count): Show recent commits
- git_diff(ref): Show differences
...

### shell
- shell_exec(command): Execute a shell command
...

Use these tools proactively to explore the codebase, make changes, and verify your work.
```

### Alternative: Build from live tool metadata
Instead of hardcoding, build the tool list dynamically from `mcpManager.getTools()`. The bridge could send the tool list as part of the `claude_ack` response, or the system prompt builder could receive the enabled MCP tool definitions.

### Recommended approach
The proxy server already serves tools via MCP protocol — Claude CLI will discover them automatically on connect. The system prompt just needs a brief note: "You have MCP tools available from the paloma server. Use them proactively."

---

## Task 5: Auto-scroll Polish

### Current state
- Streaming content scroll: FIXED (instant behavior, tied to throttled render)
- Tool activity scroll: FIXED (watches toolActivity.length)
- Potential remaining issue: when tool activity appears/grows below the viewport during periods where `streamingContent` is static (e.g., waiting for tool confirmation)

### If still needed
Add a MutationObserver on the container that auto-scrolls when content height changes AND `isNearBottom` is true. This is a catch-all for any DOM changes we haven't explicitly watched.

```js
onMounted(() => {
  const observer = new MutationObserver(() => {
    if (isNearBottom.value) scrollToBottom('instant')
  })
  observer.observe(container.value, { childList: true, subtree: true })
})
```

---

## Implementation Order

1. **Task 1** — Persist CLI tool calls (useCliChat.js + useChat.js changes)
2. **Task 2** — Display persisted tool calls (ToolCallGroup.vue + MessageList.vue)
3. **Task 3** — Verify exports work (likely no code changes needed)
4. **Task 4** — System prompt enrichment (useSystemPrompt.js)
5. **Task 5** — Auto-scroll polish if still needed after Tasks 1-2

Each task is independently testable and leaves the system working.

---

## Files Summary

### New (1 file)
| File | Purpose |
|------|---------|
| `src/components/chat/ToolCallGroup.vue` | Collapsible tool call group in message history |

### Modified (4-5 files)
| File | Changes |
|------|---------|
| `src/composables/useCliChat.js` | Return toolCalls + toolResults from runCliChat |
| `src/composables/useChat.js` | Save CLI tool messages to DB |
| `src/components/chat/MessageList.vue` | Group consecutive tool messages, render ToolCallGroup |
| `src/composables/useSystemPrompt.js` | Add MCP tool guidance to system prompt |
| `src/components/chat/MessageList.vue` | MutationObserver scroll (if needed) |

### Unchanged
- `bridge/*` — no bridge changes needed
- `src/composables/useMCP.js` — export mapping already handles tool fields
- `src/composables/usePermissions.js` — complete as-is
- `src/components/chat/ToolConfirmation.vue` — complete as-is
