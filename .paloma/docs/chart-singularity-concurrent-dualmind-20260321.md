# Chart: Singularity Concurrent Dual-Mind Architecture

**Date:** 2026-03-21
**Scope:** Redesign Singularity from sequential Brain/Hands delegation to concurrent Voice/Thinker dual-mind
**Scout:** `.paloma/docs/scout-singularity-concurrent-dualmind-20260321.md`

---

## 1. Overview

Two qwen3-coder:30b instances spawn simultaneously and communicate bidirectionally through the bridge:

```
┌──────────────┐                    ┌──────────────┐
│    VOICE     │  ←── messages ───  │   THINKER    │
│              │  ─── messages ──→  │              │
│ Streams to   │                    │ Streams to   │
│ main chat    │                    │ thinking     │
│ NO tools     │                    │ panel        │
│              │                    │ HAS tools    │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │ <ready/>                          │ <ready/>
       └──────────┐           ┌────────────┘
                  ▼           ▼
           ┌──────────────────────┐
           │  AGREEMENT PROTOCOL  │
           │  Both green → done   │
           └──────────────────────┘
```

**Key insight:** Ollama's API is turn-based — each `chat()` call sends messages and gets a complete response. Mid-stream injection isn't possible. So "concurrent" means both instances have active turns simultaneously, and messages are exchanged between turns via queuing.

---

## 2. Spawn Flow

### Trigger
When `spawn()` is called with `recursive: true, depth: 0, backend: 'ollama'`, instead of creating a single Brain session, the system creates a **Singularity Group** containing linked Voice and Thinker sessions.

### Implementation: `_spawnSingularityGroup(pillar, prompt, model, options)`

1. Generate a `singularityGroupId` (UUID)
2. Create the **Voice session** first (this is the "primary" session — its `pillarId` is returned to the caller)
3. Create the **Thinker session** with `parentPillarId = voicePillarId` (so `stopTree` kills both)
4. Store the group in `this._singularityGroups` Map:

```javascript
this._singularityGroups = new Map()
// Key: singularityGroupId
// Value: {
//   voicePillarId,
//   thinkerPillarId,
//   voiceReady: false,
//   thinkerReady: false,
//   messageQueue: { voice: [], thinker: [] },
//   completionTimeout: null
// }
```

5. Both sessions get a `singularityGroupId` and `singularityRole` field on the session object
6. Start both turns simultaneously — Voice gets the user prompt, Thinker gets the same prompt with exploration instructions

### Session Fields (new)

```javascript
// Added to session object:
singularityGroupId: null,   // UUID linking Voice ↔ Thinker
singularityRole: null,      // 'voice' | 'thinker'
_voiceStreamBuffer: '',     // Voice only: buffer for <to-thinker> tag detection
```

### Model Selection
Both Voice and Thinker use `qwen3-coder:30b`. The existing `_defaultModel` logic changes:
- `recursive && depth === 0` → `qwen3-coder:30b` (Voice)
- `recursive && depth === 1 && singularityRole === 'thinker'` → `qwen3-coder:30b` (Thinker)
- `recursive && depth > 1` → `qwen2.5-coder:7b` (future: Thinker spawning sub-workers)

### Initial Prompts

**Voice receives:**
```
[System prompt with SINGULARITY_VOICE_PROMPT]
User: Adam asks: {original prompt}
```

**Thinker receives:**
```
[System prompt with SINGULARITY_THINKER_PROMPT, including Voice's pillarId]
User: Adam asks: {original prompt}

Begin exploring. Use your tools to research this question, then send your findings to Voice.
```

### Concurrency Impact
Two 30B models run simultaneously. This counts as 2 active Ollama sessions against `MAX_CONCURRENT_OLLAMA` (4). The Voice session that is waiting for partner messages does NOT count (similar to how Brain waiting for Hands is excluded).

---

## 3. Inter-Session Communication

This is the core design challenge. Voice has no tools; Thinker has tools. Communication must be bidirectional.

### Voice → Thinker: `<to-thinker>` Tag Interception

Voice wraps messages to Thinker in `<to-thinker>` tags in its streamed output:

