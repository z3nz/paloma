import { ref, shallowRef, watch, computed } from 'vue'
import { openProject as openDir, readProjectInstructions, readActivePlans, readMcpConfig } from '../services/filesystem.js'

const STORAGE_KEY = 'paloma:projectName'

const _saved = import.meta.hot ? window.__PALOMA_PROJECT__ : undefined

// Try sessionStorage recovery if HMR state is empty (full reload scenario)
let initialProjectName = _saved?.projectName ?? ''
if (!initialProjectName) {
  try {
    const cached = sessionStorage.getItem(STORAGE_KEY)
    if (cached) {
      initialProjectName = cached
      console.log('[Recovery] Restored projectName from sessionStorage:', initialProjectName)
    }
  } catch {
    // Ignore errors
  }
}

const dirHandle = shallowRef(_saved?.dirHandle ?? null)
const projectName = ref(initialProjectName)
const projectInstructions = ref(_saved?.projectInstructions ?? null)
const activePlans = ref(_saved?.activePlans ?? [])
const mcpConfig = ref(_saved?.mcpConfig ?? null)

// Computed: need to reconnect if we have projectName but no dirHandle
const needsReconnect = computed(() => !!projectName.value && !dirHandle.value)

// Save projectName to sessionStorage when it changes
watch(projectName, (name) => {
  try {
    if (name) {
      sessionStorage.setItem(STORAGE_KEY, name)
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Ignore errors
  }
}, { flush: 'sync' })

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
    const [instructions, plans, mcp] = await Promise.all([
      readProjectInstructions(handle),
      readActivePlans(handle),
      readMcpConfig(handle)
    ])
    projectInstructions.value = instructions
    activePlans.value = plans
    mcpConfig.value = mcp
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
    needsReconnect,
    openProject,
    closeProject,
    refreshActivePlans
  }
}
