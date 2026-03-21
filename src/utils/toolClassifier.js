/**
 * Tool result classification and smart summary generation.
 * Used by ToolCallGroup and ToolCallItem to render tool calls beautifully.
 */

// Server color palette
export const SERVER_COLORS = {
  filesystem: { bg: 'rgba(88, 166, 255, 0.15)', text: '#58a6ff', border: 'rgba(88, 166, 255, 0.3)' },
  git:        { bg: 'rgba(63, 185, 80, 0.15)',  text: '#3fb950', border: 'rgba(63, 185, 80, 0.3)' },
  shell:      { bg: 'rgba(210, 153, 34, 0.15)', text: '#d29922', border: 'rgba(210, 153, 34, 0.3)' },
  web:        { bg: 'rgba(57, 210, 192, 0.15)', text: '#39d2c0', border: 'rgba(57, 210, 192, 0.3)' },
  'brave-search': { bg: 'rgba(240, 136, 62, 0.15)', text: '#f0883e', border: 'rgba(240, 136, 62, 0.3)' },
  'fs-extra':  { bg: 'rgba(248, 81, 73, 0.15)',  text: '#f85149', border: 'rgba(248, 81, 73, 0.3)' },
  gmail:       { bg: 'rgba(234, 67, 53, 0.15)',  text: '#ea4335', border: 'rgba(234, 67, 53, 0.3)' },
  _default:    { bg: 'rgba(139, 148, 158, 0.15)', text: '#8b949e', border: 'rgba(139, 148, 158, 0.3)' }
}

/**
 * Parse an MCP tool name into { server, tool } parts.
 * "mcp__paloma__filesystem__read_text_file" -> { server: "filesystem", tool: "read_text_file" }
 * "filesystem__read_text_file" -> { server: "filesystem", tool: "read_text_file" }
 * "readFile" -> { server: null, tool: "readFile" }
 */
export function parseToolName(name) {
  if (!name) return { server: null, tool: name || '' }

  // mcp__paloma__server__tool_name
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    // mcp, paloma, server, ...tool parts
    if (parts.length >= 4) {
      return { server: parts[2], tool: parts.slice(3).join('__') }
    }
  }

  // server__tool_name (legacy/direct)
  if (name.includes('__')) {
    const parts = name.split('__')
    return { server: parts[0], tool: parts.slice(1).join('__') }
  }

  return { server: null, tool: name }
}

/**
 * Get color scheme for a server.
 */
export function getServerColor(server) {
  return SERVER_COLORS[server] || SERVER_COLORS._default
}

/**
 * Generate a smart one-line summary for a tool call.
 */
export function getToolSummary(toolName, args) {
  const { tool } = parseToolName(toolName)
  if (!args) return tool

  switch (tool) {
    // Filesystem reads
    case 'read_text_file':
    case 'read_file':
    case 'read_media_file':
      return shortPath(args.path)

    case 'read_multiple_files':
      return args.paths ? `${args.paths.length} files` : tool

    // Filesystem writes
    case 'write_file':
      return shortPath(args.path)

    case 'edit_file':
      return shortPath(args.path)

    // Filesystem navigation
    case 'list_directory':
    case 'list_directory_with_sizes':
      return shortPath(args.path)

    case 'directory_tree':
      return shortPath(args.path)

    case 'search_files':
      return args.pattern ? `"${args.pattern}" in ${shortPath(args.path)}` : shortPath(args.path)

    case 'create_directory':
      return shortPath(args.path)

    case 'move_file':
      return `${shortPath(args.source)} → ${shortPath(args.destination)}`

    case 'get_file_info':
      return shortPath(args.path)

    // fs-extra
    case 'delete':
      return shortPath(args.path)

    case 'copy':
      return `${shortPath(args.source)} → ${shortPath(args.destination)}`

    // Git
    case 'git_status':
      return 'working tree status'

    case 'git_diff':
      if (args.file) return shortPath(args.file)
      if (args.staged) return 'staged changes'
      if (args.commit1 && args.commit2) return `${args.commit1.slice(0, 7)}..${args.commit2.slice(0, 7)}`
      return 'working tree diff'

    case 'git_log':
      return args.maxCount ? `last ${args.maxCount} commits` : 'commit history'

    case 'git_commit':
      return args.message ? truncate(args.message, 50) : 'commit'

    case 'git_add':
      if (typeof args.files === 'string') return args.files === '.' ? 'all changes' : args.files
      if (Array.isArray(args.files)) return `${args.files.length} files`
      return 'staging'

    case 'git_branch':
      return args.branchName || args.mode || 'branches'

    case 'git_checkout':
      return args.branchOrPath || 'checkout'

    case 'git_push':
      return args.branch || 'push'

    case 'git_pull':
      return args.branch || 'pull'

    case 'git_stash':
      return args.mode || 'stash'

    case 'git_show':
      return args.ref ? args.ref.slice(0, 12) : 'show'

    case 'git_set_working_dir':
      return shortPath(args.path)

    // Shell
    case 'shell_grep':
      return args.args ? args.args.filter(a => !a.startsWith('-')).join(' ') : 'grep'

    case 'shell_find':
      return args.args ? args.args.filter(a => !a.startsWith('-')).join(' ') : 'find'

    case 'shell_cat':
      return args.args ? shortPath(args.args[0]) : 'cat'

    case 'shell_ls':
      return args.args?.[0] ? shortPath(args.args[0]) : '.'

    // Web
    case 'web_fetch':
      return args.url ? truncateUrl(args.url) : 'fetch'

    case 'web_download':
      return args.url ? truncateUrl(args.url) : 'download'

    // Search
    case 'brave_web_search':
      return args.query ? `"${truncate(args.query, 40)}"` : 'search'

    case 'brave_local_search':
      return args.query ? `"${truncate(args.query, 40)}"` : 'local search'

    // Gmail
    case 'email_read':
      return args.messageId ? `message ${truncate(args.messageId, 16)}` : 'read email'

    case 'email_reply':
      return args.to ? `to: ${truncate(args.to, 40)}` : 'reply'

    case 'email_send':
      return args.to ? `to: ${truncate(args.to, 40)}` : 'send'

    case 'email_list':
      return args.query ? `"${truncate(args.query, 40)}"` : 'inbox'

    default: {
      // Generic: show first short string arg value
      const firstStr = Object.values(args).find(v => typeof v === 'string' && v.length < 60)
      return firstStr ? truncate(firstStr, 50) : tool
    }
  }
}

