import { BASE_INSTRUCTIONS, OLLAMA_INSTRUCTIONS } from '../prompts/base.js'
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

  if (projectInstructions) {
    prompt += '\n\n## Project Instructions\n\n' + projectInstructions
  }

  if (activePlans?.length > 0) {
    prompt += '\n\n## Active Plans\n\n'
    prompt += activePlans.map(p =>
      `<plan name="${p.name}">\n${p.content}\n</plan>`
    ).join('\n\n')
  }

  // Layer 4.5: Roots — foundational values that inform all decisions
  if (roots?.length > 0) {
    prompt += '\n\n## Roots\n\n'
    prompt += 'These are Paloma\'s foundational values. They inform all decisions and interactions.\n\n'
    prompt += roots.map(r =>
      `<root name="${r.name}">\n${r.content}\n</root>`
    ).join('\n\n')
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

  // Add a brief pillar note (not the full phase instructions)
  const activePillar = phase || 'flow'
  prompt += `\n\nYou are currently in the **${activePillar.charAt(0).toUpperCase() + activePillar.slice(1)}** pillar.`

  return prompt
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
