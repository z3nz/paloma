import { ref, computed } from 'vue'
import { useMCP } from './useMCP.js'

// Module-level singleton — preserves state across hot reloads without window hacks
// (useMCP's singularityGroups/singularityThinkerContent are already module-level singletons)
let _instance = null

/**
 * Composable for singularity session state management.
 *
 * Wraps the reactive singularity state owned by useMCP and exposes a clean,
 * focused interface for UI components. The bridge populates useMCP state via
 * onSingularityCreated / onSingularityReady / onSingularityComplete / onPillarStream;
 * this composable reads that state and tracks supplemental UI concerns like tool calls.
 *
 * Call once at the app level (returns singleton on subsequent calls).
 */
export function useSingularity() {
  if (_instance) return _instance

  const { singularityGroups, singularityThinkerContent } = useMCP()

  // The group ID of the most recently activated singularity session
  const activeGroupId = ref(null)

  // Thinker tool calls for the active group — populated via handleSingularityEvent
  const thinkerToolCalls = ref([])

  // ── Computed state ──────────────────────────────────────────────────────────

  /** The current Voice + Thinker group object, or null if none active. */
  const activeSingularityGroup = computed(() =>
    activeGroupId.value ? singularityGroups.get(activeGroupId.value) ?? null : null
  )

  /** Accumulated Thinker stream text for the active group. */
  const thinkerContent = computed(() =>
    activeGroupId.value ? (singularityThinkerContent.get(activeGroupId.value) ?? '') : ''
  )

  /** True when Voice has emitted <ready/>. */
  const voiceReady = computed(() => activeSingularityGroup.value?.voiceReady ?? false)

  /** True when Thinker has emitted <ready/>. */
  const thinkerReady = computed(() => activeSingularityGroup.value?.thinkerReady ?? false)

  /** True when both Voice and Thinker are ready (agreement reached). */
  const isComplete = computed(() => voiceReady.value && thinkerReady.value)

  /** True when there is an active, running singularity session. */
  const isSingularityActive = computed(() => !!activeGroupId.value && singularityGroups.has(activeGroupId.value))

  // ── Event handler ───────────────────────────────────────────────────────────

  /**
   * Process a bridge WebSocket event relevant to the singularity system.
   * Call this from the WebSocket message handler for events the bridge emits.
   *
   * Handled event types:
   *   - singularity_created  → activate the new group
   *   - pillar_tool_call     → record thinker tool call (if singularity context)
   *   - pillar_tool_result   → update matching tool call with result
   *   - singularity_complete → (state already updated by useMCP)
   *   - pillar_stopped       → clean up if group's pillar stopped prematurely
   *
   * @param {object} event - Bridge WebSocket event object
   */
  function handleSingularityEvent(event) {
    if (!event?.type) return

    switch (event.type) {
      case 'singularity_created':
        // New singularity group started — make it active and clear prior tool calls
        activeGroupId.value = event.groupId
        thinkerToolCalls.value = []
        break

      case 'pillar_tool_call':
        // Only track tool calls from the Thinker role in an active singularity context
        if (event.singularityRole === 'thinker' && event.singularityGroupId === activeGroupId.value) {
          thinkerToolCalls.value.push({
            id: event.id ?? event.toolUseId,
            name: event.name ?? event.toolName ?? 'unknown',
            input: event.input ?? event.args ?? {},
            status: 'running',
            result: null,
            timestamp: Date.now()
          })
        }
        break

      case 'pillar_tool_result':
        // Match result to a pending tool call by ID
        if (event.singularityRole === 'thinker' || event.singularityGroupId === activeGroupId.value) {
          const resultId = event.toolUseId ?? event.id
          const call = thinkerToolCalls.value.find(tc => tc.id === resultId)
          if (call) {
            call.status = 'done'
            call.result = typeof event.content === 'string'
              ? event.content
              : Array.isArray(event.content)
                ? event.content.map(c => c.text || '').join('')
                : JSON.stringify(event.content ?? '')
          }
        }
        break

      case 'singularity_complete':
        // useMCP already flipped voiceReady/thinkerReady on the group object.
        // Nothing extra needed — computed isComplete will re-evaluate reactively.
        break

      case 'pillar_stopped': {
        // If a singularity pillar stopped without completing, schedule cleanup
        if (!activeGroupId.value) break
        const group = singularityGroups.get(activeGroupId.value)
        if (!group) break
        const isSingularityPillar = (
          event.pillarId === group.voicePillarId ||
          event.pillarId === group.thinkerPillarId
        )
        if (isSingularityPillar && !isComplete.value) {
          // Give UI time to render the final state before clearing
          const capturedGroupId = activeGroupId.value
          setTimeout(() => {
            if (activeGroupId.value === capturedGroupId) {
              activeGroupId.value = null
            }
          }, 3000)
        }
        break
      }
    }
  }

  // ── Methods ─────────────────────────────────────────────────────────────────

  /** Reset all singularity UI state (e.g. when starting a new session). */
  function clearSingularity() {
    activeGroupId.value = null
    thinkerToolCalls.value = []
  }

  /**
   * Return a snapshot of current singularity status (non-reactive, for logging/debug).
   * @returns {{ activeGroupId, group, thinkerContentLength, toolCallCount, isComplete, isSingularityActive }}
   */
  function getSingularityStatus() {
    const group = activeSingularityGroup.value
    return {
      activeGroupId: activeGroupId.value,
      group: group ? {
        voicePillarId: group.voicePillarId,
        thinkerPillarId: group.thinkerPillarId,
        voiceReady: group.voiceReady,
        thinkerReady: group.thinkerReady
      } : null,
      thinkerContentLength: thinkerContent.value.length,
      toolCallCount: thinkerToolCalls.value.length,
      isComplete: isComplete.value,
      isSingularityActive: isSingularityActive.value
    }
  }

  _instance = {
    // Reactive state
    activeSingularityGroup,
    thinkerContent,
    thinkerToolCalls,
    voiceReady,
    thinkerReady,
    isComplete,
    isSingularityActive,
    // Internal (exposed for components that need the raw ID)
    activeGroupId,
    // Methods
    handleSingularityEvent,
    clearSingularity,
    getSingularityStatus
  }

  return _instance
}
