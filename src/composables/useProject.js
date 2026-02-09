import { ref, shallowRef, watch, computed } from 'vue'
import { openProject as openDir, readProjectInstructions, readActivePlans, readMcpConfig } from '../services/filesystem.js'
import db from '../services/db.js'

const _saved = import.meta.hot ? window.__PALOMA_PROJECT__ : undefined

// --- URL hash helpers ---

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '')
  const match = hash.match(/^project\/([^/]+)(?:\/session\/(\d+))?/)
  if (!match) return { project: null, sessionId: null }
  return {
    project: decodeURIComponent(match[1]),
    sessionId: match[2] ? Number(match[2]) : null
  }
}

function setHash(projectName, sessionId) {
  let hash = ''
  if (projectName) {
    hash = `#/project/${encodeURIComponent(projectName)}`
    if (sessionId != null) {
      hash += `/session/${sessionId}`
    }
  }
  // Use replaceState to avoid polluting history on every session switch
  if (location.hash !== hash) {
    history.replaceState(null, '', hash || location.pathname)
  }
}

// --- dirHandle persistence in IndexedDB ---

async function persistHandle(name, handle) {
  try {
    await db.projectHandles.put({ name, handle, updatedAt: Date.now() })
  } catch (e) {
    console.warn('[Project] Failed to persist dirHandle:', e)
  }
}

async function recoverHandle(name) {
  try {
    const record = await db.projectHandles.get(name)
    if (!record?.handle) return null
    const handle = record.handle
    // Check if permission is still granted (no user gesture needed if still valid)
    const perm = await handle.queryPermission({ mode: 'read' })
    if (perm === 'granted') return handle
    // Try requesting — will succeed silently if the browser context allows it
    const requested = await handle.requestPermission({ mode: 'read' })
    if (requested === 'granted') return handle
    return null
  } catch (e) {
    console.warn('[Project] Failed to recover dirHandle:', e)
    return null
  }
}

// --- State ---

// Determine initial project name: HMR state > URL hash > sessionStorage
const hashState = parseHash()
const STORAGE_KEY = 'paloma:projectName'

let initialProjectName = _saved?.projectName ?? ''
if (!initialProjectName && hashState.project) {
  initialProjectName = hashState.project
} else if (!initialProjectName) {
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
    // Persist handle for future recovery
    await persistHandle(handle.name, handle)
    return handle
  }

  /** Try to auto-recover a project from IndexedDB (e.g. after Vite HMR reload) */
  async function tryAutoRecover() {
    const name = projectName.value
    if (!name || dirHandle.value) return null
    const handle = await recoverHandle(name)
    if (!handle) return null
    dirHandle.value = handle
    const [instructions, plans, mcp] = await Promise.all([
      readProjectInstructions(handle),
      readActivePlans(handle),
      readMcpConfig(handle)
    ])
    projectInstructions.value = instructions
    activePlans.value = plans
    mcpConfig.value = mcp
    console.log('[Recovery] Auto-recovered project:', name)
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
    setHash('', null)
  }

  /** Get the initial session ID parsed from the URL hash (if any) */
  function getHashSessionId() {
    return hashState.sessionId
  }

  /** Update URL hash to reflect current project + session */
  function syncHash(sessionId) {
    setHash(projectName.value, sessionId)
  }

  return {
    dirHandle,
    projectName,
    projectInstructions,
    activePlans,
    mcpConfig,
    needsReconnect,
    openProject,
    tryAutoRecover,
    closeProject,
    refreshActivePlans,
    getHashSessionId,
    syncHash
  }
}
