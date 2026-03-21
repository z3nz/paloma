# Singularity Concurrent Dual-Mind Redesign

**Status:** active
**Created:** 2026-03-21
**Scope:** paloma
**Goal:** Redesign Singularity from sequential Brain/Hands delegation to concurrent Voice/Thinker dual-mind architecture

## Context

Adam's vision: Two Qwen instances spawn simultaneously. Voice streams text to Adam and talks to Thinker. Thinker explores with MCP tools and talks to Voice. Neither can do the other's job. When both agree (green means go), the response completes. Like a human mind — one part speaks, another part thinks silently, and they converge.

## Scout Findings

See: `.paloma/docs/scout-singularity-concurrent-dualmind-20260321.md`

Key takeaways:
- Current system is sequential delegation (Brain → `<delegate>` → Hands → report back)
- Need concurrent spawning, bidirectional messaging, agreement protocol
- Tool execution and MCP routing can be reused
- New pieces: dual-spawn, inter-session channel, `<ready/>` protocol, stream routing, new prompts

## Pipeline

- [x] Scout — Deep dive on current implementation + gap analysis
- [x] Chart — Design message flow, state machine, prompts, UI representation
- [x] Forge — Build the concurrent dual-mind system
- [ ] Ship — Commit, push, document

## Chart Design

See: `.paloma/docs/chart-singularity-concurrent-dualmind-20260321.md`

## Work Units

#### WU-1: Replace SINGULARITY_BRAIN_PROMPT and SINGULARITY_HANDS_PROMPT with SINGULARITY_V
- **Feature:** Prompts & DNA
- **Status:** pending
- **Files:** src/prompts/base.js, src/prompts/phases.js
- **Scope:** Replace SINGULARITY_BRAIN_PROMPT and SINGULARITY_HANDS_PROMPT with SINGULARITY_VOICE_PROMPT and SINGULARITY_THINKER_PROMPT. Update buildBirthContext() to use singularityRole instead of depth. Update _buildSystemPrompt() prompt injection.
- **Acceptance:** New prompts exported. buildBirthContext accepts singularityRole option. Old Brain/Hands prompts removed.

#### WU-2: Add _singularityGroups Map, singularityGroupId/singularityRole/voiceStreamBuffer
- **Feature:** Dual Spawn & Session Structure
- **Status:** pending
- **Depends on:** WU-1
- **Files:** bridge/pillar-manager.js
- **Scope:** Add _singularityGroups Map, singularityGroupId/singularityRole/voiceStreamBuffer fields to sessions. Implement _spawnSingularityGroup() that creates linked Voice + Thinker sessions. Modify spawn() to detect recursive+depth0+ollama and call dual-spawn. Update _defaultModel() so both Voice and Thinker get 30B. Update _countActiveOllamaSessions() to exclude idle-waiting partners.
- **Acceptance:** spawn({recursive:true, depth:0, backend:'ollama'}) creates two linked sessions. Both appear in pillars Map with correct roles. Group tracked in _singularityGroups.

#### WU-3: Implement _filterVoiceStream() for &lt;to-thinker&gt; tag interception with stre
- **Feature:** Inter-Session Communication & Stream Routing
- **Status:** pending
- **Depends on:** WU-2
- **Files:** bridge/pillar-manager.js
- **Scope:** Implement _filterVoiceStream() for &lt;to-thinker&gt; tag interception with stream buffering. Implement _queueSingularityMessage() for routing messages between partners. Modify _handleCliEvent stream block: Voice output passes through filter, both Voice and Thinker pillar_stream events include singularityRole and singularityGroupId fields for frontend routing. Thinker tool call/result broadcasts also include role tags. Handle buffer flush on turn complete.
- **Acceptance:** Voice &lt;to-thinker&gt; tags stripped from Adam's stream and routed to Thinker. Thinker pillar_message calls route to Voice. All pillar_stream events for Singularity sessions include singularityRole field. Tool events include role tags.
#### WU-4: Implement _checkSingularityReady() for &lt;ready/&gt; detection in completed out
- **Feature:** Agreement Protocol & Completion
- **Status:** pending
- **Depends on:** WU-3
- **Files:** bridge/pillar-manager.js
- **Scope:** Implement _checkSingularityReady() for &lt;ready/&gt; detection in completed output. Implement _completeSingularityGroup() to stop both sessions, broadcast singularity_complete, cleanup group. Add 3-minute timeout after first ready. Add 30-second idle nudge for deadlock prevention. Remove old _extractDelegations(), _handleSingularityDelegations(), isSingularityBrain checks, _waitingForHands field. Replace with singularityRole-based logic in _handleCliEvent done block.
- **Acceptance:** &lt;ready/&gt; detected in both Voice and Thinker output. Both ready triggers clean completion. Timeout forces completion if only one goes ready. Old delegation code removed.

#### WU-5: Create ThinkingPanel
- **Feature:** Frontend Thinking Panel & Stream Routing
- **Status:** pending
- **Depends on:** WU-4
- **Files:** src/components/ThinkingPanel.vue, src/composables/useWebSocket.js, src/components/ChatView.vue
- **Scope:** Create ThinkingPanel.vue component — collapsible panel that shows Thinker's live text stream, tool calls, and tool results in real-time alongside the main chat. Route pillar_stream events by singularityRole field: voice → main chat, thinker → ThinkingPanel. Handle singularity_complete event. Add agreement indicator dots (pulsing blue/gray/green) in chat header. Panel opens automatically on Singularity session start, closeable by Adam.
- **Acceptance:** Thinker's live stream visible in a separate panel. Tool calls/results rendered in panel. Voice/Thinker ready states shown as colored dots. Panel auto-opens on Singularity start.