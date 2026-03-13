/**
 * Slash command registry and execution.
 * Commands execute locally (no API tokens) and return formatted results.
 */

const STATUS_ICONS = {
  active: '🟢',
  paused: '⏸️',
  draft: '📝',
  completed: '✅',
  archived: '📦'
}

const VALID_STATUSES = ['active', 'paused', 'draft', 'completed', 'archived']

/**
 * Parse a plan filename into its parts.
 * Pattern: {status}-{YYYYMMDD}-{scope}-{slug}.md
 */
function parsePlanFilename(filename) {
  const match = filename.match(/^(active|paused|draft|completed|archived)-(\d{8})-([^-]+)-(.+)\.md$/)
  if (!match) return null
  return {
    status: match[1],
    date: match[2],
    scope: match[3],
    slug: match[4],
    filename
  }
}

/**
 * Build a short identifier for a plan (scope + slug).
 * Used for matching user input like "/plan complete fadden-demo-ui-prototype"
 */
function planId(plan) {
  return `${plan.scope}-${plan.slug}`
}

/**
 * Format a plan list grouped by status.
 */
function formatPlanList(plans, filterStatus = null) {
  const filtered = filterStatus
    ? plans.filter(p => p.status === filterStatus)
    : plans

  if (filtered.length === 0) {
    return filterStatus
      ? `No **${filterStatus}** plans found.`
      : 'No plans found in `.paloma/plans/`.'
  }

  // Group by status
  const groups = {}
  for (const plan of filtered) {
    if (!groups[plan.status]) groups[plan.status] = []
    groups[plan.status].push(plan)
  }

  // Display order: active first, then paused, draft, completed, archived
  const order = ['active', 'paused', 'draft', 'completed', 'archived']
  let output = `**Plans** (${filtered.length} total)\n\n`

  for (const status of order) {
    const group = groups[status]
    if (!group) continue
    output += `**${status.toUpperCase()}** (${group.length})\n`
    for (const plan of group) {
      output += `${STATUS_ICONS[status]} \`${planId(plan)}\` — ${plan.slug.replace(/-/g, ' ')}\n`
    }
    output += '\n'
  }

  output += '*Commands: `/plan activate <id>`, `/plan pause <id>`, `/plan complete <id>`, `/plan archive <id>`*'
  return output.trim()
}

/**
 * Execute the /plan command.
 * @param {string} args - Everything after "/plan " (e.g., "complete fadden-demo")
 * @param {Function} callMcpTool - MCP tool caller
 * @param {string} projectRoot - Current project root path
 * @returns {Promise<{handled: boolean, response: string}>}
 */
export async function executePlanCommand(args, callMcpTool, projectRoot) {
  if (!projectRoot) {
    return { handled: true, response: 'No project loaded. Use `/project <name>` to load one first.' }
  }

  const plansDir = `${projectRoot}/.paloma/plans`

  // List and parse all plan files
  let entries
  try {
    const result = await callMcpTool('mcp__filesystem__list_directory', { path: plansDir })
    entries = []
    if (typeof result === 'string') {
      for (const line of result.split('\n')) {
        const fileMatch = line.match(/^\[FILE\]\s+(.+)/)
        if (fileMatch) entries.push(fileMatch[1].trim())
      }
    }
  } catch {
    return { handled: true, response: `Could not read plans directory at \`${plansDir}\`.` }
  }

  const plans = entries.map(parsePlanFilename).filter(Boolean)

  const trimmed = args.trim().toLowerCase()

  // /plan — list all
  if (!trimmed) {
    return { handled: true, response: formatPlanList(plans) }
  }

  // /plan <status> — filter by status
  if (VALID_STATUSES.includes(trimmed)) {
    return { handled: true, response: formatPlanList(plans, trimmed) }
  }

  // /plan activate|pause|complete|archive <id>
  const transitionMatch = trimmed.match(/^(activate|pause|complete|archive)\s+(.+)$/)
  if (transitionMatch) {
    const action = transitionMatch[1]
    const targetId = transitionMatch[2].trim()

    const targetStatus = {
      activate: 'active',
      pause: 'paused',
      complete: 'completed',
      archive: 'archived'
    }[action]

    // Find matching plan (fuzzy: match against scope-slug, slug, or partial)
    const match = plans.find(p =>
      planId(p) === targetId ||
      p.slug === targetId ||
      planId(p).includes(targetId)
    )

    if (!match) {
      const available = plans.map(p => `\`${planId(p)}\``).join(', ')
      return {
        handled: true,
        response: `No plan matching \`${targetId}\` found.\n\nAvailable: ${available}`
      }
    }

    if (match.status === targetStatus) {
      return {
        handled: true,
        response: `\`${planId(match)}\` is already **${targetStatus}**.`
      }
    }

    // Rename file: change status prefix
    const oldFilename = match.filename
    const newFilename = `${targetStatus}-${match.date}-${match.scope}-${match.slug}.md`
    const oldPath = `${plansDir}/${oldFilename}`
    const newPath = `${plansDir}/${newFilename}`

    try {
      await callMcpTool('mcp__filesystem__move_file', { source: oldPath, destination: newPath })
    } catch (e) {
      return { handled: true, response: `Failed to rename plan: ${e.message}` }
    }

    // Update internal status line in the file
    try {
      await callMcpTool('mcp__filesystem__edit_file', {
        path: newPath,
        edits: [{ oldText: `**Status:** ${match.status}`, newText: `**Status:** ${targetStatus}` }]
      })
    } catch {
      // Non-critical — file might not have a status line
    }

    const icon = STATUS_ICONS[targetStatus]
    let contextNote = ''
    if (targetStatus === 'active') {
      contextNote = '\n\n*This plan will now be loaded into new conversation contexts.*'
    } else if (match.status === 'active') {
      contextNote = '\n\n*This plan will no longer be loaded into new conversation contexts.*'
    }

    return {
      handled: true,
      response: `${icon} **${planId(match)}** transitioned: ${match.status} → **${targetStatus}**\n\n\`${oldFilename}\` → \`${newFilename}\`${contextNote}`
    }
  }

  // /plan help or unknown
  return {
    handled: true,
    response: [
      '**`/plan` commands:**',
      '',
      '`/plan` — list all plans',
      '`/plan active` — show only active plans (loaded into context)',
      '`/plan paused` — show paused plans (in progress but not loaded)',
      '`/plan draft` — show drafts',
      '`/plan activate <id>` — promote to active (loads into context)',
      '`/plan pause <id>` — pause (keeps progress, removes from context)',
      '`/plan complete <id>` — mark as completed',
      '`/plan archive <id>` — archive',
      '',
      'Plan IDs use `scope-slug` format (e.g., `fadden-demo-ui-prototype`).',
      '',
      '**Context rule:** Only `active` plans are injected into new conversations. Use `pause` to keep working on a plan without it polluting other chats.'
    ].join('\n')
  }
}

