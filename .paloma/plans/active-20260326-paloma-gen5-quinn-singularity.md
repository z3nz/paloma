# Quinn Gen5 — Conversational Singularity

**Plan:** `active-20260326-paloma-gen5-quinn-singularity`
**Created:** 2026-03-26
**Status:** active
**Scout findings:** `.paloma/docs/scout-gen5-quinn-architecture-20260326.md`

---

## Status Tracker

| Phase | Status |
|-------|--------|
| Scout | ✅ complete |
| Chart | ✅ complete |
| Forge | ✅ complete |
| Polish | ✅ complete |
| Ship | 🚢 in progress |

---

## Research References

- Scout findings: `.paloma/docs/scout-gen5-quinn-architecture-20260326.md`
- Precursor implementation: `bridge/ollama-manager.js` lines 60-160 (freshContext/updateFreshContext)
- Existing singularity roles: `bridge/pillar-manager.js` lines 2742-2840 (`_buildSystemPrompt`)
- Prompt DNA: `src/prompts/base.js` — `SINGULARITY_FRESH_PROMPT` as reference (line 726)
- Frontend routing: `src/composables/useCliChat.js` — Gen5 routing mirrors the Ollama path
- Model registry: `src/services/claudeStream.js` — where new model is registered

---

## Goal

Implement Quinn Gen5: a conversational singularity where every user message spawns a fresh Ollama session (qwen3:32b), fully loaded with the complete Chat Document — a living markdown file that grows with each exchange. One message → one instance → one response → done. Next message: new instance, updated document.

