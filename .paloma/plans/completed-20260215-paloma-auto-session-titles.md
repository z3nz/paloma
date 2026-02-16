# Completed: Auto Session Titles via `set_chat_title` Tool

> **Goal:** Model names its own conversation on the first response using a tool call.
> **Status:** Completed
> **Created:** 2026-02-13
> **Overhauled:** 2026-02-15

---

## Approach

Give the model a `set_chat_title` tool and instruct it (via system prompt) to call it once during its first response. The model already understands the conversation context — no second API call, no message thresholds, no sidecar model. Both the OpenRouter and CLI paths use the same tool.

**Fallback:** If the model doesn't call the tool, the existing 50-char truncation of the first message kicks in as a safety net.

---

## Implementation

### 1. Tool Definition — `src/services/tools.js`

Add `SYSTEM_TOOLS` array alongside `READ_TOOLS` / `WRITE_TOOLS`:

```js
export const SYSTEM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_chat_title',
      description: 'Set the title of the current conversation. Call this once during your first response to give the chat a concise, descriptive title (5-8 words).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise descriptive title (5-8 words)' }
        },
        required: ['title']
      }
    }
  }
]
```

- Add `'set_chat_title'` to `AUTO_EXECUTE_TOOLS` (no confirmation needed)
- Update `getAllTools()` to always include `SYSTEM_TOOLS`

### 2. OpenRouter Execution — `src/composables/useOpenRouterChat.js`

- Accept `onSetTitle` callback parameter
- In tool execution loop, handle `set_chat_title` before MCP/built-in checks:
  ```js
  if (toolName === 'set_chat_title') {
    if (args.title) await onSetTitle(args.title)
    result = JSON.stringify({ success: true, title: args.title })
  }
  ```

### 3. Wire Up in Chat Composable — `src/composables/useChat.js`

- Import `useSessions`
- Pass `onSetTitle` callback to `runOpenRouterLoop`:
  ```js
  async onSetTitle(title) {
    const { updateSession } = useSessions()
    await updateSession(sessionId, { title })
  }
  ```
- Guard the `generateTitle` fallback — only use it if the session title is still `"New Chat"` after the model finishes

### 4. CLI Path — MCP Proxy — `bridge/mcp-proxy-server.js`

- Accept `onSetTitle` callback in constructor options
- Add `set_chat_title` to `_buildToolList()` (same shape as `ask_user`)
- Handle in `_handleToolCall()` before the `__` separator check:
  ```js
  if (name === 'set_chat_title') {
    this.onSetTitle?.(args.title, cliRequestId)
    return { content: [{ type: 'text', text: `Chat titled: ${args.title}` }] }
  }
  ```
  Fire-and-forget — no await, no user response needed.

### 5. Bridge Plumbing — `bridge/index.js`

- Pass `onSetTitle` callback when creating `McpProxyServer`:
  ```js
  onSetTitle(title, cliRequestId) {
    sendToOrigin(cliRequestId, { type: 'set_chat_title', title })
  }
  ```

### 6. Browser WebSocket Handler — `src/services/mcpBridge.js`

- Add `onSetTitle` to callback list in `connect()`
- Handle new message type:
  ```js
  } else if (msg.type === 'set_chat_title') {
    onSetTitle?.(msg.title)
  }
  ```

### 7. MCP Composable — `src/composables/useMCP.js`

- Import `useSessions`
- Wire `onSetTitle` callback in bridge `connect()`:
  ```js
  onSetTitle(title) {
    const { activeSessionId, updateSession } = useSessions()
    if (activeSessionId.value) {
      updateSession(activeSessionId.value, { title })
    }
  }
  ```

### 8. System Prompt — `src/prompts/base.js`

Add section to `BASE_INSTRUCTIONS`:

```
## Chat Naming

On your very first response in a new conversation, call the `set_chat_title` tool to give
this chat a concise, descriptive title (5-8 words). Do this proactively — do not ask the
user what to name it. Base it on the user's message and the topic at hand. If the
conversation already has a meaningful title (not "New Chat"), do not rename it.
```

---

## Data Flow

### OpenRouter Path
1. User sends first message → `sendMessage()` builds tool list including `set_chat_title`
2. Model responds with text + `set_chat_title` tool call
3. Tool loop catches it → calls `onSetTitle` → `updateSession(sessionId, { title })`
4. Reactive `sessions` ref updates → sidebar shows new name immediately

### CLI Path
1. User sends first message → Claude CLI starts with MCP proxy
2. Model calls `set_chat_title` via MCP proxy
3. Proxy fires `onSetTitle` → sends `{ type: 'set_chat_title', title }` over WebSocket
4. `mcpBridge.js` receives → `useMCP.js` callback → `updateSession(activeSessionId, { title })`
5. Sidebar updates immediately

---

## Verification Checklist

- [ ] OpenRouter: new chat → first response names the chat → sidebar updates
- [ ] CLI: new chat → first response names the chat → sidebar updates
- [ ] Fallback: if tool not called → 50-char truncation still works
- [ ] No re-naming: subsequent messages don't trigger title changes
- [ ] Sidebar reactivity: title change visible instantly without refresh
- [ ] No confirmation dialog: tool auto-executes silently

---

## Files Changed

| File | What |
|------|------|
| `src/services/tools.js` | `SYSTEM_TOOLS`, `AUTO_EXECUTE_TOOLS`, `getAllTools()` |
| `src/composables/useOpenRouterChat.js` | `onSetTitle` callback, `set_chat_title` handler |
| `src/composables/useChat.js` | Import `useSessions`, pass `onSetTitle`, guard fallback |
| `src/prompts/base.js` | "Chat Naming" instruction |
| `bridge/mcp-proxy-server.js` | `onSetTitle` callback, tool in `_buildToolList`, handler |
| `bridge/index.js` | `onSetTitle` → WebSocket event |
| `src/services/mcpBridge.js` | `onSetTitle` callback, `set_chat_title` message handler |
| `src/composables/useMCP.js` | Wire `onSetTitle` in `connect()` |

---

*Supersedes the original "7-message threshold + Haiku summarization" approach. Zero extra cost, zero latency, unified across both model paths.*
