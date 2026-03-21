# Architecture Patterns — Lessons

## Lessons from Shipped Work

---

### Lesson: Concurrent dual-mind is structurally simpler than sequential delegation
- **Context:** Rewrote Singularity from sequential Brain→delegate→Hands→report back to concurrent Voice + Thinker spawned simultaneously.
- **Insight:** Sequential delegation required complex state tracking (_waitingForHands, pending child completions, result aggregation, Brain resume logic). Concurrent spawning with bidirectional messaging via the existing sendMessage() mechanism eliminated all of that — the sessions just talk to each other like any other pillar pair.
- **Action:** When designing multi-agent systems, prefer concurrent spawning over sequential hand-off. The coordination overhead of "wait for A, then do B" is almost always higher than letting both run and converge.
- **Applied:** YES — rewrote _handleSingularityDelegations() into _spawnSingularityGroup() + _queueSingularityMessage()

---

### Lesson: Stream filtering with a buffer is the right pattern for tag interception
- **Context:** Voice's stream contains <to-thinker> tags that must be stripped before reaching Adam but routed to Thinker in real-time.
- **Insight:** Naive approaches (regex on each chunk) fail because tags can span multiple stream events. A session-level string buffer (_voiceStreamBuffer) accumulates chunks, extracts complete tags, and only forwards the safe prefix up to any potential partial tag. This handles all split cases correctly without holding back too much text.
- **Action:** Use a session-level accumulator buffer for any streaming tag interception. Always scan for partial tags at the buffer tail before deciding what's safe to forward. Flush the buffer on turn complete.
- **Applied:** YES — implemented as _filterVoiceStream() in pillar-manager.js

---

### Lesson: <ready/> agreement protocol needs a timeout + nudge to prevent deadlock
- **Context:** Both Voice and Thinker must signal <ready/> before the group completes. If one goes ready but the other doesn't, the group hangs.
- **Insight:** Three deadlock scenarios: (1) one session crashes, (2) one session finishes but forgets to include <ready/>, (3) both are idle waiting for the other. Solutions: 3-minute timeout after first ready (forces completion), 30-second idle nudge (reminds idle session to either ask for more or go ready).
- **Action:** Any agreement/consensus protocol in multi-agent systems needs: a timeout for partial agreement, and a nudge mechanism for idle-waiting. Don't rely on LLMs to always remember to signal completion.
- **Applied:** YES — _checkSingularityReady() + _nudgeSingularityIdle() in pillar-manager.js

---

### Lesson: The primary session (Voice) is the user-facing one — return its pillarId
- **Context:** _spawnSingularityGroup() needs to return something to the caller (Flow's pillar_spawn tool). The group creates two sessions.
- **Insight:** Return Voice's pillarId as the primary result, with thinkerPillarId as extra metadata. All existing pillar tooling (pillar_status, pillar_stop, message sending) continues to work against the Voice session. Thinker is internal plumbing from the caller's perspective.
- **Action:** In multi-session spawns, pick one session as the "primary" that integrates cleanly with existing single-session tooling. Return its ID as the top-level result.
- **Applied:** YES — _spawnSingularityGroup() returns { ...voiceResult, singularityGroupId, thinkerPillarId }

---

### Lesson: Use singularityRole field instead of depth heuristics for role detection
- **Context:** Old system detected Brain vs Hands via `recursive && depth === 0`. This was fragile — any recursive spawn could accidentally match.
- **Insight:** Explicit role fields (singularityRole: 'voice' | 'thinker' | null) are unambiguous and survive refactoring. Depth is an implementation detail, not a role identifier. Now tool suppression, stream routing, model selection, and prompt injection all use singularityRole.
- **Action:** Give multi-role sessions an explicit role field at spawn time. Never infer role from structural position (depth, index, etc.).
- **Applied:** YES — singularityRole field added to spawn() and all downstream logic

---

### Lesson: ThinkingPanel auto-shows on Singularity — don't require user to open it
- **Context:** The ThinkingPanel is hidden when there's no active Singularity group (visible computed = !!groupId). It appears automatically when a group is created.
- **Insight:** Panels that are only useful in specific modes should auto-show when that mode activates, and auto-hide when it ends. Making the user manually open a panel they didn't know about kills the feature's discoverability.
- **Action:** For mode-specific panels, tie visibility to the mode state directly. Let the user collapse/hide but never require them to open.
- **Applied:** YES — ThinkingPanel.vue visible = computed(() => !!props.groupId)
