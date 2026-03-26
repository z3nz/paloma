import { BASE_INSTRUCTIONS, OLLAMA_INSTRUCTIONS, SINGULARITY_FRESH_PROMPT } from '../prompts/base.js'
import { PHASE_INSTRUCTIONS } from '../prompts/phases.js'

export function buildSystemPrompt(phase, projectInstructions, activePlans, enabledMcpTools = [], roots = []) {
  let prompt = BASE_INSTRUCTIONS

  if (enabledMcpTools.length > 0) {
    prompt += '\n\n## MCP Tools\n\nYou also have access to these tools provided by external MCP servers:\n'
    for (const tool of enabledMcpTools) {
      const fn = tool.function
      const serverName = fn.name.split('__')[1]
      prompt += `- ${fn.name} (server: ${serverName}) — ${fn.description}\n`
    }
  }

  // NOTE: projectInstructions and roots are NOT included here.
  // CLAUDE.md already provides them via @ references (.paloma/instructions.md, .paloma/roots/root-*.md).
  // Including them here would duplicate ~43KB of content and risk exceeding Linux's 128KB
  // per-argument limit (MAX_ARG_STRLEN) when passed via --append-system-prompt to claude CLI.

  if (activePlans?.length > 0) {
    prompt += '\n\n## Active Plans\n\n'
    prompt += 'The following plans are active. Read the full content with filesystem tools when needed (e.g., `mcp__filesystem__read_text_file` on `.paloma/plans/<name>`).\n\n'
    prompt += activePlans.map(p => `- \`.paloma/plans/${p.name}\``).join('\n')
  }

  const activePillar = phase || 'flow'
  prompt += '\n\n## Current Pillar: ' + activePillar.charAt(0).toUpperCase() + activePillar.slice(1) + '\n\n'
  prompt += PHASE_INSTRUCTIONS[activePillar] || PHASE_INSTRUCTIONS.flow

  return prompt
}

/**
 * Builds a condensed system prompt for Ollama (local) models.
 * Much shorter than the full prompt — focuses on function calling instructions
 * and anti-hallucination guardrails. Skips roots, plans, and heavy context
 * to stay within smaller context windows.
 */
export function buildOllamaSystemPrompt(phase, projectInstructions) {
  let prompt = OLLAMA_INSTRUCTIONS

  // Include project instructions but keep it brief
  if (projectInstructions) {
    // Only include the first section of project instructions to save context
    const truncated = projectInstructions.split('\n').slice(0, 40).join('\n')
    prompt += '\n\n## Project Context\n\n' + truncated
  }

  // Add Quinn Fresh identity for fresh-context singularity mode
  prompt += '\n\n' + SINGULARITY_FRESH_PROMPT

  return prompt
}
