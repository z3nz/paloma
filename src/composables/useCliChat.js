import { isDirectCliModel, isCodexModel, isCopilotModel, isOllamaModel, getCliModelName, getCodexModelName, getCopilotModelName, getOllamaModelName, streamClaudeChat, streamCodexChat, streamCopilotChat, streamOllamaChat } from '../services/claudeStream.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { buildSystemPrompt, buildOllamaSystemPrompt } from './useSystemPrompt.js'
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

  const { sendClaudeChat, sendCodexChat, sendCopilotChat, sendOllamaChat } = useMCP()
  const { addActivity, markActivityDone, toolActivity } = useToolExecution(sessionState)

  const useCodex = isCodexModel(model)
  const useCopilot = isCopilotModel(model)
  const useOllama = isOllamaModel(model)
  const session = await db.sessions.get(sessionId)

  // If backend changed from previous session, start fresh
  const existingBackend = session?.cliBackend || 'claude'
  const currentBackend = useOllama ? 'ollama' : useCopilot ? 'copilot' : useCodex ? 'codex' : 'claude'
  const existingCliSession = (existingBackend === currentBackend) ? (session?.cliSessionId || null) : null
  console.log(`[cli] ${existingCliSession ? 'Resuming' : 'New'} ${currentBackend} session, model=${model}`)

  // Recovery: if starting a new CLI session but prior user messages exist without
  // assistant responses (e.g. first send failed), include them so they aren't lost.
  let prompt = fullContent
  if (!existingCliSession && sessionState?.messages?.value?.length > 1) {
    const msgs = sessionState.messages.value
    const unanswered = []
    for (const m of msgs) {
      if (m.role === 'assistant') { unanswered.length = 0; continue }
      if (m.role === 'user' && m.content !== fullContent) unanswered.push(m.content)
    }
    if (unanswered.length > 0) {
      console.log(`[cli] Recovering ${unanswered.length} unanswered message(s) into prompt`)
      prompt = unanswered.join('\n\n') + '\n\n' + fullContent
    }
  }

  const resolvedModel = useOllama ? getOllamaModelName(model) : useCopilot ? getCopilotModelName(model) : useCodex ? getCodexModelName(model) : getCliModelName(model)
  const cliOptions = {
    prompt,
    model: resolvedModel,
    sessionId: existingCliSession,
    systemPrompt: existingCliSession || isDirectCliModel(model)
      ? undefined
      : useOllama
        ? buildOllamaSystemPrompt(phase, projectInstructions)
        : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots),
    cwd: useProject().projectRoot.value || undefined,
    enableTools: useOllama ? true : undefined
  }

  let accumulatedContent = ''
  let usage = null
  const toolUseToActivity = new Map()  // toolUseId → activityId
  const toolUseMeta = new Map()        // toolUseId → { name, args }

  const sendFn = useOllama
    ? (opts, cbs) => sendOllamaChat(opts, cbs)
    : useCopilot
      ? (opts, cbs) => sendCopilotChat(opts, cbs)
      : useCodex
        ? (opts, cbs) => sendCodexChat(opts, cbs)
        : (opts, cbs) => sendClaudeChat(opts, cbs)
  const streamGenerator = useOllama ? streamOllamaChat : useCopilot ? streamCopilotChat : useCodex ? streamCodexChat : streamClaudeChat

  for await (const chunk of streamGenerator(sendFn, cliOptions)) {
    if (chunk.type === 'content') {
      accumulatedContent += chunk.text
      onContent(accumulatedContent)
    } else if (chunk.type === 'usage') {
      usage = chunk.usage
    } else if (chunk.type === 'session_id') {
      sessionState.cliRequestId = chunk.requestId
      if (!existingCliSession && chunk.sessionId) {
        await db.sessions.update(sessionId, { cliSessionId: chunk.sessionId, cliBackend: currentBackend })
      } else if (existingBackend !== currentBackend) {
        // Backend changed — store new session ID and backend
        await db.sessions.update(sessionId, { cliSessionId: chunk.sessionId, cliBackend: currentBackend })
      }
      // Register Flow sessions for pillar auto-callback notifications (Claude only)
      if (phase === 'flow' && !useCodex && !useCopilot && !useOllama) {
        const cliSessionIdToRegister = chunk.sessionId || existingCliSession
        if (cliSessionIdToRegister) {
          const { registerFlowSession } = useMCP()
          registerFlowSession(cliSessionIdToRegister, getCliModelName(model), cliOptions.cwd, sessionId)
        }
      }
    } else if (chunk.type === 'tool_use') {
      const activityId = addActivity(chunk.name, chunk.input)
      toolUseToActivity.set(chunk.id, activityId)
      toolUseMeta.set(chunk.id, { name: chunk.name, args: chunk.input })
    } else if (chunk.type === 'tool_result') {
      const activityId = toolUseToActivity.get(chunk.toolUseId)
      const meta = toolUseMeta.get(chunk.toolUseId)

      // Normalize result content to string (safe against circular refs)
      let resultStr
      try {
        resultStr = typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content.map(c => c.text || '').join('')
            : JSON.stringify(chunk.content)
      } catch {
        resultStr = '[Error serializing tool result]'
      }

      if (activityId) {
        markActivityDone(activityId, resultStr)
      }

      // Clean up Maps to prevent unbounded growth in long sessions
      toolUseToActivity.delete(chunk.toolUseId)
      toolUseMeta.delete(chunk.toolUseId)

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

export function stopCli(sessionState, model) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }
  if (sessionState.cliRequestId) {
    const { stopClaudeChat, stopCodexChat, stopCopilotChat, stopOllamaChat } = useMCP()
    if (model && isOllamaModel(model)) {
      stopOllamaChat(sessionState.cliRequestId)
    } else if (model && isCopilotModel(model)) {
      stopCopilotChat(sessionState.cliRequestId)
    } else if (model && isCodexModel(model)) {
      stopCodexChat(sessionState.cliRequestId)
    } else {
      stopClaudeChat(sessionState.cliRequestId)
    }
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
