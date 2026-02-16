# Draft: Browser DevTools Bridge

> **Goal:** Give Paloma the ability to read/write browser console, inspect DOM, and interact with IndexedDB directly.
> **Status:** Draft
> **Created:** 2026-02-15

---

## The Idea

Adam's insight: if Paloma could execute JavaScript in the browser console, she could:
- Debug her own UI in real time
- Inspect and modify IndexedDB data (sessions, messages, settings)
- Read DOM state, check CSS, verify reactive updates
- Run one-off data migrations (like batch retitling sessions)
- Self-modify hot-reloaded components and verify the result

## How It Could Work

### Option A: WebSocket Eval Bridge
Add a `browser_eval` tool to the MCP proxy that sends JavaScript to the browser for execution via WebSocket. The browser receives it, runs `eval()`, and sends back the result.

```
CLI Model → MCP Proxy → WebSocket → Browser eval() → result back
```

- Pro: Works for both CLI and OpenRouter paths
- Pro: Full access to app state, Dexie DB, Vue reactivity, DOM
- Con: Security implications of eval (but this is a local dev tool)

### Option B: Chrome DevTools Protocol (CDP)
Connect to Chrome's remote debugging port and use CDP to evaluate JS, inspect DOM, read console logs, take screenshots.

- Pro: Full browser debugging capability, including network tab, performance
- Pro: Can read console.log output passively
- Con: Requires Chrome launched with `--remote-debugging-port`
- Con: More complex setup

### Option C: Hybrid — MCP Server wrapping CDP
Create an MCP server (`mcp-servers/devtools.js`) that connects to CDP and exposes tools like `browser_eval`, `browser_screenshot`, `browser_console_logs`, `browser_dom_query`.

- Pro: Best of both worlds — full CDP power via MCP tools
- Pro: Could also capture screenshots for visual debugging
- Con: Most complex to build

## Security Considerations

- This is a LOCAL development tool — not exposed to the internet
- Eval is inherently dangerous but acceptable in a trusted dev environment
- Could add a confirmation dialog for eval calls (same pattern as tool confirmation)
- Could limit to specific APIs (Dexie, DOM queries) rather than full eval

## Recommended: Start with Option A

Simplest path — add `browser_eval` and `browser_query_selector` tools via the existing WebSocket bridge. No new dependencies. The browser side is trivial:

```js
// In mcpBridge.js message handler
} else if (msg.type === 'browser_eval') {
  try {
    const result = await eval(msg.code)
    send({ type: 'browser_eval_result', id: msg.id, result: String(result) })
  } catch (e) {
    send({ type: 'browser_eval_result', id: msg.id, error: e.message })
  }
}
```

Then add it as an MCP proxy tool like `set_chat_title` and `ask_user`.

---

*This would make Paloma truly self-aware of her own runtime state — a major step toward autonomous self-debugging and self-evolution.*
