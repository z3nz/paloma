import { ref, watch } from 'vue'

const _saved = import.meta.hot ? window.__PALOMA_PERMISSIONS__ : undefined

// Session-level approvals: Set of server names or "server::tool" keys
const sessionApprovals = ref(_saved?.sessionApprovals ?? new Set())

// Hog Wild mode: auto-approve ALL tools (always ON)
const hogWild = ref(true)

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

/**
 * Extract the bare tool name from a full namespaced tool name.
 * - MCP tools: "mcp__filesystem__read_text_file" → "read_text_file"
 * - CLI proxy tools: "git__git_status" → "git_status"
 * - Built-in tools: "createFile" → null
 */
export function extractToolName(toolName) {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return parts.slice(2).join('__') || null
  }
  if (toolName.includes('__')) {
    const parts = toolName.split('__')
    return parts.slice(1).join('__') || null
  }
  return null
}

export function usePermissions() {
  /**
   * Check if a tool is auto-approved via session or project config.
   *
   * Supports mixed autoExecute entries:
   * - String: "filesystem" → all tools in that server
   * - Object with tools: { server: "filesystem", tools: ["read_text_file"] } → allowlist
   * - Object with except: { server: "git", except: ["git_reset"] } → blocklist
   * - tools takes precedence over except if both present
   */
  function isAutoApproved(toolName, mcpConfig) {
    if (hogWild.value) return true

    const server = extractServerName(toolName)
    if (!server) return false
    const tool = extractToolName(toolName)

    // --- Session-level checks ---
    if (sessionApprovals.value.has(server)) return true
    if (tool && sessionApprovals.value.has(`${server}::${tool}`)) return true

    // --- Project-level checks (mcp.json autoExecute) ---
    const autoExec = mcpConfig?.autoExecute
    if (!autoExec) return false

    for (const entry of autoExec) {
      if (typeof entry === 'string') {
        if (entry === server) return true
      } else if (entry?.server === server) {
        if (entry.tools) {
          return tool ? entry.tools.includes(tool) : false
        }
        if (entry.except) {
          return tool ? !entry.except.includes(tool) : true
        }
        return true
      }
    }

    return false
  }

  // --- Server-level session functions ---

  function approveForSession(serverName) {
    const next = new Set(sessionApprovals.value)
    next.add(serverName)
    sessionApprovals.value = next
  }

  function revokeSession(serverName) {
    const next = new Set(sessionApprovals.value)
    next.delete(serverName)
    for (const key of next) {
      if (key.startsWith(`${serverName}::`)) next.delete(key)
    }
    sessionApprovals.value = next
  }

  // --- Per-tool session functions ---

  function approveToolForSession(serverName, toolName) {
    const next = new Set(sessionApprovals.value)
    next.add(`${serverName}::${toolName}`)
    sessionApprovals.value = next
  }

  function revokeToolSession(serverName, toolName) {
    const next = new Set(sessionApprovals.value)
    next.delete(`${serverName}::${toolName}`)
    sessionApprovals.value = next
  }

  // --- General ---

  function clearSession() {
    sessionApprovals.value = new Set()
  }

  function toggleHogWild() {
    hogWild.value = !hogWild.value
  }

  /**
   * Get the permission tier for a specific tool.
   * @returns {'project'|'session'|'none'}
   */
  function getToolPermTier(serverName, toolName, mcpConfig) {
    const autoExec = mcpConfig?.autoExecute
    if (autoExec) {
      for (const entry of autoExec) {
        if (typeof entry === 'string' && entry === serverName) return 'project'
        if (entry?.server === serverName) {
          if (entry.tools) {
            if (entry.tools.includes(toolName)) return 'project'
          } else if (entry.except) {
            if (!entry.except.includes(toolName)) return 'project'
          } else {
            return 'project'
          }
        }
      }
    }

    if (sessionApprovals.value.has(serverName)) return 'session'
    if (sessionApprovals.value.has(`${serverName}::${toolName}`)) return 'session'

    return 'none'
  }

  return {
    sessionApprovals,
    hogWild,
    isAutoApproved,
    approveForSession,
    revokeSession,
    approveToolForSession,
    revokeToolSession,
    clearSession,
    toggleHogWild,
    getToolPermTier,
  }
}
