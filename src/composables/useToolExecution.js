import { ref, watch } from 'vue'

const _saved = import.meta.hot ? window.__PALOMA_TOOL_EXEC__ : undefined

const toolActivity = ref(_saved?.toolActivity ?? [])
const pendingToolConfirmation = ref(_saved?.pendingToolConfirmation ?? null)

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_TOOL_EXEC__ = {
      toolActivity: toolActivity.value,
      pendingToolConfirmation: pendingToolConfirmation.value
    }
  }
  save()
  watch([toolActivity, pendingToolConfirmation], save, { flush: 'sync' })
  import.meta.hot.accept()
}

export function useToolExecution() {
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
