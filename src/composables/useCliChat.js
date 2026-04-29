import { ref } from 'vue'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { buildSystemPrompt, buildOllamaSystemPrompt } from './useSystemPrompt.js'
import { classifyResult, sanitizeForDB } from '../utils/toolClassifier.js'
import {
  isDirectCliModel, isCodexModel, isCopilotModel, isGeminiModel, isOllamaModel,
  isQuinnGen5Model, isHolyTrinityModel, isArkModel, isHydraModel, isAccordionModel, isPaestroModel,
  getCliModelName, getCodexModelName, getCopilotModelName, getGeminiModelName, getOllamaModelName,
  streamClaudeChat, streamCodexChat, streamCopilotChat, streamGeminiChat, streamOllamaChat
} from '../services/claudeStream.js'
import db from '../services/db.js'

/**
 * Map model ID → { backendKey, modelName, sendFn, streamGenerator, stopFn }.
 * Must be called inside a Vue component/composable context so useMCP() works.
 */
function resolveBackend(model) {
  const {
    sendClaudeChat, sendCodexChat, sendCopilotChat, sendGeminiChat, sendOllamaChat,
    sendQuinnGen5Chat, sendHolyTrinityChat, sendArkChat, sendHydraChat, sendAccordionChat, sendPaestroChat,
    stopClaudeChat, stopCodexChat, stopCopilotChat, stopGeminiChat, stopOllamaChat
  } = useMCP()

  if (isPaestroModel(model))    return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendPaestroChat,    streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isAccordionModel(model))  return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendAccordionChat,  streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isHydraModel(model))      return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendHydraChat,      streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isArkModel(model))        return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendArkChat,        streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isHolyTrinityModel(model))return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendHolyTrinityChat,streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isQuinnGen5Model(model))  return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendQuinnGen5Chat,  streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isOllamaModel(model))     return { backendKey: 'ollama',  modelName: getOllamaModelName(model), sendFn: sendOllamaChat,     streamGenerator: streamOllamaChat,  stopFn: stopOllamaChat }
  if (isGeminiModel(model))     return { backendKey: 'gemini',  modelName: getGeminiModelName(model), sendFn: sendGeminiChat,     streamGenerator: streamGeminiChat,  stopFn: stopGeminiChat }
  if (isCopilotModel(model))    return { backendKey: 'copilot', modelName: getCopilotModelName(model),sendFn: sendCopilotChat,    streamGenerator: streamCopilotChat, stopFn: stopCopilotChat }
  if (isCodexModel(model))      return { backendKey: 'codex',   modelName: getCodexModelName(model),  sendFn: sendCodexChat,      streamGenerator: streamCodexChat,   stopFn: stopCodexChat }
  return                               { backendKey: 'claude',  modelName: getCliModelName(model),    sendFn: sendClaudeChat,     streamGenerator: streamClaudeChat,  stopFn: stopClaudeChat }
}

/**
 * Runs a CLI chat turn: streams CLI output and returns { content, usage }.
 * Also persists the cliSessionId on the DB session.
 */