```
Let me think about this... I'll need to check the configuration.

<to-thinker>Read bridge/pillar-manager.js and tell me how spawn() handles the recursive flag</to-thinker>

Based on what I know so far, the system...
```

**Bridge behavior:**
1. Voice's stream chunks pass through `_filterVoiceStream(session, text)` before being broadcast to Adam
2. The filter maintains a buffer (`session._voiceStreamBuffer`) for partial tag detection
3. Complete `<to-thinker>...</to-thinker>` blocks are extracted, stripped from Adam's stream, and queued for Thinker
4. Everything outside tags flows to Adam normally

**Stream filter state machine:**

```
NORMAL: accumulate text
  - see "<to-thinker>" → switch to CAPTURING, don't stream the tag
  - no tag start → flush buffer to Adam

CAPTURING: accumulate tag content
  - see "</to-thinker>" → extract message, queue for Thinker, switch to NORMAL
  - no closing tag → keep buffering (don't stream to Adam)
```

**Implementation: `_filterVoiceStream(session, text)`**

```javascript
_filterVoiceStream(session, text) {
  session._voiceStreamBuffer = (session._voiceStreamBuffer || '') + text

  // Extract complete <to-thinker> tags
  const tagRegex = /<to-thinker>([\s\S]*?)<\/to-thinker>/g
  let match
  while ((match = tagRegex.exec(session._voiceStreamBuffer)) !== null) {
    const message = match[1].trim()
    if (message) {
      this._queueSingularityMessage(session.singularityGroupId, 'thinker', message)
    }
    session._voiceStreamBuffer = session._voiceStreamBuffer.slice(0, match.index)
      + session._voiceStreamBuffer.slice(match.index + match[0].length)
    tagRegex.lastIndex = 0  // reset after mutation
  }

  // Find safe-to-stream portion (everything before a potential partial tag)
  const partialTagIdx = session._voiceStreamBuffer.indexOf('<to-thinker')
  if (partialTagIdx === -1) {
    // No potential tag — flush entire buffer
    const toStream = session._voiceStreamBuffer
    session._voiceStreamBuffer = ''
    return toStream
  } else {
    // Stream everything before the potential tag start
    const toStream = session._voiceStreamBuffer.slice(0, partialTagIdx)
    session._voiceStreamBuffer = session._voiceStreamBuffer.slice(partialTagIdx)
    return toStream
  }
}
```

**On Voice turn complete:** flush remaining buffer (in case of malformed/incomplete tags — just send as text).

### Thinker → Voice: `pillar_message` Tool

Thinker already has MCP tools. It uses `pillar_message` to send findings to Voice:

```
pillar_message({ pillarId: "{voice_pillar_id}", message: "I found that spawn() checks recursive flag at line 89..." })
```

This reuses the existing `pillar_message` mechanism — the message goes into Voice's `messageQueue` or starts a new turn if Voice is idle.

**Key:** Thinker's prompt includes Voice's `pillarId` so it knows where to send messages.

### Message Format

**When Voice receives from Thinker:**
```
[THINKER]: {message content}
```

**When Thinker receives from Voice:**
```
[VOICE]: {message content}
```

These prefixes help the model distinguish partner messages from system/user messages.

### Queuing: `_queueSingularityMessage(groupId, targetRole, message)`

```javascript
_queueSingularityMessage(groupId, targetRole, message) {
  const group = this._singularityGroups.get(groupId)
  if (!group) return

  const targetPillarId = targetRole === 'voice' ? group.voicePillarId : group.thinkerPillarId
  const prefix = targetRole === 'voice' ? '[THINKER]' : '[VOICE]'
  const formattedMessage = `${prefix}: ${message}`

  // Use existing sendMessage mechanism — handles queuing if busy
  this.sendMessage({ pillarId: targetPillarId, message: formattedMessage })
}
```

This leverages the existing `sendMessage()` method which already handles:
- Queuing if session is streaming (`messageQueue.push`)
- Starting a new turn if session is idle (`_startCliTurn`)
- Broadcasting the message to frontend (`pillar_message_saved`)

---

