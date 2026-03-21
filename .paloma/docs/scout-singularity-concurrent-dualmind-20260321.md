# Scout: Singularity Concurrent Dual-Mind Redesign

**Date:** 2026-03-21
**Scope:** Redesign Singularity from sequential delegation to concurrent dual-mind architecture

---

## Background

The Singularity system exists in `bridge/pillar-manager.js` and `bridge/ollama-manager.js`. It was originally designed as a **sequential delegation** model: Brain (depth 0) streams text, delegates via `<delegate>` tags, Hands (depth 1+) execute tools and report back. Brain resumes.

Adam's vision is fundamentally different: **two concurrent minds** that talk to each other like an inner dialogue, converge on agreement, then output the result.

## What's Currently Built

### Key Files
- `src/prompts/base.js` — SINGULARITY_BRAIN_PROMPT (line ~388) and SINGULARITY_HANDS_PROMPT (line ~428)
- `bridge/pillar-manager.js` — Brain/Hands spawning, `_extractDelegations()`, `_handleSingularityDelegations()`, tool suppression via `isSingularityBrain`
- `bridge/ollama-manager.js` — Tool call parsing (native, JSON, XML), streaming, `continueWithToolResults()`

### Current Architecture (Sequential Delegation)
1. Brain spawns (depth=0, recursive=true) → gets SINGULARITY_BRAIN_PROMPT, NO tools, qwen3-coder:30b
2. Brain streams text to Adam, outputs `<delegate>task</delegate>` tags
3. `_extractDelegations()` regex-extracts tasks from Brain output
4. `_handleSingularityDelegations()` spawns Hands (depth=1, forge pillar) in parallel via `Promise.all`
5. Brain marked as "waiting", doesn't count against MAX_CONCURRENT_OLLAMA
6. Hands (qwen2.5-coder:7b) execute tools, produce output
7. Results formatted and fed back to Brain as user message
8. Brain resumes streaming with results
9. Repeat until Brain has no more `<delegate>` tags

### Current Problems
1. **Brain leaks tool JSON** — qwen3-coder:30b generates `{"name": "tool", "arguments": {...}}` as text even though it has no tools. The streaming pipeline emits raw text before cleanup can strip it.
2. **Sequential, not concurrent** — Brain pauses while Hands work. No real-time collaboration.
3. **One-directional** — Hands report to Brain, but can't have a conversation.
4. **No agreement protocol** — Brain just keeps going until it stops delegating.

## Adam's Vision: Concurrent Dual-Mind

### The Metaphor
Like a human mind: one part speaks words aloud (Voice), another part runs silently inside your head (Thinker). Both active simultaneously. The spoken words reflect the internal thinking, and the internal thinking is informed by the conversation.

### Two Instances, Clean Separation
- **Voice** — Streams text to Adam. Talks to the Thinker. Has NO MCP tools. Is the "mouth."
- **Thinker** — Uses MCP tools, explores, researches. Talks to Voice. Does NOT stream to Adam. Is the "mind."
- Both run on `qwen3-coder:30b`
- Both spawn simultaneously when a Singularity session starts

### Communication
- Bidirectional message passing through the bridge
- Like two people in a conversation — Voice can ask Thinker questions, Thinker can push findings to Voice
- Real-time, not batched

### Agreement Protocol (Green Means Go)
- Each instance can mark itself as "ready" (green)
- When BOTH are green, the response is considered complete
- Voice outputs the final agreed-upon message
- Streaming stops
- Think of it like a video game map vote — both players must agree before the round starts

### Key Design Constraints
- Only Voice streams to Adam's chat
- Only Thinker has MCP tools
- Both can send messages to each other via bridge
- Both must go green before completion
- Both use qwen3-coder:30b (stress test the laptop with 2x 30B concurrent)

## Technical Analysis

### What Needs to Change

#### 1. Spawning (pillar-manager.js)
Currently: One session spawns, depth determines Brain vs Hands.
Needed: Spawn TWO sessions simultaneously. Tag them as `role: 'voice'` and `role: 'thinker'`. Link them as partners (each knows the other's pillarId).

#### 2. Communication Channel (NEW)
Currently: No inter-session messaging exists for Ollama sessions (only `pillar_message` for Claude CLI).
Needed: A bridge-mediated message channel between Voice and Thinker. When Voice sends a message, it arrives as a user-turn in Thinker's conversation, and vice versa. Could use `pillar_message` mechanism or a new dedicated channel.

#### 3. Tool Routing
Currently: `isSingularityBrain` check suppresses tools for depth=0.
Needed: Suppress tools for `role: 'voice'`, give tools to `role: 'thinker'`. Clean, role-based.

#### 4. Streaming Routing
Currently: All Ollama output streams to the chat via `pillar_stream` events.
Needed: Only Voice's output goes to `pillar_stream`. Thinker's output is silent to Adam (but visible in a debug/secondary panel?).

#### 5. Agreement Protocol (NEW)
Currently: Brain just finishes when it has no more delegations.
Needed: Each instance can signal "ready" (green). Bridge tracks both states. When both green → emit `pillar_done`, stop both sessions. Could be a special tag in output (e.g., `<ready/>`) or a tool call.

#### 6. Prompts
Currently: SINGULARITY_BRAIN_PROMPT focuses on `<delegate>` tags.
Needed: SINGULARITY_VOICE_PROMPT — "You stream to Adam. You talk to your Thinker partner. When you're satisfied with the answer, say `<ready/>`."
SINGULARITY_THINKER_PROMPT — "You explore with tools. You talk to your Voice partner. When you've found what's needed, say `<ready/>`."

### What Can Be Reused
- `_buildOllamaTools()` — already builds the tool set for Ollama sessions
- `_startCliTurn()` — can drive both Voice and Thinker turns
- `pillar_message` tool — could be the communication channel (Thinker calls `pillar_message` to send to Voice)
- `_handleOllamaToolCall()` — tool execution for Thinker
- `OLLAMA_ALLOWED_SERVERS` — same tool set for Thinker
- `MAX_CONCURRENT_OLLAMA` / spawn queue — may need adjustment for 2x 30B

### Open Questions for Chart
1. **Message format between Voice and Thinker** — plain text? Structured? Should Voice see tool results or just Thinker's synthesis?
2. **Turn management** — Does Voice wait for Thinker's response before continuing, or do they truly run in parallel with async message injection?
3. **UI representation** — How does the browser show this? One chat with Voice text? A split view? A subtle indicator that Thinker is working?
4. **Timeout/deadlock** — What if one instance never goes green? Need a timeout.
5. **Memory pressure** — Two concurrent 30B models. Need to verify Ollama can handle this (may need to check VRAM/RAM).

## Recommendation

This is a clean redesign of the Singularity spawning and communication layer. The tool execution, MCP routing, and Ollama session management are solid and can be reused. The new pieces are:

1. Dual-spawn logic (spawn Voice + Thinker together)
2. Inter-session message channel
3. Agreement protocol (`<ready/>` detection + green/green → done)
4. Stream routing (Voice → chat, Thinker → silent)
5. New prompts for both roles

Chart should design the exact message flow, state machine, and prompt wording. Forge builds it. This is a focused, achievable redesign.
