import { ref, shallowRef, watch } from 'vue'
import { openProject as openDir, readProjectInstructions, readActivePlans, readMcpConfig } from '../services/filesystem.js'

const _saved = import.meta.hot ? window.__PALOMA_PROJECT__ : undefined

const dirHandle = shallowRef(_saved?.dirHandle ?? null)
const projectName = ref(_saved?.projectName ?? '')
const projectInstructions = ref(_saved?.projectInstructions ?? null)
const activePlans = ref(_saved?.activePlans ?? [])
const mcpConfig = ref(_saved?.mcpConfig ?? null)

if (import.meta.hot) {
  console.log('[HMR] useProject.js — restored dirHandle:', dirHandle.value)
  console.log('[HMR] useProject.js — restored projectName:', projectName.value)
  const save = () => {
    window.__PALOMA_PROJECT__ = {
      dirHandle: dirHandle.value,
      projectName: projectName.value,
      projectInstructions: projectInstructions.value,
      activePlans: activePlans.value,
      mcpConfig: mcpConfig.value
    }
  }
  save()
  watch([dirHandle, projectName, projectInstructions, activePlans, mcpConfig], save, { flush: 'sync' })
}

export function useProject() {
  async function openProject() {
    const handle = await openDir()
    dirHandle.value = handle
    projectName.value = handle.name
    projectInstructions.value = await readProjectInstructions(handle)
    activePlans.value = await readActivePlans(handle)
    mcpConfig.value = await readMcpConfig(handle)
    return handle
  }

  async function refreshActivePlans() {
    if (dirHandle.value) {
      activePlans.value = await readActivePlans(dirHandle.value)
    }
  }

  function closeProject() {
    dirHandle.value = null
    projectName.value = ''
    projectInstructions.value = null
    activePlans.value = []
    mcpConfig.value = null
  }

  return {
    dirHandle,
    projectName,
    projectInstructions,
    activePlans,
    mcpConfig,
    openProject,
    closeProject,
    refreshActivePlans
  }
}
