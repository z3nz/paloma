import { ref, shallowReactive, watch } from 'vue'

// --- HMR preservation ---
const _saved = import.meta.hot ? window.__PALOMA_SESSION_STATE__ : undefined

// MUST be shallowReactive — reactive(new Map()) would deep-convert values,
// auto-unwrapping the refs inside session state objects and breaking .value access.
// Never restore stateMap from HMR — old snapshots may use reactive() which corrupts refs.
// Session state is transient; messages reload from IndexedDB on session switch.
const stateMap = shallowReactive(new Map())
const activeId = ref(_saved?.activeId ?? null)
const lruOrder = ref(_saved?.lruOrder ?? [])
const MAX_LOADED_SESSIONS = 10

// Fallback state for when no session is active — stable singleton to avoid
// creating new refs on every computed evaluation.
const _fallbackState = createSessionState()

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_SESSION_STATE__ = {
      activeId: activeId.value,
      lruOrder: lruOrder.value
    }
  }
  save()
  watch([activeId, lruOrder], save, { flush: 'sync' })
  import.meta.hot.accept()
}

function createSessionState() {
  return {
    messages: ref([]),
    streaming: ref(false),
    streamingContent: ref(''),
    error: ref(null),
    contextWarning: ref(null),
    abortController: null,
    toolActivity: ref([]),
    pendingToolConfirmation: ref(null),
    pendingChanges: ref([]),
    cliRequestId: null
  }
}

function touchLru(sessionId) {
  const idx = lruOrder.value.indexOf(sessionId)
  if (idx !== -1) lruOrder.value.splice(idx, 1)
  lruOrder.value.push(sessionId)
  evictIfNeeded()
}

function evictIfNeeded() {
  let attempts = 0
  while (lruOrder.value.length > MAX_LOADED_SESSIONS && attempts < lruOrder.value.length) {
    const oldest = lruOrder.value[0]
    const state = stateMap.get(oldest)
    // Never evict streaming or active sessions
    if ((state && state.streaming.value) || oldest === activeId.value) {
      lruOrder.value.push(lruOrder.value.shift())
      attempts++
      continue
    }
    stateMap.delete(oldest)
    lruOrder.value.shift()
    break
  }
}

export function useSessionState() {
  /**
   * Gets or creates session state. For imperative use only (sendMessage,
   * loadMessages, event handlers). Do NOT call from computed getters —
   * it mutates stateMap on first access.
   */
  function getState(sessionId) {
    if (!sessionId) return _fallbackState
    if (!stateMap.has(sessionId)) {
      stateMap.set(sessionId, createSessionState())
    }
    return stateMap.get(sessionId)
  }

  /**
   * Sets the active session. Creates state and touches LRU BEFORE setting
   * activeId so that computed getters (activeState) always find existing state.
   */
  function activate(sessionId) {
    if (sessionId) {
      getState(sessionId) // ensure state exists in Map
      touchLru(sessionId)
    }
    activeId.value = sessionId
  }

  /**
   * Pure read of active session state — safe for computed getters.
   * Never creates state or touches LRU.
   */
  function activeState() {
    if (!activeId.value) return _fallbackState
    return stateMap.get(activeId.value) || _fallbackState
  }

  function isStreaming(sessionId) {
    const state = stateMap.get(sessionId)
    return state?.streaming.value ?? false
  }

  function hasToolActivity(sessionId) {
    const state = stateMap.get(sessionId)
    if (!state) return false
    return state.toolActivity.value.some(a => a.status === 'running')
  }

  function removeState(sessionId) {
    stateMap.delete(sessionId)
    const idx = lruOrder.value.indexOf(sessionId)
    if (idx !== -1) lruOrder.value.splice(idx, 1)
  }

  return {
    activeId,
    stateMap,
    getState,
    activate,
    activeState,
    isStreaming,
    hasToolActivity,
    removeState
  }
}
