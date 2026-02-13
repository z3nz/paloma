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
 * Check if a message is a slash command and execute it.
 * Returns { handled, response } or { handled: false } if not a command.
 */
export async function handleSlashCommand(content, callMcpTool, projectRoot) {
  // Normalize: collapse all whitespace (newlines from textarea) into single spaces
  const trimmed = content.trim().replace(/\s+/g, ' ')

  // /plan [args]
  if (trimmed === '/plan' || trimmed.startsWith('/plan ')) {
    const args = trimmed.slice('/plan'.length)
    return executePlanCommand(args, callMcpTool, projectRoot)
  }

  return { handled: false }
}
