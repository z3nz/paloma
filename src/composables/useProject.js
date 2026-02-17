import { ref, shallowRef, watch, computed } from 'vue'
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
  if (location.hash !== hash) {
    history.replaceState(null, '', hash || location.pathname)
  }
}

// --- State ---

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
// Default to paloma if nothing else resolved
if (!initialProjectName) {
  initialProjectName = 'paloma'
}

// Keep dirHandle for backward compat (Phase 2 migration — will be removed later)
const dirHandle = shallowRef(_saved?.dirHandle ?? null)
const projectName = ref(initialProjectName)
const projectRoot = ref(_saved?.projectRoot ?? null)
const projectInstructions = ref(_saved?.projectInstructions ?? null)
const activePlans = ref(_saved?.activePlans ?? [])
const mcpConfig = ref(_saved?.mcpConfig ?? null)
const roots = ref(_saved?.roots ?? [])
const projectLoading = ref(false)

const needsReconnect = computed(() => false) // No longer needed — MCP-based

// Save projectName to sessionStorage
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
  console.log('[HMR] useProject.js — restored projectName:', projectName.value)
  const save = () => {
    window.__PALOMA_PROJECT__ = {
      dirHandle: dirHandle.value,
      projectName: projectName.value,
      projectRoot: projectRoot.value,
      projectInstructions: projectInstructions.value,
      activePlans: activePlans.value,
      roots: roots.value,
      mcpConfig: mcpConfig.value
    }
  }
  save()
  watch([dirHandle, projectName, projectRoot, projectInstructions, activePlans, roots, mcpConfig], save, { flush: 'sync' })
}

// --- MCP-based file reading helpers ---

async function mcpReadFile(callMcpTool, path) {
  try {
    const result = await callMcpTool('mcp__filesystem__read_text_file', { path })
    // MCP returns a string — check for error objects
    if (typeof result === 'string' && result.startsWith('{') && result.includes('"error"')) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.error) return null
      } catch { /* not JSON, treat as content */ }
    }
    return result
  } catch {
    return null
  }
}

async function mcpListDir(callMcpTool, path) {
  try {
    const result = await callMcpTool('mcp__filesystem__list_directory', { path })
    if (typeof result === 'string') {
      // parse the "[DIR] name / [FILE] name" format
      const entries = []
      for (const line of result.split('\n')) {
        const dirMatch = line.match(/^\[DIR\]\s+(.+)/)
        const fileMatch = line.match(/^\[FILE\]\s+(.+)/)
        if (dirMatch) entries.push({ name: dirMatch[1].trim(), kind: 'directory' })
        else if (fileMatch) entries.push({ name: fileMatch[1].trim(), kind: 'file' })
      }
      return entries
    }
    return []
  } catch {
    return []
  }
}

/**
 * Load root values from .paloma/roots/root-*.md.
 * Exported for reuse by sub-agent birth protocol.
 */