/**
 * Execute the /clear command.
 * Returns a signal to clear the chat — handled by ChatView.
 */
function executeClearCommand() {
  return { handled: true, action: 'clear', response: 'Chat cleared.' }
}

/**
 * Execute the /model command.
 * Returns a signal to switch model — handled by ChatView.
 */
function executeModelCommand(args) {
  const model = args.trim()
  if (!model) {
    return {
      handled: true,
      response: [
        '**`/model` commands:**',
        '',
        '`/model <name>` — switch to a different model',
        '',
        '**CLI models:** `claude-cli:opus`, `claude-cli:sonnet`, `claude-cli:haiku`',
        '**Codex models:** `codex:gpt-5.1-codex-max`',
        '',
        'Or use any OpenRouter model ID (e.g., `anthropic/claude-3.5-sonnet`).'
      ].join('\n')
    }
  }
  return { handled: true, action: 'switch-model', model, response: `Model switched to **${model}**.` }
}

/**
 * Execute the /help command.
 */
function executeHelpCommand() {
  return {
    handled: true,
    response: [
      '**Paloma Commands**',
      '',
      '| Command | Description |',
      '|---------|-------------|',
      '| `/plan` | List and manage plans |',
      '| `/plan activate <id>` | Promote a plan to active |',
      '| `/plan pause <id>` | Pause an active plan |',
      '| `/plan complete <id>` | Mark plan as completed |',
      '| `/project <name>` | Switch project context |',
      '| `/model <name>` | Switch AI model |',
      '| `/clear` | Clear current chat history |',
      '| `/help` | Show this help |',
      '',
      '**Keyboard Shortcuts**',
      '',
      '| Shortcut | Action |',
      '|----------|--------|',
      '| `Ctrl+/` | Toggle sidebar |',
      '| `Ctrl+N` | New chat |',
      '| `Shift+Enter` | Send message |',
      '| `Escape` | Close modals / stop streaming |',
      '| `Y` / `N` | Approve / deny tool confirmation |',
      '| `@filename` | Attach file to message |'
    ].join('\n')
  }
}

/**
 * Check if a message is a slash command and execute it.
 * Returns { handled, response, action? } or { handled: false } if not a command.
 *
 * Special actions returned via `action` field:
 *   - 'clear': ChatView should clear the conversation
 *   - 'switch-model': ChatView should switch to `result.model`
 */
export async function handleSlashCommand(content, callMcpTool, projectRoot) {
  // Normalize: collapse all whitespace (newlines from textarea) into single spaces
  const trimmed = content.trim().replace(/\s+/g, ' ')

  // /plan [args]
  if (trimmed === '/plan' || trimmed.startsWith('/plan ')) {
    const args = trimmed.slice('/plan'.length)
    return executePlanCommand(args, callMcpTool, projectRoot)
  }

  // /clear
  if (trimmed === '/clear') {
    return executeClearCommand()
  }

  // /model [name]
  if (trimmed === '/model' || trimmed.startsWith('/model ')) {
    const args = trimmed.slice('/model'.length)
    return executeModelCommand(args)
  }

  // /help
  if (trimmed === '/help') {
    return executeHelpCommand()
  }

  return { handled: false }
}
