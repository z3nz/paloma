import { ref, watch } from 'vue'

const _saved = import.meta.hot ? window.__PALOMA_PERMISSIONS__ : undefined

// Session-level approvals: Set of server names approved for this session
const sessionApprovals = ref(_saved?.sessionApprovals ?? new Set())

// Hog Wild mode: auto-approve ALL tools (session-scoped, resets on refresh)
const hogWild = ref(_saved?.hogWild ?? false)

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_PERMISSIONS__ = {
      sessionApprovals: sessionApprovals.value,
      hogWild: hogWild.value
    }
  }
  save()
  watch(sessionApprovals, save, { flush: 'sync' })
  watch(hogWild, save, { flush: 'sync' })
  import.meta.hot.accept()
}

/**
 * Extract the server name from a tool name.
 * - MCP tools: "mcp__filesystem__list_directory" → "filesystem"
 * - CLI proxy tools: "git__git_status" → "git"
 * - Built-in tools: "createFile" → null
 */
export function extractServerName(toolName) {
  if (toolName.startsWith('mcp__')) {
    return toolName.split('__')[1] || null
  }
  if (toolName.includes('__')) {
    return toolName.split('__')[0] || null
  }
  return null
}

export function usePermissions() {
  /**
   * Check if a tool is auto-approved via session or project config.
   * @param {string} toolName - Full tool name
   * @param {Object|null} mcpConfig - Project MCP config with autoExecute array
   */
  function isAutoApproved(toolName, mcpConfig) {
    if (hogWild.value) return true

    const server = extractServerName(toolName)
    if (!server) return false

    // Session-level approval
    if (sessionApprovals.value.has(server)) return true

    // Project-level approval (from .paloma/mcp.json autoExecute)
    if (mcpConfig?.autoExecute?.includes(server)) return true

    return false
  }

  function approveForSession(serverName) {
    const next = new Set(sessionApprovals.value)
    next.add(serverName)
    sessionApprovals.value = next
  }

  function clearSession() {
    sessionApprovals.value = new Set()
  }

  function toggleHogWild() {
    hogWild.value = !hogWild.value
  }

  return {
    sessionApprovals,
    hogWild,
    isAutoApproved,
    approveForSession,
    clearSession,
    toggleHogWild,
  }
}
