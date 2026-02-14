import { useSessionState } from './useSessionState.js'
import { classifyResult } from '../utils/toolClassifier.js'

export function useToolExecution(sessionState) {
  // Backward compat: if no sessionState passed, use active session
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const toolActivity = sessionState.toolActivity
  const pendingToolConfirmation = sessionState.pendingToolConfirmation

  function addActivity(name, args) {
    const entry = { id: crypto.randomUUID(), name, args, status: 'running', startedAt: Date.now() }
    toolActivity.value = [...toolActivity.value, entry]
    return entry.id
  }

  function markActivityDone(id, result) {
    const entry = toolActivity.value.find(a => a.id === id)
    if (entry) {
      entry.status = 'done'
      entry.duration = Date.now() - entry.startedAt
      if (result !== undefined) {
        entry.resultType = classifyResult(entry.name, result)
      }
      toolActivity.value = [...toolActivity.value]
    }
  }

  /**
   * Snapshot the current tool activity for persistence on assistant messages.
   * Strips transient fields (startedAt) and forces JSON round-trip to guarantee
   * the result is safe for IndexedDB's structured clone algorithm.
   */
  function snapshotActivity() {
    const raw = toolActivity.value.map(a => ({
      id: a.id,
      name: a.name,
      args: a.args,
      status: a.status,
      duration: a.duration || null,
      resultType: a.resultType || null
    }))
    // JSON round-trip strips functions, symbols, undefined, circular refs —
    // anything that would cause DataCloneError in IndexedDB
    try {
      return JSON.parse(JSON.stringify(raw))
    } catch {
      // If even JSON fails (circular refs), return minimal data
      return raw.map(a => ({
        id: a.id,
        name: a.name,
        args: {},
        status: a.status,
        duration: a.duration || null,
        resultType: a.resultType || null
      }))
    }
  }

  function clearActivity() {
    toolActivity.value = []
  }

  function requestToolConfirmation(toolName, args, dirHandle) {
    return new Promise(resolve => {
      pendingToolConfirmation.value = { toolName, args, dirHandle, resolve }
    })
  }

  function resolveToolConfirmation(result) {
    if (pendingToolConfirmation.value) {
      pendingToolConfirmation.value.resolve(result)
      pendingToolConfirmation.value = null
    }
  }

  function rejectToolConfirmation(reason) {
    if (pendingToolConfirmation.value) {
      pendingToolConfirmation.value.resolve(JSON.stringify({ error: `Denied: ${reason}` }))
      pendingToolConfirmation.value = null
    }
  }

  return {
    toolActivity,
    pendingToolConfirmation,
    addActivity,
    markActivityDone,
    snapshotActivity,
    clearActivity,
    requestToolConfirmation,
    resolveToolConfirmation,
    rejectToolConfirmation
  }
}
