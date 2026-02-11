import { isDirectCliModel, getCliModelName, streamClaudeChat } from '../services/claudeStream.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import db from '../services/db.js'

let cliRequestId = null

/**
 * Runs a CLI chat turn: streams Claude CLI output and returns { content, usage }.
 * Also persists the cliSessionId on the DB session.
 */
export async function runCliChat({ sessionId, model, fullContent, phase, projectInstructions, activePlans, onContent }) {
  const { sendClaudeChat } = useMCP()
  const { addActivity, markActivityDone } = useToolExecution()

  const session = await db.sessions.get(sessionId)
  const existingCliSession = session?.cliSessionId || null
  console.log(`[cli] ${existingCliSession ? 'Resuming' : 'New'} session, model=${model}`)

  const cliOptions = {
    prompt: fullContent,
    model: getCliModelName(model),
    sessionId: existingCliSession,
    systemPrompt: existingCliSession || isDirectCliModel(model) ? undefined : buildSystemPrompt(phase, projectInstructions, activePlans),
    cwd: useProject().projectRoot.value || undefined
  }

  let accumulatedContent = ''
  let usage = null
  // Map tool_use block ids to activity ids
  const toolUseToActivity = new Map()

  for await (const chunk of streamClaudeChat(
    (opts, cbs) => sendClaudeChat(opts, cbs),
    cliOptions
  )) {
    if (chunk.type === 'content') {
      accumulatedContent += chunk.text
      onContent(accumulatedContent)
    } else if (chunk.type === 'usage') {
      usage = chunk.usage
    } else if (chunk.type === 'session_id') {
      cliRequestId = chunk.requestId
      if (!existingCliSession && chunk.sessionId) {
        await db.sessions.update(sessionId, { cliSessionId: chunk.sessionId })
      }
    } else if (chunk.type === 'tool_use') {
      const activityId = addActivity(chunk.name, chunk.input)
      toolUseToActivity.set(chunk.id, activityId)
    } else if (chunk.type === 'tool_result') {
      const activityId = toolUseToActivity.get(chunk.toolUseId)
      if (activityId) markActivityDone(activityId)
    }
  }

  return { content: accumulatedContent, usage }
}

export function stopCli() {
  if (cliRequestId) {
    const { stopClaudeChat } = useMCP()
    stopClaudeChat(cliRequestId)
    cliRequestId = null
  }
}

export function clearCliRequestId() {
  cliRequestId = null
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