async function loadRoots(callMcpTool, root) {
  const rootEntries = await mcpListDir(callMcpTool, `${root}/.paloma/roots`)
  const loaded = []
  for (const entry of rootEntries) {
    if (entry.kind === 'file' && entry.name.startsWith('root-') && entry.name.endsWith('.md')) {
      const content = await mcpReadFile(callMcpTool, `${root}/.paloma/roots/${entry.name}`)
      if (content) {
        // Extract root name from filename: root-faith.md → faith
        const name = entry.name.replace(/^root-/, '').replace(/\.md$/, '')
        loaded.push({ name, content })
      }
    }
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  return loaded
}

async function loadProjectContext(callMcpTool, root) {
  // Read instructions
  const instructions = await mcpReadFile(callMcpTool, `${root}/.paloma/instructions.md`)

  // Read active plans — list .paloma/plans/ and find active-*.md files
  const plans = []
  const planEntries = await mcpListDir(callMcpTool, `${root}/.paloma/plans`)
  for (const entry of planEntries) {
    if (entry.kind === 'file' && entry.name.startsWith('active-') && entry.name.endsWith('.md')) {
      const content = await mcpReadFile(callMcpTool, `${root}/.paloma/plans/${entry.name}`)
      if (content) {
        plans.push({ name: entry.name, content })
      }
    }
  }
  plans.sort((a, b) => a.name.localeCompare(b.name))

  // Read roots
  const rootValues = await loadRoots(callMcpTool, root)

  // Read MCP config
  let mcp = null
  const mcpRaw = await mcpReadFile(callMcpTool, `${root}/.paloma/mcp.json`)
  if (mcpRaw) {
    try { mcp = JSON.parse(mcpRaw) } catch { /* invalid json */ }
  }

  return { instructions, plans, roots: rootValues, mcp }
}

export function useProject() {
  /**
   * Switch to a project by name. Resolves the path via MCP bridge,
   * loads all context (instructions, plans, config).
   * Returns a summary object or null on failure.
   */
  async function switchProject(name, callMcpTool, resolveProjectPath) {
    projectLoading.value = true
    try {
      // Resolve the filesystem path
      // 'paloma' is special — it's the root project, not in projects/
      let root
      if (name === 'paloma') {
        // Try to derive paloma root from current projectRoot or use resolveProjectPath
        root = projectRoot.value
          ? projectRoot.value.replace(/\/projects\/[^/]+$/, '')
          : await resolveProjectPath(name)
      } else {
        root = await resolveProjectPath(name)
      }
      if (!root) {
        throw new Error(`Could not resolve project path for "${name}"`)
      }

      // Load all context via MCP
      const { instructions, plans, roots: rootValues, mcp } = await loadProjectContext(callMcpTool, root)

      // Update state
      projectName.value = name
      projectRoot.value = root
      projectInstructions.value = instructions
      activePlans.value = plans
      roots.value = rootValues
      mcpConfig.value = mcp
      dirHandle.value = null // Not using browser handles anymore

      console.log(`[Project] Switched to "${name}" at ${root} (${plans.length} active plans)`)

      return {
        name,
        root,
        planCount: plans.length,
        hasInstructions: !!instructions,
        hasMcpConfig: !!mcp
      }
    } catch (e) {
      console.error('[Project] Failed to switch:', e)
      throw e
    } finally {
      projectLoading.value = false
    }
  }

  /**
   * List available projects by scanning the projects/ directory via MCP.
   * Always includes 'paloma' at the top (self-referencing).
   */
  async function listProjects(callMcpTool, palomaRoot) {
    const projectsDir = `${palomaRoot}/projects`
    const entries = await mcpListDir(callMcpTool, projectsDir)
    const projects = entries
      .filter(e => e.kind === 'directory')
      .map(e => e.name)
    // Always include paloma itself at the top
    return ['paloma', ...projects.filter(p => p !== 'paloma')]
  }

  /**
   * Refresh active plans from the current project root via MCP.
   */
  async function refreshActivePlans(callMcpTool) {
    if (!projectRoot.value) return
    const planEntries = await mcpListDir(callMcpTool, `${projectRoot.value}/.paloma/plans`)
    const plans = []
    for (const entry of planEntries) {
      if (entry.kind === 'file' && entry.name.startsWith('active-') && entry.name.endsWith('.md')) {
        const content = await mcpReadFile(callMcpTool, `${projectRoot.value}/.paloma/plans/${entry.name}`)
        if (content) {
          plans.push({ name: entry.name, content })
        }
      }
    }
    plans.sort((a, b) => a.name.localeCompare(b.name))
    activePlans.value = plans
  }

  /**
   * Legacy: open project via browser File System Access API.
   * Kept for backward compatibility during migration.
   */
  async function openProject() {
    const { openProject: openDir, ensurePalomaDir, readProjectInstructions, readActivePlans, readMcpConfig } = await import('../services/filesystem.js')
    const handle = await openDir()
    dirHandle.value = handle
    projectName.value = handle.name
    await ensurePalomaDir(handle)
    const [instructions, plans, mcp] = await Promise.all([
      readProjectInstructions(handle),
      readActivePlans(handle),
      readMcpConfig(handle)
    ])
    projectInstructions.value = instructions
    activePlans.value = plans
    mcpConfig.value = mcp
    // Also resolve the root path via MCP for CLI cwd
    resolveRoot()
    return handle
  }

  /** Legacy: try to auto-recover dirHandle from IndexedDB */
  async function tryAutoRecover() {
    const name = projectName.value
    if (!name || dirHandle.value) return null
    try {
      const record = await db.projectHandles.get(name)
      if (!record?.handle) return null
      const handle = record.handle
      const perm = await handle.queryPermission({ mode: 'read' })
      if (perm !== 'granted') {
        const requested = await handle.requestPermission({ mode: 'read' })
        if (requested !== 'granted') return null
      }
      dirHandle.value = handle
      const { ensurePalomaDir, readProjectInstructions, readActivePlans, readMcpConfig } = await import('../services/filesystem.js')
      await ensurePalomaDir(handle)
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
    } catch (e) {
      console.warn('[Project] Failed to recover dirHandle:', e)
      return null
    }
  }

  /** Resolve the full filesystem path for the current project via the bridge */
  async function resolveRoot() {
    if (projectRoot.value) return projectRoot.value
    try {
      const { resolveProjectPath } = await import('./useMCP.js').then(m => m.useMCP())
      const path = await resolveProjectPath(projectName.value)
      if (path) {
        projectRoot.value = path
        console.log('[Project] Resolved root:', path)
      }
    } catch (e) {
      console.warn('[Project] Failed to resolve root:', e)
    }
    return projectRoot.value
  }

  function detachProject() {
    dirHandle.value = null
    projectName.value = ''
    projectRoot.value = null
    projectInstructions.value = null
    activePlans.value = []
    roots.value = []
    mcpConfig.value = null
    setHash('', null)
  }

  function getHashSessionId() {
    return hashState.sessionId
  }

  function syncHash(sessionId) {
    setHash(projectName.value, sessionId)
  }

  return {
    dirHandle,
    projectName,
    projectRoot,
    projectInstructions,
    activePlans,
    roots,
    mcpConfig,
    projectLoading,
    needsReconnect,
    // New MCP-based methods
    switchProject,
    listProjects,
    refreshActivePlans,
    loadRoots: (callMcpTool) => loadRoots(callMcpTool, projectRoot.value),
    detachProject,
    // Legacy methods (kept for backward compat)
    openProject,
    tryAutoRecover,
    resolveRoot,
    closeProject: detachProject,
    getHashSessionId,
    syncHash
  }
}
