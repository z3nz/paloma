import { useSessionState } from './useSessionState.js'

export function useToolExecution(sessionState) {
  // Backward compat: if no sessionState passed, use active session
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const toolActivity = sessionState.toolActivity
  const pendingToolConfirmation = sessionState.pendingToolConfirmation

  function addActivity(name, args) {
    const entry = { id: crypto.randomUUID(), name, args, status: 'running' }
    toolActivity.value = [...toolActivity.value, entry]
    return entry.id
  }

  function markActivityDone(id) {
    const entry = toolActivity.value.find(a => a.id === id)
    if (entry) {
      entry.status = 'done'
      toolActivity.value = [...toolActivity.value]
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
    clearActivity,
    requestToolConfirmation,
    resolveToolConfirmation,
    rejectToolConfirmation
  }
}