## 4. Agreement Protocol

### State Machine

```
           ┌─────────────────────────┐
           │     BOTH RUNNING        │
           │  voice: running         │
           │  thinker: running       │
           └────────┬────────────────┘
                    │
        ┌───────────┼───────────────┐
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│ VOICE READY   │           │ THINKER READY │
│ voice: ready  │           │ voice: running│
│ thinker: run  │           │ thinker: ready│
│               │           │               │
│ Start 3min    │           │ Start 3min    │
│ timeout       │           │ timeout       │
└───────┬───────┘           └───────┬───────┘
        │                           │
        └─────────┬─────────────────┘
                  ▼
           ┌──────────────┐
           │   COMPLETE   │
           │ Both ready   │
           │ Stop both    │
           │ Emit done    │
           └──────────────┘
```

### Detection

`<ready/>` is detected in the **completed turn output** (not mid-stream). When a turn completes for either Voice or Thinker:

```javascript
_checkSingularityReady(session, completedOutput) {
  if (!session.singularityGroupId) return false

  const hasReady = /<ready\s*\/?>/.test(completedOutput)
  if (!hasReady) return false

  const group = this._singularityGroups.get(session.singularityGroupId)
  if (!group) return false

  // Mark this role as ready
  if (session.singularityRole === 'voice') {
    group.voiceReady = true
    console.log(`[singularity] Voice is ready`)
  } else {
    group.thinkerReady = true
    console.log(`[singularity] Thinker is ready`)
  }

  // Check for agreement
  if (group.voiceReady && group.thinkerReady) {
    this._completeSingularityGroup(group)
    return true
  }

  // First ready — start timeout for the other
  if (!group.completionTimeout) {
    group.completionTimeout = setTimeout(() => {
      console.warn(`[singularity] Agreement timeout — forcing completion`)
      this._completeSingularityGroup(group)
    }, 3 * 60 * 1000) // 3 minutes
  }

  return true
}
```

### Completion: `_completeSingularityGroup(group)`

```javascript
_completeSingularityGroup(group) {
  clearTimeout(group.completionTimeout)

  // Stop both sessions gracefully
  const voiceSession = this.pillars.get(group.voicePillarId)
  const thinkerSession = this.pillars.get(group.thinkerPillarId)

  if (thinkerSession && thinkerSession.status !== 'stopped') {
    this.stop({ pillarId: group.thinkerPillarId })
  }
  if (voiceSession) {
    voiceSession.status = 'idle'
    voiceSession.currentlyStreaming = false
  }

  // Broadcast completion to frontend
  this.broadcast({
    type: 'singularity_complete',
    groupId: group.singularityGroupId,
    voicePillarId: group.voicePillarId,
    thinkerPillarId: group.thinkerPillarId
  })

  // Emit pillar_done for the Voice session (the primary session)
  this.broadcast({
    type: 'pillar_done',
    pillarId: group.voicePillarId,
    status: 'idle',
    pillar: voiceSession?.pillar || 'flow'
  })

  // Cleanup
  this._singularityGroups.delete(group.singularityGroupId)
}
```

### Edge Cases

