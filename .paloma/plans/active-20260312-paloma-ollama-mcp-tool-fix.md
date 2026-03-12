# Fix Ollama MCP Tool Integration

**Status:** active
**Created:** 2026-03-12
**Scope:** paloma — bridge/ollama-manager.js, bridge/index.js
**Goal:** Make Ollama models (qwen2.5-coder:32b) properly execute MCP tools instead of dumping raw JSON into chat

---

## Scout Findings

### The Problem
When Ollama models try to use MCP tools, the tool call JSON appears as text in the chat instead of being properly intercepted and executed. Three failure modes observed:

1. **JSON as text only** — Model writes `{"name": "tool", "arguments": {...}}` as plain text. Native `tool_calls` API field is empty. Text parser fails silently. JSON renders in chat.
2. **Double output** — Model returns BOTH native `tool_calls` AND writes JSON as text. Tool executes correctly, but the JSON text also streams to frontend as content. User sees both the raw JSON AND the tool result.
3. **Hallucinated results** — Model writes tool call as text AND fabricates the result without actually calling anything.

### Evidence from Chat Logs
- **Chat 28**: `memory__memory_store` tool executed (tool result exists in messages), but assistant content shows: `{"name": "memory__memory_store", ...}Title set successfully.` — JSON leaked into text content alongside the real tool execution.
- **Chat 27**: Model wrote `{"name": "git__git_commit", ...}` as plain text. No tool executed.
- **Chat 20**: Model wrote `{"name": "voice__speak", ...}` as plain text. No tool executed.
- **Chat 18**: Model wrote `mcp__paloma__filesystem__read_text_file(...)` as a function call string AND hallucinated the entire file contents.

### Root Causes

#### RC-1: Text Parser Regex Can't Handle Nested Braces
`_parseToolCallsFromText()` in `bridge/ollama-manager.js` uses:
```js
const jsonPattern = /\{[^{}]*"(?:name|function_name)"\s*:\s*"([^"]+)"[^{}]*(?:"(?:arguments|function_arg|parameters)"\s*:\s*(\{[^}]*\}))?[^{}]*\}/g
```
The `[^{}]*` quantifier fails on any JSON with nested braces in arguments (which is almost all real tool calls).

#### RC-2: No Text Stripping When Native Tool Calls Succeed
When the Ollama API returns native `tool_calls` AND the model also wrote the JSON as text (chat 28), the text content is streamed to the frontend as `content_block_delta` events WITHOUT stripping the JSON. Both the raw JSON text and the properly-executed tool result appear in the chat.

#### RC-3: Silent Failures — No Logging
`_parseToolCallsFromText()` catches all exceptions silently. When regex fails or JSON parsing fails, there's zero logging. Makes debugging impossible.

#### RC-4: Tool Name Format Mismatch
The model sometimes outputs tool names with `mcp__paloma__` prefix (chat 18) instead of the `server__tool` format used in the toolRouteMap. No normalization happens.

---

## Chart — Implementation Plan

### Fix A: Robust JSON Extractor (RC-1)
Replace the regex-based `_parseToolCallsFromText()` with a balanced-brace JSON extractor that:
- Walks the text character by character looking for `{` 
- Uses a brace depth counter to find complete JSON objects
- Tries `JSON.parse()` on each extracted object
- Checks if the parsed object has `name`/`function_name` fields matching known tools
- Handles markdown code fences (```json ... ```)

### Fix B: Strip JSON from Text When Native Tool Calls Succeed (RC-2)
In `_streamChat()`, when native `tool_calls` are collected:
- Before emitting `ollama_tool_call`, strip any JSON tool call text from `fullAssistantText`
- Use the same JSON extractor to identify and remove tool call JSON from the text
- Only stream the cleaned text content to the frontend

### Fix C: Add Diagnostic Logging (RC-3)
- Log when text-based parsing is attempted
- Log what text is being analyzed
- Log individual parse successes/failures with the text that failed
- Log tool name lookup failures (name found but not in toolRouteMap)

### Fix D: Tool Name Normalization (RC-4)
- When looking up tool names in `toolRouteMap`, also try stripping `mcp__paloma__` prefix
- Map both `filesystem__read_file` and `mcp__paloma__filesystem__read_file` to the correct route

### Fix E: Improve System Prompt (OLLAMA_INSTRUCTIONS)
- Add explicit examples of the correct function calling format
- Emphasize that the model must NEVER write JSON tool calls as text
- Add anti-hallucination instruction: "NEVER fabricate or guess tool results"

---

## Work Units

#### WU-1: Rewrite _parseToolCallsFromText() with balanced-brace JSON extractor
- **Feature:** Robust Tool Call Detection
- **Status:** complete
- **Files:** bridge/ollama-manager.js
- **Scope:** Rewrite _parseToolCallsFromText() with balanced-brace JSON extractor. Add tool name normalization (strip mcp__paloma__ prefix). Add diagnostic logging for all parse attempts.
- **Acceptance:** Text-based tool call detection works with nested JSON arguments, multi-line output, markdown code fences, and mcp__paloma__ prefixed tool names. Console logs show parse attempts.

#### WU-2: When native tool_calls are returned AND fullAssistantText contains JSON tool call text
- **Feature:** Text Stripping on Native Tool Calls
- **Status:** complete
- **Depends on:** WU-1
- **Files:** bridge/ollama-manager.js
- **Scope:** When native tool_calls are returned AND fullAssistantText contains JSON tool call text, strip the JSON from the text before streaming. Prevents double-display of tool calls in chat.
- **Acceptance:** When model returns both native tool_calls and JSON text, only the tool execution result appears in chat — no raw JSON visible to user.

---

## Implementation Notes (WU-1 & WU-2)

**Files modified:** `bridge/ollama-manager.js`

**New method — `_extractJsonObjects(text)`:**
- Strips markdown code fences before scanning
- Walks text character by character looking for `{`
- Tracks brace depth, handles quoted strings and escape sequences
- Extracts complete JSON substrings when depth returns to 0
- Returns `[{ parsed, raw }]` — both the JS object and original text for stripping
- Used by both `_parseToolCallsFromText` (WU-1) and the native tool_calls path (WU-2)

**Rewritten `_parseToolCallsFromText(text, tools)`:**
- Replaced regex with `_extractJsonObjects()` call
- Checks each JSON candidate for `name`/`function_name` field
- Tool name normalization: strips `mcp__paloma__` prefix when exact match fails
- Diagnostic logging at every step (attempt, candidate found, success, rejection, unknown tool name)

**Text stripping in `_streamChat` (native tool_calls path):**
- When `collectedToolCalls.length > 0`, runs `_extractJsonObjects` on `fullAssistantText`
- Removes all matched JSON substrings from the text
- Strips leftover markdown code fence markers
- Trims result — cleaned text used in the `assistantMessage`
- Prevents double-display of raw JSON + tool execution result

**No deviations from the plan.**

---

#### WU-3: Update OLLAMA_INSTRUCTIONS in src/prompts/base
- **Feature:** System Prompt Improvements
- **Status:** pending
- **Files:** src/prompts/base.js
- **Scope:** Update OLLAMA_INSTRUCTIONS in src/prompts/base.js to strengthen function calling instructions and anti-hallucination guardrails for local models.
- **Acceptance:** System prompt clearly instructs model to use native function calling, never write JSON as text, never fabricate results.