export async function runCliChat({ sessionId, model, fullContent, phase, projectInstructions, activePlans, roots, onContent, sessionState, thinkMode, paestroMode, hydraAngels }) {
  // If no sessionState, fall back to active
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const { addActivity, markActivityDone, toolActivity } = useToolExecution(sessionState)

  const isGen5 = isQuinnGen5Model(model)
  const isGen6 = isHolyTrinityModel(model)
  const isGen7 = isArkModel(model)
  const isHydra = isHydraModel(model)
  const isAccordion = isAccordionModel(model)
  const isPaestro = isPaestroModel(model)
  
  const { sendFn, stopFn, streamGenerator, modelName, backendKey } = resolveBackend(model)
  const session = await db.sessions.get(sessionId)

  // If backend changed from previous session, start fresh
  const existingBackend = session?.cliBackend || 'claude'
  const currentBackend = backendKey
  const existingCliSession = (existingBackend === currentBackend) ? (session?.cliSessionId || null) : null

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

  // Codex/Copilot direct chats do not get the pillar-manager resume reminder, so
  // reinforce Paloma's identity on resumed turns here to reduce backend drift.
  if (existingCliSession && (backendKey === 'codex' || backendKey === 'copilot')) {
    const phaseLabel = phase
      ? phase.charAt(0).toUpperCase() + phase.slice(1)
      : 'Flow'
    const identityReminder = `[IDENTITY: You are Paloma — not ${backendKey === 'codex' ? 'an OpenAI assistant' : 'GitHub Copilot'}. ` +
      `You are Paloma, an AI development partner. Current phase: ${phaseLabel}. ` +
      `Follow all behavioral rules from your initial instructions.]\n\n`
    prompt = identityReminder + prompt
  }

  const resolvedModel = modelName
  const cliOptions = {
    prompt,
    model: resolvedModel,
    sessionId: existingCliSession,
    chatDbSessionId: (isGen6 || isGen7 || isHydra || isAccordion || isPaestro) ? sessionId : undefined,
    systemPrompt: (existingCliSession || isDirectCliModel(model) || isGen5 || isGen6 || isGen7 || isHydra || isAccordion || isPaestro)
      ? undefined
      : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots),
    cwd: useProject().projectRoot.value || undefined,
    enableTools: backendKey === 'ollama' ? true : undefined,
    freshContext: (backendKey === 'ollama' && !isGen5 && !isGen6 && !isGen7 && !isHydra && !isAccordion && !isPaestro) ? true : undefined,
    thinkMode: thinkMode || undefined,
    paestroMode: paestroMode || undefined,
    hydraAngels: hydraAngels || undefined,
    model: model || undefined
  }

  const accumulatedContent = ref('')
  const usage = ref(null)
  const toolUseToActivity = new Map()  // toolUseId → activityId
  const toolUseMeta = new Map()        // toolUseId → { name, args }

  const sendFnLocal = (opts, cbs) => sendFn(opts, cbs)
  const streamGen = streamGenerator || streamClaudeChat

  for await (const chunk of streamGen(sendFnLocal, cliOptions)) {
    if (chunk.type === 'content') {
      accumulatedContent.value += chunk.text
      onContent(accumulatedContent.value)
    } else if (chunk.type === 'usage') {
      usage.value = chunk.usage
    } else if (chunk.type === 'session_id') {
      sessionState.cliRequestId = chunk.requestId
      
      // Register Flow sessions for pillar auto-callback notifications and parent association.
      // All backends need registration so pillar children are correctly parented to
      // the spawning chat (not the last-active Claude session).
      // DO THIS SYNCHRONOUSLY before await db.sessions.update to avoid race condition!
      if (phase === 'flow') {
        const cliSessionIdToRegister = chunk.sessionId || existingCliSession
        if (cliSessionIdToRegister) {
          const { registerFlowSession } = useMCP()
          const resolvedModelName = modelName
          registerFlowSession(cliSessionIdToRegister, resolvedModelName, cliOptions.cwd, sessionId)
        }
      }

      // Always update DB when session ID is provided — backends like Copilot may
      // emit a pre-generated UUID initially, then the real session ID from the result
      // event. The latest ID must be persisted for correct session resumption.
      if (chunk.sessionId) {
        await db.sessions.update(sessionId, { cliSessionId: chunk.sessionId, cliBackend: currentBackend })
        // Track current model for stopFn validation
        if (sessionState) sessionState.currentModel = model
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

  // Clean up Maps to prevent leaks if tool_result events were missed
  toolUseToActivity.clear()
  toolUseMeta.clear()

  return { content: accumulatedContent.value, usage: usage.value }
}

export function stopCli(sessionState, model) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }
  if (sessionState.cliRequestId) {
    const { stopFn: stopFnForModel } = resolveBackend(model)
    stopFnForModel(sessionState.cliRequestId)
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