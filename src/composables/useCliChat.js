import { isDirectCliModel, getCliModelName, streamClaudeChat } from '../services/claudeStream.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import db from '../services/db.js'

/**
 * Runs a CLI chat turn: streams Claude CLI output and returns { content, usage }.
 * Also persists the cliSessionId on the DB session.
 */
export async function runCliChat({ sessionId, model, fullContent, phase, projectInstructions, activePlans, onContent, sessionState }) {
  // If no sessionState, fall back to active
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const { sendClaudeChat } = useMCP()
  const { addActivity, markActivityDone } = useToolExecution(sessionState)

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
      sessionState.cliRequestId = chunk.requestId
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

export function stopCli(sessionState) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }
  if (sessionState.cliRequestId) {
    const { stopClaudeChat } = useMCP()
    stopClaudeChat(sessionState.cliRequestId)
    sessionState.cliRequestId = null
  }
}

export function clearCliRequestId(sessionState) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }
  sessionState.cliRequestId = null
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