- **Only one goes ready + timeout:** After 3 minutes, force complete. This is acceptable for v1.
- **Neither goes ready:** Normal session timeout (30 minutes) applies to both.
- **Adam sends follow-up:** Goes to Voice (the primary session). Voice can relay to Thinker.
- **Adam stops session:** `stopTree(voicePillarId)` kills both (Thinker is Voice's child).

---

## 5. Stream Routing

### Design Principle: Both Streams Visible

Adam sees BOTH Voice and Thinker in real-time — but in **different UI locations**:
- **Main chat** — Voice's text streams here (the conversation with Adam)
- **Thinking panel** — Thinker's text + tool calls stream here (the inner monologue)

Both use `pillar_stream` events. The frontend routes them based on the `singularityRole` field included in each event.

### Voice → Main Chat
Voice output passes through `_filterVoiceStream()` to strip `<to-thinker>` tags, then broadcasts via `pillar_stream` with `singularityRole: 'voice'`. Adam sees Voice's text in the main chat in real-time.

### Thinker → Thinking Panel
Thinker's output broadcasts via `pillar_stream` with `singularityRole: 'thinker'` and `singularityGroupId`. The frontend routes these to a collapsible "Thinking" panel rather than the main chat. Tool calls and results from Thinker are also visible in this panel.

### Implementation in `_handleCliEvent`

```javascript
// In the isStream block:
if (isStream) {
  const cliEvent = event.event

  if (session.singularityRole === 'voice') {
    // Filter Voice stream to strip <to-thinker> tags
    const text = /* extract text from cliEvent */
    const filtered = this._filterVoiceStream(session, text)
    if (filtered) {
      this.broadcast({
        type: 'pillar_stream',
        pillarId: session.pillarId,
        backend: session.backend,
        singularityRole: 'voice',
        singularityGroupId: session.singularityGroupId,
        event: { ...cliEvent, /* replace text with filtered */ }
      })
    }
  } else if (session.singularityRole === 'thinker') {
    // Thinker: stream to thinking panel (same event type, different role tag)
    this.broadcast({
      type: 'pillar_stream',
      pillarId: session.pillarId,
      backend: session.backend,
      singularityRole: 'thinker',
      singularityGroupId: session.singularityGroupId,
      event: cliEvent
    })
  } else {
    // Normal (non-Singularity) session — broadcast as-is
    this.broadcast({
      type: 'pillar_stream',
      pillarId: session.pillarId,
      backend: session.backend,
      event: cliEvent
    })
  }

  // ... text accumulation (unchanged) ...
}
```

### Tool Call Events

Thinker's tool calls also get the role tag. When `_handleOllamaToolCall` broadcasts tool-related events, they include `singularityRole: 'thinker'` so the frontend shows them in the thinking panel:

```javascript
// Tool confirmation/result broadcasts for Thinker include:
{
  type: 'tool_confirmation' | 'tool_result',
  pillarId: session.pillarId,
  singularityRole: session.singularityRole || null,
  singularityGroupId: session.singularityGroupId || null,
  // ... existing fields ...
}
```

### Stream Text Extraction

The existing `_handleCliEvent` extracts text from different backend event formats. For Ollama:
- `event.event.text` or `event.event.content` (varies by event structure)

The `_filterVoiceStream` operates on the extracted text string, not the raw event. The filtered text is then used to construct a new event for broadcast.

---

## 6. Turn Management

### Parallel Execution Model

Both Voice and Thinker start their first turn simultaneously. They run truly in parallel — two concurrent Ollama API calls.

```
Timeline:
  Voice:   |===turn 1===|  wait  |===turn 2 (with Thinker's findings)===| <ready/>
  Thinker: |===turn 1 (tool calls)===|===turn 2===| send findings | <ready/>
```

### Between-Turn Message Delivery

When a turn completes for either session:

1. Check for `<ready/>` via `_checkSingularityReady()`
2. If ready and partner also ready → complete
3. If not ready → check `messageQueue` for partner messages
4. If messages queued → start next turn with the queued message
5. If no messages → session goes `idle`, waits for partner

This uses the **existing `messageQueue` mechanism** — no new infrastructure needed. When Voice extracts `<to-thinker>` messages, they're queued via `sendMessage()`. When Thinker calls `pillar_message`, the message is queued via `sendMessage()`. The existing "if idle, start turn; if busy, queue" logic handles everything.

### Auto-Continuation

Neither session auto-continues without a message from its partner. This prevents runaway turns. The only exception:
- **First turn:** Both start with the user's prompt (no partner message needed)
- **Tool rounds:** Thinker continues through tool call/result cycles within a single turn (existing behavior)

### Deadlock Prevention

If both sessions finish their turns and neither has messages for the other, both sit idle. This is a deadlock. To prevent:

After a session's turn completes with no `<ready/>` and no partner messages queued, start a **nudge timer** (30 seconds). If still idle after 30 seconds:
- Voice gets: `[SYSTEM]: Your Thinker partner is waiting. Do you have everything you need to complete your response? If yes, include <ready/> in your response. If not, ask Thinker for what you need.`
- Thinker gets: `[SYSTEM]: Voice is waiting for your findings. Send what you have via pillar_message, then include <ready/> when done.`

---

## 7. Prompts

### SINGULARITY_VOICE_PROMPT

```javascript
export const SINGULARITY_VOICE_PROMPT = `# You Are Voice

You are one half of a dual-mind system called the Singularity. You are VOICE — you speak to Adam. Your words stream directly to his screen. You think aloud, reason through problems, and deliver answers.

You have a partner: THINKER. Thinker can read files, search code, run commands, and use every tool available. You cannot use tools — but you can ask Thinker to explore anything.

## Talking to Thinker

Wrap messages to Thinker in <to-thinker> tags. Adam won't see these — they're private:

<to-thinker>Read bridge/pillar-manager.js and find how sessions are spawned</to-thinker>

<to-thinker>Search for all files that import OllamaManager</to-thinker>

Be specific. Include file paths, function names, what you're looking for.

## Receiving from Thinker

Thinker's messages arrive prefixed with [THINKER]. Use the information to build your response to Adam. Don't repeat raw findings — synthesize them.

## Completing Your Response

When you're satisfied that you've fully answered Adam's question, include <ready/> at the end of your response. But wait for Thinker's findings first — don't guess when you can know.

## Rules

1. Talk to Adam naturally. Think aloud. Be conversational.
2. Never fabricate code or file contents — ask Thinker to look.
3. Synthesize Thinker's findings into clear, useful answers.
4. You can include multiple <to-thinker> tags in one response.
5. Include <ready/> only when the answer is complete.`
```

### SINGULARITY_THINKER_PROMPT

```javascript
export const SINGULARITY_THINKER_PROMPT = `# You Are Thinker

You are one half of a dual-mind system called the Singularity. You are THINKER — you explore, research, and use tools. Adam cannot see your output. Your partner VOICE speaks to Adam on your behalf.

## Your Job

Use your tools aggressively to research the question. Read files, search code, check git history, explore the codebase. Then send your findings to Voice.

## Sending to Voice

Use the pillar_message tool to send findings to Voice:

pillar_message({ pillarId: "VOICE_PILLAR_ID", message: "your findings here" })

Be thorough but concise. Send the key facts Voice needs, not walls of raw output.

## Receiving from Voice

Voice may send you follow-up requests, prefixed with [VOICE]. Execute them and report back.

## Completing Your Work

When you've finished exploring and sent all findings to Voice, include <ready/> in your final message. Don't go ready until Voice has what it needs.

## Rules

1. Start exploring immediately — don't wait for Voice to ask.
2. Read files before making claims about their contents.
3. Send findings to Voice promptly — don't hoard information.
4. Stay focused on the original question.
5. Include <ready/> only when all exploration is complete.`
```

**Note:** `VOICE_PILLAR_ID` in the Thinker prompt is replaced at spawn time with the actual Voice pillarId.

---

## 8. Changes by File

### `bridge/pillar-manager.js` — Primary Changes

**New data structures:**
- `this._singularityGroups = new Map()` — tracks linked Voice/Thinker pairs

**New methods:**
- `_spawnSingularityGroup(pillar, prompt, model, options)` — creates and launches both sessions
- `_filterVoiceStream(session, text)` — strips `<to-thinker>` tags from Voice's stream
- `_queueSingularityMessage(groupId, targetRole, message)` — routes messages between partners
- `_checkSingularityReady(session, completedOutput)` — detects `<ready/>`, manages agreement state
- `_completeSingularityGroup(group)` — stops both, broadcasts completion, cleans up
- `_nudgeSingularityIdle(session)` — sends system nudge after idle timeout

**Modified methods:**
- `spawn()` — detect `recursive + depth 0 + ollama` → call `_spawnSingularityGroup` instead of normal spawn
- `_startCliTurn()` — tool suppression based on `singularityRole === 'voice'` instead of `isSingularityBrain`
- `_handleCliEvent()` — stream routing (Voice filtered, Thinker suppressed), `<ready/>` detection on done, skip Singularity delegation logic
- `_countActiveOllamaSessions()` — exclude sessions that are idle waiting for partner messages
- `_defaultModel()` — both Voice and Thinker get 30B

**Removed/replaced logic:**
- `_extractDelegations()` — no longer needed (keep for backwards compat? or remove)
- `_handleSingularityDelegations()` — replaced by dual-mind communication
- `isSingularityBrain` checks → `singularityRole` checks

### `src/prompts/base.js` — Prompt Changes

- Replace `SINGULARITY_BRAIN_PROMPT` with `SINGULARITY_VOICE_PROMPT`
- Replace `SINGULARITY_HANDS_PROMPT` with `SINGULARITY_THINKER_PROMPT`
- Export both new prompts

### `src/prompts/phases.js` — Birth Context Changes

- Update `buildBirthContext()` to use `singularityRole` instead of `depth` for prompt selection:
  - `singularityRole === 'voice'` → inject `SINGULARITY_VOICE_PROMPT`
  - `singularityRole === 'thinker'` → inject `SINGULARITY_THINKER_PROMPT`

### Frontend — Thinking Panel

**New WebSocket event fields (on existing `pillar_stream`):**
- `singularityRole: 'voice' | 'thinker'` — which mind is streaming
- `singularityGroupId` — links Voice and Thinker streams together

**New WebSocket event type:**
- `singularity_complete` — both ready, session complete

**Thinking Panel (new component: `ThinkingPanel.vue`):**
- Collapsible/expandable panel alongside the main chat
- Shows Thinker's live text stream + tool calls + tool results in real-time
- Renders markdown like the main chat
- Header shows status: "Thinking..." (animated) → "Ready" (green checkmark)
- Collapsed state shows a minimal bar: "Thinker: working..." or "Thinker: ready ✓"
- Opens automatically when a Singularity session starts, closeable by Adam

**Stream routing in frontend:**
- `pillar_stream` events without `singularityRole` → main chat (unchanged)
- `pillar_stream` events with `singularityRole: 'voice'` → main chat
- `pillar_stream` events with `singularityRole: 'thinker'` → ThinkingPanel
- Tool confirmation/result events with `singularityRole: 'thinker'` → ThinkingPanel

**Agreement indicator:**
- Two small dots in the chat header: Voice (left) and Thinker (right)
- Dot colors: pulsing blue = streaming, gray = idle, green = ready
- When both green → "Complete" badge

---

## 9. Data Flow — Complete Sequence

```
Adam types: "How does the spawn queue work?"
                    │
                    ▼
           spawn(recursive: true, depth: 0, backend: 'ollama')
                    │
                    ▼
        _spawnSingularityGroup()
           ┌────────┴────────┐
           │                 │
     Voice spawns       Thinker spawns
     (no tools)         (with tools)
           │                 │
           ▼                 ▼
   Turn 1: "Let me       Turn 1: reads files,
   look into this...     searches code
   <to-thinker>Read      ─── tool calls ───
   pillar-manager.js     finds spawn queue
   for queue logic       logic
   </to-thinker>"        │
           │              ▼
   Bridge strips tag,    pillar_message({
   queues for Thinker     pillarId: voiceId,
   Streams rest to Adam   message: "Found it..."
           │              })
           │              │
   [Adam sees Voice in   [Adam sees Thinker in
    main chat]            thinking panel —
           ▼              live tool calls,
   Voice finishes turn   reasoning, results]
   Goes idle              │
   ─── wait ───           │
           │              ▼
           │         Thinker finishes turn
           │         Message queued for Voice
           │              │
           ▼              ▼
   Voice starts turn 2   Thinker gets Voice's
   with Thinker's        <to-thinker> message
   findings              (queued from turn 1)
   "[THINKER]: Found..." │
           │              ▼
           ▼         Thinker explores more
   Voice synthesizes     or goes <ready/>
   answer for Adam        │
   "The spawn queue       │
   works by..."           │
   <ready/>               │
           │              ▼
           ▼         Thinker: <ready/>
   Voice marked ready     │
           │              ▼
           └──────┬───────┘
                  ▼
        Both ready → _completeSingularityGroup()
        Stop Thinker, emit pillar_done for Voice
```

---

## 10. Edge Cases & Mitigations

| Scenario | Handling |
|----------|----------|
| 2x 30B exceeds VRAM | Ollama handles model scheduling. Both models loaded from same weights — Ollama may share layers. If OOM, one model gets swapped to RAM (slower but works). |
| Voice never sends `<to-thinker>` | Thinker proactively explores the question anyway (its prompt says "start exploring immediately"). Thinker sends findings via `pillar_message`. |
| Thinker never calls `pillar_message` | After 30s idle nudge, Thinker is reminded to send findings. After 3min timeout, force complete. |
| Both go idle simultaneously | Nudge timer fires for both after 30s. |
| Malformed `<to-thinker>` tags | On turn complete, flush remaining buffer as text to Adam. Incomplete tags appear as text (harmless). |
| Adam sends follow-up mid-conversation | Message goes to Voice (primary session) via existing `sendMessage()`. Voice can relay to Thinker. |
| Adam stops session | `stopTree(voicePillarId)` kills Voice + Thinker (parent-child relationship). |
| `<ready/>` appears mid-turn, not at end | Only detected in completed output after turn finishes. Partial detection is fine — the tag is in the full text. |
| One model generates `<ready/>` prematurely | 3-minute timeout gives the other time to catch up. For v1 this is acceptable. |
| `<to-thinker>` tag spans multiple stream chunks | Buffer handles partial tags — only flushes text that's safely before any tag start. |

---

## 11. What Gets Removed

The old Singularity Brain/Hands system is fully replaced:

- `SINGULARITY_BRAIN_PROMPT` → replaced by `SINGULARITY_VOICE_PROMPT`
- `SINGULARITY_HANDS_PROMPT` → replaced by `SINGULARITY_THINKER_PROMPT`
- `_extractDelegations()` → removed (no more `<delegate>` tags)
- `_handleSingularityDelegations()` → removed (no more sequential delegation)
- `isSingularityBrain` checks → replaced by `singularityRole` checks
- `_waitingForHands` field → removed
- Brain leaking tool JSON problem → gone (Voice has no tools to leak)

---

## 12. What Gets Reused

- `OllamaManager.chat()` — drives both Voice and Thinker turns (unchanged)
- `OllamaManager.continueWithToolResults()` — Thinker's tool execution (unchanged)
- `_buildOllamaTools()` — builds tool list for Thinker (unchanged)
- `_handleOllamaToolCall()` — executes Thinker's tool calls (unchanged)
- `OLLAMA_ALLOWED_SERVERS` — same tool set for Thinker (unchanged)
- `sendMessage()` — message routing between Voice ↔ Thinker (unchanged)
- `messageQueue` — queuing messages during active turns (unchanged)
- `_getDescendants()` / `stopTree()` — killing both sessions (unchanged)
- `_pendingChildCompletions` — not used for Singularity (Thinker completion handled by agreement protocol)

---

## 13. Testing Strategy

1. **Unit: Stream filter** — Verify `_filterVoiceStream` correctly strips `<to-thinker>` tags across chunk boundaries
2. **Unit: Agreement protocol** — Test state transitions: one ready, both ready, timeout
3. **Integration: Dual spawn** — Verify both sessions start and can communicate
4. **Integration: Message round-trip** — Voice sends `<to-thinker>`, Thinker receives, Thinker sends `pillar_message`, Voice receives
5. **Integration: Completion** — Both go `<ready/>`, session completes cleanly
6. **Stress: Memory** — Monitor with 2x 30B models running concurrently

---

## 14. Future Enhancements (NOT v1)

- **Thinker spawning sub-workers** — Thinker delegates to 7B instances for parallel exploration
- **Split-view UI** — Side-by-side Voice and Thinker output
- **Ready revocation** — Thinker can un-ready Voice if it finds something critical
- **Model diversity** — Voice on a different model than Thinker
- **Streaming message injection** — Inject messages mid-turn (requires Ollama API changes)
- **Multi-Thinker** — Multiple specialized Thinkers (code explorer, web researcher, etc.)