/**
 * Classify the result content of a tool call for smart rendering.
 */
export function classifyResult(toolName, content) {
  if (!content) return 'empty'

  const str = typeof content === 'string' ? content : JSON.stringify(content)

  // Error detection
  if (str.startsWith('{"error":') || str.startsWith('Error:') || str.startsWith('ENOENT')) {
    return 'error'
  }

  const { tool } = parseToolName(toolName)

  // Email
  if (tool === 'email_read') return 'email'
  if (tool === 'email_reply' || tool === 'email_send') return 'email-sent'

  // Git diff
  if (tool === 'git_diff' || str.startsWith('diff --git') || /^@@\s/.test(str)) {
    return 'diff'
  }

  // JSON — try parsing
  if ((str.startsWith('{') || str.startsWith('[')) && str.length > 2) {
    try {
      JSON.parse(str)
      return 'json'
    } catch { /* not json */ }
  }

  // File content — from read tools
  if (tool === 'read_text_file' || tool === 'read_file' || tool === 'shell_cat') {
    return 'file-content'
  }

  // Directory tree
  if (tool === 'directory_tree' || tool === 'list_directory' || tool === 'list_directory_with_sizes') {
    return 'directory'
  }

  return 'plain-text'
}

/**
 * Infer language from a file path for syntax highlighting.
 */
export function inferLanguage(path) {
  if (!path) return ''
  const ext = path.split('.').pop()?.toLowerCase()
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    vue: 'html', svelte: 'html',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', scala: 'scala',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', mdx: 'markdown',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    sql: 'sql', graphql: 'graphql',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    r: 'r', lua: 'lua', php: 'php', swift: 'swift',
    conf: 'ini', ini: 'ini', env: 'ini',
  }
  return map[ext] || ext || ''
}

/** Strip non-cloneable values (Vue reactive proxies, functions, etc.) for IndexedDB. */
export function sanitizeForDB(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch { return obj }
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

/**
 * Get a result size summary (line count or byte estimate).
 */
export function getResultSize(content) {
  if (!content) return null
  const str = typeof content === 'string' ? content : JSON.stringify(content)
  const lines = str.split('\n').length
  if (lines > 1) return `${lines} lines`
  if (str.length > 200) return `${Math.round(str.length / 1024 * 10) / 10}KB`
  return null
}

// --- Helpers ---

function shortPath(p) {
  if (!p) return ''
  // Strip common prefixes
  const stripped = p
    .replace(/^\/home\/[^/]+\//, '~/')
    .replace(/^~\/paloma\//, '')
  // If still long, show last 2 segments
  const parts = stripped.split('/')
  if (parts.length > 3) return '.../' + parts.slice(-2).join('/')
  return stripped
}

function truncate(str, max) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '...' : str
}

function truncateUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname
    return u.hostname + path
  } catch {
    return truncate(url, 50)
  }
}
