import { isDirectCliModel, getCliModelName, streamClaudeChat } from '../services/claudeStream.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import { classifyResult } from '../utils/toolClassifier.js'
import db from '../services/db.js'

/** Strip non-cloneable values for IndexedDB. */
function sanitizeForDB(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch { return obj }
}

/**
 * Runs a CLI chat turn: streams Claude CLI output and returns { content, usage }.
 * Also persists the cliSessionId on the DB session.
 */
export async function runCliChat({ sessionId, model, fullContent, phase, projectInstructions, activePlans, roots, onContent, sessionState }) {
  // If no sessionState, fall back to active
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const { sendClaudeChat } = useMCP()
  const { addActivity, markActivityDone, toolActivity } = useToolExecution(sessionState)

  const session = await db.sessions.get(sessionId)
  const existingCliSession = session?.cliSessionId || null
  console.log(`[cli] ${existingCliSession ? 'Resuming' : 'New'} session, model=${model}`)

  const cliOptions = {
    prompt: fullContent,
    model: getCliModelName(model),
    sessionId: existingCliSession,
    systemPrompt: existingCliSession || isDirectCliModel(model) ? undefined : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots),
    cwd: useProject().projectRoot.value || undefined
  }

  let accumulatedContent = ''
  let usage = null
  const toolUseToActivity = new Map()  // toolUseId → activityId
  const toolUseMeta = new Map()        // toolUseId → { name, args }

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
      // Register Flow sessions for pillar auto-callback notifications
      if (phase === 'flow') {
        const cliSessionIdToRegister = chunk.sessionId || existingCliSession
        if (cliSessionIdToRegister) {
          const { registerFlowSession } = useMCP()
          registerFlowSession(cliSessionIdToRegister, getCliModelName(model), cliOptions.cwd)
        }
      }
    } else if (chunk.type === 'tool_use') {
      console.log('[cli] GOT tool_use:', chunk.id, chunk.name, JSON.stringify(chunk.input)?.slice(0, 200))
      const activityId = addActivity(chunk.name, chunk.input)
      toolUseToActivity.set(chunk.id, activityId)
      toolUseMeta.set(chunk.id, { name: chunk.name, args: chunk.input })
    } else if (chunk.type === 'tool_result') {
      console.log('[cli] GOT tool_result:', chunk.toolUseId, typeof chunk.content, JSON.stringify(chunk.content)?.slice(0, 200))
      const activityId = toolUseToActivity.get(chunk.toolUseId)
      const meta = toolUseMeta.get(chunk.toolUseId)

      // Normalize result content to string
      const resultStr = typeof chunk.content === 'string'
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.map(c => c.text || '').join('')
          : JSON.stringify(chunk.content)

      if (activityId) {
        markActivityDone(activityId, resultStr)
      }

      // Persist as role:'tool' message (same shape as OpenRouter path)
      if (meta) {
        const toolMsg = sanitizeForDB({
          sessionId,
          role: 'tool',
          toolCallId: activityId || chunk.toolUseId,
          toolName: meta.name,
          toolArgs: meta.args,
          content: resultStr,
          resultType: classifyResult(meta.name, resultStr),
          timestamp: Date.now()
        })
        const toolMsgId = await db.messages.add(toolMsg)
        toolMsg.id = toolMsgId
        sessionState.messages.value.push(toolMsg)
      }
    }
  }

  // Safety net: mark any still-running activities as done when stream ends.
  // CLI stream-json may not always emit explicit tool_result events for every tool_use.
  for (const activity of toolActivity.value) {
    if (activity.status === 'running') {
      markActivityDone(activity.id)
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