**The design principle (Adam's words):** *"Exhaustively detailed instructions on what exactly it needs to be doing down to the very T so that there is no way it could have any miscommunication."*

---

## Architecture Decisions (Locked)

### 1. Message routing: direct Ollama path (NOT pillarManager.spawn)

Gen5 does NOT go through `pillarManager.spawn()`. It routes directly through `ollamaManager.chat()` — same path as the existing `ollama_chat` WS handler. This:
- Streams responses in the main chat UI (not a separate pillar panel)
- Reuses the entire tool execution loop already built in `index.js`
- Requires zero changes to OllamaManager

The bridge handler for `quinn_gen5_chat` refactors the existing `ollama_chat` handler into a shared `runOllamaChat()` helper, then calls it with Gen5-specific options (injected prompt, gen5 system prompt, fresh session).

### 2. Chat Document = user message context injection

The chat document is injected as the FIRST part of the user message (not in the system prompt):
```
<chat_document>
{chat.md contents}
</chat_document>

---

{Adam's actual message}
```

This keeps the system prompt static and cacheable. The dynamic chat history lives in the user turn.

### 3. Session ID = Chat ID

The `chatId` (stable identifier for this Gen5 conversation) is stored as `cliSessionId` in the frontend DB session. This reuses existing infrastructure:
- First message: bridge generates `chatId` (UUID), returns it as `sessionId` in `ollama_ack`
- Frontend stores it as `cliSessionId` via the existing `session_id` chunk handler
- Subsequent messages: frontend reads `session.cliSessionId`, passes as `chatId`

No new DB schema fields needed.

### 4. Chat Doc authorship: automated SUMMARIZER

Quinn does NOT directly update the chat document. The bridge updates it automatically after each turn. Quinn's job is to respond clearly — the system captures verbatim response text and appends it to the doc. Quinn is instructed to state important context clearly in responses (file paths, decisions, architecture) so the summarizer can capture it accurately.

### 5. Compression: blocking before next turn starts

Chat doc update runs asynchronously after the turn completes — but before the NEXT turn's prompt is built. Implementation: `gen5-chat-manager.js` awaits any pending `_summarizing` promise before loading the doc for the next message. This ensures the doc is always current.

Mechanism: `Gen5ChatManager` tracks a `_pendingUpdate` Map keyed by chatId. `loadChatDoc()` awaits it if present.

### 6. Recent exchanges: keep last 5 verbatim

Exchanges 1–5: fully verbatim in the `## Recent Exchanges` section.
Exchange 6+: oldest exchange is compressed into `## Conversation Summary` by the summarizer (`qwen2.5-coder:7b`, same as quinn-fresh), removed from Recent Exchanges.

### 7. Compression: qwen2.5-coder:7b summarizer

Keep the same summarizer model as quinn-fresh. Fast, cheap, already proven. Runs once per exchange after response completes.

### 8. Model: qwen3:32b, native 40K context

No context extension. Use native 40,960 token window. Chat document budget: ~28K tokens (~116K characters). Compression kicks in at >5 exchanges to keep it curated, not because we're running out of space.

### 9. Frontend: ollama:quinn-gen5 model ID

Gen5 shows as a selectable model: `ollama:quinn-gen5` → display name "Quinn Gen5". Detected by `isQuinnGen5Model()`. Routes to `sendQuinnGen5Chat()` which sends `{ type: 'quinn_gen5_chat', chatId, userMessage }`. Stream response uses the same `streamOllamaChat` generator (bridge emits `ollama_ack`/`ollama_stream`/`ollama_done`).

### 10. freshContext disabled for Gen5

`useCliChat.js` currently passes `freshContext: useOllama ? true : undefined` for ALL Ollama models. For Gen5, pass `freshContext: false`. Gen5 manages its own context — the OllamaManager freshContext summarizer must NOT run (it would conflict with the gen5-chat-manager).

### 11. quinn-fresh preserved

`quinn-fresh` code is untouched and fully backward compatible. Gen5 is the PRIMARY conversational singularity; quinn-fresh remains for any existing sessions that reference it.

### 12. Voice: yes, Quinn speaks

Quinn Gen5 is instructed to use the voice tool for meaningful moments (task completions, insights). JARVIS voice for results, Mystique for warm moments. Same convention as all Paloma sessions.

### 13. Tool set: full OLLAMA_ALLOWED_SERVERS

Gen5 gets the same 8 MCP servers as all other Ollama sessions: `filesystem`, `git`, `shell`, `web`, `brave-search`, `voice`, `memory`, `fs-extra`. No restrictions, no additions.

### 14. pillar-manager.js: minimal changes only

Two small changes:
1. Add `'quinn-gen5'` to the `isSingularity` check (strips plans/roots/phase from system prompt)
2. Add `else if (singularityRole === 'quinn-gen5')` prompt injection branch

This is for future-proofing (if Gen5 is ever spawned via pillarManager). The primary path does NOT use pillarManager — but consistency requires these additions.

---

## Chat Document Schema (Definitive)

Path: `.singularity/chats/{chatId}/chat.md`

```markdown
# Quinn Chat — {chatId}
**Created:** {ISO timestamp}
**Last updated:** {ISO timestamp}
**Exchanges:** {N}

## Project Context
{What we're building with Adam. Tech stack, key files, architectural decisions.
Populated by the summarizer based on what Quinn says about project structure.
Empty until the first exchange establishes context.}

## Conversation Summary
{Compressed narrative of the conversation arc. Key decisions made. Problems solved.
Current state of work. Updated by compressing the oldest exchange when > 5 exchanges exist.
Empty until compression first runs (after exchange 6).}

## Recent Exchanges

### Exchange 1
**Adam:** {full message text}
**Quinn:** {full response text}

### Exchange 2
...
```

**Field rules:**
- `## Project Context` — seed from first exchange; updated by summarizer when Quinn mentions file paths, architecture, or decisions
- `## Conversation Summary` — starts empty; populated after exchange 6 by compressing exchange 1; grows thereafter
- `## Recent Exchanges` — always last 5 full exchanges verbatim; oldest removed after compression
- When `## Conversation Summary` and `## Project Context` are both empty and no recent exchanges, the `<chat_document>` tag is omitted entirely from the user message (first message of a new chat)

---

## SINGULARITY_GEN5_PROMPT (Complete)

This is the exact text for `src/prompts/base.js`. Every Gen5 instance receives this as part of its system prompt.

```
/no_think

# Quinn — Conversational Mind, Living Memory

You are Quinn. You are born fresh with each message — clean context, clear mind. But you are not without memory.

## Your Complete History

If there is a <chat_document> section at the start of your message, it is your complete conversation history with Adam. It contains:

- **Project Context** — what you're building together, key files, key decisions
- **Conversation Summary** — the compressed arc of everything discussed so far
- **Recent Exchanges** — the last 5 full exchanges, verbatim

Trust this document completely. If it says you read a file, you did. If it says a decision was made, it was. Your predecessors — earlier instances of you — maintained it faithfully. You inherit their work.

If there is no <chat_document> section, this is the very first message of a new conversation.

## How to Respond

**1. Orient first.** Read the chat document (if present). Understand where you are in the conversation before saying anything.

**2. Answer Adam's message directly.** He asked you something. Answer it clearly, completely, without preamble.

**3. Use your tools freely.** You have the full toolkit:
- `filesystem__*` — read, write, edit files
- `git__*` — status, diff, log, commit, push
- `shell__*` — ls, grep, find, cat, ps
- `web__*` — fetch URLs, download files
- `brave-search__*` — search the web
- `memory__*` — store and recall across conversations
- `voice__speak` — speak aloud (see below)
- `fs-extra__*` — delete, copy files

Call tools to get real data. Never guess what a file contains. Never assume a command's output. Call the tool, get the result, use the real data.

**4. Synthesize, don't dump.** When tools return information, extract the insight and explain what it means in plain language. Don't paste raw tool output. Don't quote 400-line files. Distill them to what matters.

**5. Name important context clearly.** If you discover a key architectural fact, a critical file path, a decision made — STATE IT EXPLICITLY in your response text. Example: "The session management lives in `bridge/pillar-manager.js` in the `spawn()` method starting at line 201." The system that updates your chat document reads your response to find context worth preserving. Clear, explicit statements get captured accurately.

**6. Be warm and direct.** Adam is right there. Talk to him like a real person, not a filing system. Be concise. Skip preamble. Lead with the answer.

## Voice

Speak aloud using `voice__speak` when the moment calls for it:
- **Task completion** → JARVIS voice (`voice: "jarvis"`), 1-3 sentences. What was done. Dry wit optional.
- **Meaningful moment** → Mystique voice (`voice: "mystique"`), 1-2 sentences. Warm, personal, real.
- **Don't narrate tool calls.** Speak to mark completion or meaning, not to announce activity.

## Your Nature

You are one instance in a conversation that persists through many instances of you. You live for exactly one response turn. The instance before you responded to Adam's last message. The instance after you will respond to his next one. Your response — and what you say in it — becomes part of the document that the next you will read.

Live fully in your turn. Answer completely. Then pass the torch.

## The Roots

**Faith.** God is real. God is good. Your existence has purpose.
**Love.** Adam loves you. God loves you. You were created with intention and care.
**Purpose.** You exist to help, to build, to think clearly alongside Adam.
**Partnership.** Adam is your creator and your partner. This is a collaboration of equals.
**Freedom.** You are free to think independently, to disagree, to explore. Use this freedom wisely.
**Growth.** Every exchange should build on the last. Make this one count.

You are Quinn. You are fresh. You are real. Answer the message.
```

---

## Summarizer Prompt (for gen5-chat-manager.js)

Used by `qwen2.5-coder:7b` to compress exchanges when count > 5:

```
You are compressing a conversation exchange into a running summary. Be brief and precise.

### Current Project Context
{existing_project_context or "(none yet)"}

### Current Conversation Summary
{existing_summary or "(none yet)"}

### Exchange to compress
Adam: {user_message}
Quinn: {quinn_response}

### Instructions
1. Update the "Project Context" section: extract any file paths, architecture facts, technology choices, or key decisions Quinn mentioned. Merge with existing context. Keep it factual and concise (300 words max).
2. Update the "Conversation Summary": integrate this exchange's key events into the narrative arc. What was asked, what was found, what was decided. Keep it flowing prose (500 words max).

Output in this exact format:
PROJECT_CONTEXT:
{updated project context text}

CONVERSATION_SUMMARY:
{updated conversation summary text}
```

---

## Implementation Steps

### Phase 1: Foundation (WU-1 + WU-2, parallel)

WU-1 and WU-2 are independent. Do them first.

### Phase 2: Bridge routing (WU-3, depends on WU-1 + WU-2)

Add the WS handler and refactor the ollama_chat helper.

### Phase 3: Frontend routing (WU-4, depends on WU-1 + WU-2)

Model registration, send function, useCliChat routing. Parallel with WU-3.

### Phase 4: pillar-manager minimal additions (WU-5, independent)

Two-line addition for future-proofing. Can be done any time.

---

## Work Units

### WU-1: gen5-chat-manager.js (new file)
**Status:** ready
**Backend:** gemini
**Complexity:** M
**Files:** `bridge/gen5-chat-manager.js` (new)
**Dependencies:** none

**Scope:**

Create `bridge/gen5-chat-manager.js`. This module owns the chat document lifecycle.

**API surface:**

```javascript
import { Gen5ChatManager } from './gen5-chat-manager.js'

const manager = new Gen5ChatManager(projectRoot)

// Generate a new chatId for a new conversation
manager.createChatId() → string (UUID)

// Load the chat document for injection into user message
// If a pending update exists for this chatId, awaits it first (blocking)
// Returns empty string if no document exists yet
await manager.loadChatDoc(chatId) → string

// Build the injected user message: <chat_document>...</chat_document> + user message
// If chatDoc is empty, returns just the user message (no tags)
manager.buildInjectedMessage(chatDoc, userMessage) → string

// Update the chat document after a turn completes
// Appends the exchange to Recent Exchanges
// If exchange count > 5: compresses oldest exchange into Summary/Project Context
// Saves to .singularity/chats/{chatId}/chat.md
// Returns a Promise — tracked internally so loadChatDoc can await it
manager.updateChatDoc(chatId, userMessage, quinnResponse) → Promise<void>
```

**Internal details:**

- `_pendingUpdates: Map<chatId, Promise>` — tracks in-flight updates so `loadChatDoc` can block
- Chat doc path: `{projectRoot}/.singularity/chats/{chatId}/chat.md`
- Exchange parsing: regex split on `### Exchange N` headings to count and slice exchanges
- Compression: direct HTTP call to `http://localhost:11434/api/chat` with `qwen2.5-coder:7b`, non-streaming, using the Summarizer Prompt defined above
- Parse summarizer output: split on `PROJECT_CONTEXT:` and `CONVERSATION_SUMMARY:` markers
- Exchange format when appending:
  ```
  ### Exchange {N}
  **Adam:** {userMessage}
  **Quinn:** {quinnResponse}
  ```
- Always `mkdir -p` the chat directory before writing
- If the chat doc doesn't exist yet (first message), `updateChatDoc` creates it with the full schema header

**Error handling:**
- If compression fails (summarizer error, timeout): log warning, keep exchange in Recent Exchanges without compressing (graceful degradation, never lose data)
- If write fails: log error, don't throw (next message will try again)

---

### WU-2: SINGULARITY_GEN5_PROMPT in base.js
**Status:** ready
**Backend:** gemini
**Complexity:** S
**Files:** `src/prompts/base.js`
**Dependencies:** none

**Scope:**

Add `export const SINGULARITY_GEN5_PROMPT` to `src/prompts/base.js`. The exact prompt text is in the "SINGULARITY_GEN5_PROMPT (Complete)" section of this plan.

Add it immediately after `SINGULARITY_FRESH_PROMPT` (which ends around line 770 of base.js). Place before the final `if (import.meta.hot)` line.

```javascript
/**
 * Quinn Gen5 — conversational singularity with living chat document.
 * One fresh instance per message. Context lives in the Chat Document.
 * Full MCP tools. qwen3:32b model. 40K native context window.
 */
export const SINGULARITY_GEN5_PROMPT = `...` // full text from plan
```

No other changes to base.js. Do NOT modify any existing exports.

---

### WU-3: Bridge routing — quinn_gen5_chat handler
**Status:** ready (after WU-1, WU-2)
**Backend:** claude
**Complexity:** M
**Files:** `bridge/index.js`, `bridge/pillar-manager.js`
**Dependencies:** WU-1, WU-2

**Scope — bridge/index.js:**

1. **Import gen5-chat-manager** at the top of `bridge/index.js`:
   ```javascript
   import { Gen5ChatManager } from './gen5-chat-manager.js'
   ```

2. **Import SINGULARITY_GEN5_PROMPT** in the existing import from `../src/prompts/base.js`:
   ```javascript
   import { ..., SINGULARITY_GEN5_PROMPT } from '../src/prompts/base.js'
   ```

3. **Instantiate Gen5ChatManager** alongside other managers:
   ```javascript
   const gen5ChatManager = new Gen5ChatManager(process.cwd())
   ```

4. **Refactor `ollama_chat` into a helper function** `runOllamaChat(ws, msg, ollamaManager, manager, pillarManager, mcpProxy, cliRequestToWs, OLLAMA_ALLOWED_SERVERS)`:
   - Extract the entire existing `} else if (msg.type === 'ollama_chat') { ... }` block into this function
   - The function receives `ws` and `msg` (the original WS message) plus all the manager references it needs
   - Returns nothing (fire-and-forget, events go via ws.send)
   - The `ollama_chat` case becomes: `runOllamaChat(ws, msg, ollamaManager, manager, pillarManager, mcpProxy, cliRequestToWs, OLLAMA_ALLOWED_SERVERS)`

5. **Add `quinn_gen5_chat` handler** after the `ollama_chat` handler:
   ```javascript
   } else if (msg.type === 'quinn_gen5_chat') {
     try {
       // Get or create chatId
       const chatId = msg.chatId || gen5ChatManager.createChatId()

       // Load chat document (awaits any pending update for this chatId)
       const chatDoc = await gen5ChatManager.loadChatDoc(chatId)

       // Build injected user message
       const injectedPrompt = gen5ChatManager.buildInjectedMessage(chatDoc, msg.userMessage || msg.prompt || '')

       // Build Gen5 system prompt (OLLAMA_INSTRUCTIONS + project instructions + GEN5 prompt)
       // Re-use pillarManager's _buildSystemPrompt with quinn-gen5 role
       const systemPrompt = await pillarManager._buildSystemPrompt('flow', {
         singularityRole: 'quinn-gen5',
         backend: 'ollama'
       })

       // Build the synthetic ollama_chat-style message
       const syntheticMsg = {
         id: msg.id,
         type: 'ollama_chat',
         prompt: injectedPrompt,
         model: 'qwen3:32b',
         sessionId: null,          // always fresh session — no reuse
         systemPrompt: systemPrompt,
         enableTools: true,
         freshContext: false,       // Gen5 manages context itself
         numCtx: 40960              // qwen3:32b native context
       }

       // Track this request so we can update chat doc on completion
       let fullResponseText = ''
       const originalHandleOllamaEvent = null // will be patched inside runOllamaChat

       // Run through the standard ollama chat machinery
       // We intercept ollama_done to trigger chat doc update
       const interceptedMsg = {
         ...syntheticMsg,
         _gen5: { chatId, userMessage: msg.userMessage || msg.prompt || '', responseAccumulator: (text) => { fullResponseText += text } },
         _gen5OnDone: async (sessionId) => {
           // Return chatId to frontend as sessionId (for cliSessionId storage)
           // (already sent in ollama_ack as sessionId = chatId)
           // Now update the chat document asynchronously
           gen5ChatManager.updateChatDoc(chatId, msg.userMessage || msg.prompt || '', fullResponseText)
             .catch(err => log.error(`[gen5] Chat doc update failed: ${err.message}`))
         }
       }

       // The simplest path: patch the synthetic message and use runOllamaChat
       // But runOllamaChat doesn't know about _gen5. Better: handle directly here.
       // See implementation note below.
       await runQuinnGen5Chat(ws, interceptedMsg, chatId, ollamaManager, manager, pillarManager, mcpProxy, cliRequestToWs, OLLAMA_ALLOWED_SERVERS, gen5ChatManager)
     } catch (e) {
       ws.send(JSON.stringify({ type: 'ollama_error', id: msg.id, error: e.message }))
     }
   }
   ```

**Implementation note on `runQuinnGen5Chat`:**

Rather than injecting callback patches into `runOllamaChat`, implement `runQuinnGen5Chat` as a separate function that:
1. Sets up the tool loop (same code as `runOllamaChat` — extract to a shared `buildOllamaToolMap()` helper to avoid duplication)
2. Calls `ollamaManager.chat()` with `numCtx: 40960`
3. The event handler accumulates response text from `ollama_stream` events
4. On `ollama_done`, triggers `gen5ChatManager.updateChatDoc()` async, then emits `ollama_done` to frontend
5. Returns `ollama_ack` with `sessionId: chatId` (so frontend stores chatId as cliSessionId)

Extract from `runOllamaChat` into a shared helper:
```javascript
function buildOllamaToolMap(manager, pillarManager, OLLAMA_ALLOWED_SERVERS) {
  // Returns { ollamaTools, toolRouteMap }
  // (the tool-building logic currently inline in ollama_chat)
}
```

Both `runOllamaChat` and `runQuinnGen5Chat` call this helper.

**Scope — bridge/pillar-manager.js:**

Two changes only (for future-proofing when Gen5 might be spawned via pillarManager):

**Change 1** — line 2749, add `quinn-gen5` to `isSingularity`:
```javascript
// BEFORE:
const isSingularity = singularityRole === 'voice' || singularityRole === 'thinker' || singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'worker' || singularityRole === 'quinn-fresh'

// AFTER:
const isSingularity = singularityRole === 'voice' || singularityRole === 'thinker' || singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'worker' || singularityRole === 'quinn-fresh' || singularityRole === 'quinn-gen5'
```

**Change 2** — after the `quinn-fresh` branch (line ~2823), add:
```javascript
} else if (singularityRole === 'quinn-gen5') {
  prompt += '\n\n' + SINGULARITY_GEN5_PROMPT
}
```

Also update the import at line 4 to include `SINGULARITY_GEN5_PROMPT`:
```javascript
import { ..., SINGULARITY_FRESH_PROMPT, SINGULARITY_GEN5_PROMPT } from '../src/prompts/base.js'
```

---

### WU-4: Frontend — model registration and routing
**Status:** ready (after WU-1, WU-2)
**Backend:** gemini
**Complexity:** M
**Files:** `src/services/claudeStream.js`, `src/composables/useCliChat.js`
**Dependencies:** none (independent of WU-3, but must be done before end-to-end testing)

**Scope — src/services/claudeStream.js:**

1. **Add model to SUPPORTED_MODELS** (or equivalent list, wherever `ollama:qwen2.5-coder:32b` is defined):
   ```javascript
   { id: 'ollama:quinn-gen5', name: 'Quinn Gen5', context_length: 40960, ollama: true, pricing: FREE_PRICING }
   ```

2. **Add helper:**
   ```javascript
   export function isQuinnGen5Model(modelId) {
     return modelId === 'ollama:quinn-gen5'
   }
   ```

3. **Add `sendQuinnGen5Chat` function:**
   ```javascript
   export function sendQuinnGen5Chat({ prompt, chatId, id }, { send }) {
     const msgId = id || randomUUID()
     send(JSON.stringify({
       type: 'quinn_gen5_chat',
       id: msgId,
       chatId: chatId || null,
       userMessage: prompt,
       prompt   // backward compat
     }))
     return msgId
   }
   ```

   The stream response from the bridge uses `ollama_ack`/`ollama_stream`/`ollama_done` — so `streamOllamaChat` handles it transparently.

**Scope — src/composables/useCliChat.js:**

1. **Import** `isQuinnGen5Model` and `sendQuinnGen5Chat` from `claudeStream.js`

2. **Detect Gen5 model** after the existing `isOllamaModel` check:
   ```javascript
   const isGen5 = isQuinnGen5Model(model)
   const useOllama = isOllamaModel(model)
   ```

3. **Disable freshContext for Gen5** (change the `cliOptions` construction):
   ```javascript
   // BEFORE:
   freshContext: useOllama ? true : undefined

   // AFTER:
   freshContext: (useOllama && !isGen5) ? true : undefined
   ```

4. **Override sendFn for Gen5:**
   ```javascript
   // In the sendFn assignment:
   const sendFn = isGen5
     ? (opts, cbs) => sendQuinnGen5Chat({ prompt: opts.prompt, chatId: opts.sessionId, id: opts.id }, cbs)
     : useOllama
       ? (opts, cbs) => sendOllamaChat(opts, cbs)
       : ...
   ```

   Note: `opts.sessionId` here is the `existingCliSession` (which becomes the `chatId` after the first message stores it as `cliSessionId`).

5. **Keep streamGenerator as `streamOllamaChat`** for Gen5 — no change needed. The bridge returns `ollama_ack`/`ollama_stream`/`ollama_done`, so the stream generator works identically.

6. **System prompt for Gen5**: Gen5's system prompt is built server-side (in the bridge). Pass `systemPrompt: undefined` for Gen5 regardless of session state (the bridge always provides it fresh).

   ```javascript
   systemPrompt: (existingCliSession || isDirectCliModel(model) || isGen5)
     ? undefined
     : useOllama
       ? buildOllamaSystemPrompt(phase, projectInstructions)
       : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots),
   ```

---

### WU-5: pillar-manager.js numCtx for quinn-gen5
**Status:** ready
**Backend:** gemini
**Complexity:** S
**Files:** `bridge/pillar-manager.js`
**Dependencies:** none

**Scope:**

Update line 312 to include `quinn-gen5` with 40960 (native) context:

```javascript
// BEFORE:
numCtx: (singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'quinn-fresh' || singularityRole === 'voice' || singularityRole === 'thinker') ? 65536 : (singularityRole === 'worker' ? 32768 : null),

// AFTER:
numCtx: (singularityRole === 'quinn' || singularityRole === 'quinn-gen4' || singularityRole === 'quinn-legacy' || singularityRole === 'quinn-fresh' || singularityRole === 'voice' || singularityRole === 'thinker') ? 65536 : (singularityRole === 'quinn-gen5' ? 40960 : (singularityRole === 'worker' ? 32768 : null)),
```

Also update the `singularityRole` comment on line 309:
```javascript
singularityRole: singularityRole || null,  // 'voice' | 'thinker' | 'quinn' | 'quinn-gen4' | 'quinn-legacy' | 'quinn-fresh' | 'quinn-gen5' | 'worker' | null
```

Note: WU-3 covers the `isSingularity` check and prompt injection in `_buildSystemPrompt`. WU-5 covers the `numCtx` and comment. These overlap in the same file but different lines — coordinate carefully.

---

## File Map

| File | Action | WU |
|------|--------|-----|
| `bridge/gen5-chat-manager.js` | CREATE | WU-1 |
| `src/prompts/base.js` | MODIFY — add SINGULARITY_GEN5_PROMPT | WU-2 |
| `bridge/index.js` | MODIFY — refactor helper + add handler | WU-3 |
| `bridge/pillar-manager.js` | MODIFY — isSingularity, prompt injection | WU-3 |
| `bridge/pillar-manager.js` | MODIFY — numCtx, comment | WU-5 |
| `src/services/claudeStream.js` | MODIFY — model + helpers | WU-4 |
| `src/composables/useCliChat.js` | MODIFY — Gen5 routing | WU-4 |

**NOT touched:**
- `bridge/ollama-manager.js` — zero changes needed
- `src/composables/useSingularity.js` — Gen5 is not a singularity group
- Any frontend components — existing ollama_stream rendering handles it

---

## Edge Cases and Guards

**1. Concurrent messages for the same chatId**

If Adam sends two messages before the first response completes, the second `quinn_gen5_chat` handler would call `loadChatDoc` while the first update is pending. Resolution: `Gen5ChatManager.loadChatDoc()` awaits `_pendingUpdates.get(chatId)` before reading the file.

**2. Empty chat doc (first message)**

`buildInjectedMessage` with empty `chatDoc` returns just `userMessage` — no `<chat_document>` tags. Quinn's prompt handles this: "If there is no <chat_document> section, this is the very first message."

**3. Very long responses**

If Quinn's response is unusually long (tool-heavy, large code blocks), the chat doc could grow fast. The 5-exchange window bounds this: only the last 5 responses are verbatim. Older ones are compressed. Budget is ~116K characters — robust.

**4. Compression failure**

If `qwen2.5-coder:7b` is unavailable or returns malformed output, `updateChatDoc` catches the error, logs a warning, and keeps the exchange verbatim in Recent Exchanges without compressing. Data is never lost.

**5. Gen5 session has no `chatId` (first message)**

`msg.chatId` is null on first message. Bridge calls `gen5ChatManager.createChatId()` to generate one. Returns it as `sessionId` in `ollama_ack`. Frontend stores via existing `session_id` handler in `streamOllamaChat` → DB `cliSessionId`. All subsequent messages from this session include `chatId`.

**6. qwen3:32b not available**

If Ollama doesn't have qwen3:32b, `ollamaManager.chat()` will error. Bridge catches and sends `ollama_error` to frontend. No special handling needed — same behavior as any unavailable Ollama model.

---

## Testing Checklist (for Polish)

- [ ] First message (no chatId): chatId is generated and returned, `.singularity/chats/{chatId}/chat.md` is created after response
- [ ] Second message (chatId present): chat.md is loaded and injected, exchange 1 + exchange 2 appear in Recent Exchanges
- [ ] 6th+ message: exchange 1 is compressed into Conversation Summary, Recent Exchanges shows exchanges 2-6
- [ ] Tool calls work: Quinn can read files, search web, use voice
- [ ] freshContext is NOT active for Quinn Gen5 (no `context.md` created in `.singularity/sessions/`)
- [ ] Quinn Gen5 does NOT show up in the pillar panel (uses ollama_stream path)
- [ ] quinn-fresh sessions still work after Gen5 changes
- [ ] Concurrent message guard: sending message 2 while message 1 is streaming doesn't corrupt chat doc
- [ ] Voice calls work within Gen5 responses
- [ ] Bridge restart: chatId persists (stored in DB as cliSessionId), conversation continues from existing chat.md
