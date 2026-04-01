import { isDirectCliModel, isCodexModel, isCopilotModel, isGeminiModel, isOllamaModel, isQuinnGen5Model, isHolyTrinityModel, isArkModel, isHydraModel, isAccordionModel, isGen8Model, getCliModelName, getCodexModelName, getCopilotModelName, getGeminiModelName, getOllamaModelName, streamClaudeChat, streamCodexChat, streamCopilotChat, streamGeminiChat, streamOllamaChat } from '../services/claudeStream.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { buildSystemPrompt, buildOllamaSystemPrompt } from './useSystemPrompt.js'
import { classifyResult, sanitizeForDB } from '../utils/toolClassifier.js'
import db from '../services/db.js'

/**
 * Runs a CLI chat turn: streams Claude CLI output and returns { content, usage }.
 * Also persists the cliSessionId on the DB session.
 */
export async function runCliChat({ sessionId, model, fullContent, phase, projectInstructions, activePlans, roots, onContent, sessionState, thinkMode, paestroMode, hydraAngels }) {
  // If no sessionState, fall back to active
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const { sendClaudeChat, sendCodexChat, sendCopilotChat, sendGeminiChat, sendOllamaChat, sendQuinnGen5Chat, sendHolyTrinityChat, sendArkChat, sendHydraChat, sendAccordionChat, sendGen8Chat } = useMCP()
  const { addActivity, markActivityDone, toolActivity } = useToolExecution(sessionState)

  const useCodex = isCodexModel(model)
  const useCopilot = isCopilotModel(model)
  const useGemini = isGeminiModel(model)
  const useOllama = isOllamaModel(model)
  const isGen5 = isQuinnGen5Model(model)
  const isGen6 = isHolyTrinityModel(model)
  const isGen7 = isArkModel(model)
  const isHydra = isHydraModel(model)
  const isAccordion = isAccordionModel(model)
  const isGen8 = isGen8Model(model)
  const session = await db.sessions.get(sessionId)

  // If backend changed from previous session, start fresh
  const existingBackend = session?.cliBackend || 'claude'
  const currentBackend = useOllama ? 'ollama' : useGemini ? 'gemini' : useCopilot ? 'copilot' : useCodex ? 'codex' : 'claude'
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

  // Codex/Copilot direct chats do not get the pillar-manager resume reminder, so
  // reinforce Paloma's identity on resumed turns here to reduce backend drift.
  if (existingCliSession && (useCodex || useCopilot)) {
    const phaseLabel = phase
      ? phase.charAt(0).toUpperCase() + phase.slice(1)
      : 'Flow'
    const competingName = useCodex ? 'an OpenAI assistant' : 'GitHub Copilot'
    const identityReminder = `[IDENTITY: You are Paloma — not ${competingName}. ` +
      `You are Paloma, an AI development partner. Current phase: ${phaseLabel}. ` +
      `Follow all behavioral rules from your initial instructions.]\n\n`
    prompt = identityReminder + prompt
  }

  const resolvedModel = useOllama ? getOllamaModelName(model) : useGemini ? getGeminiModelName(model) : useCopilot ? getCopilotModelName(model) : useCodex ? getCodexModelName(model) : getCliModelName(model)
  const cliOptions = {
    prompt,
    model: resolvedModel,
    sessionId: existingCliSession,
    chatDbSessionId: (isGen6 || isGen7 || isHydra || isAccordion || isGen8) ? sessionId : undefined,
    systemPrompt: (existingCliSession || isDirectCliModel(model) || isGen5 || isGen6 || isGen7 || isHydra || isAccordion || isGen8)
      ? undefined
      : useOllama
        ? buildOllamaSystemPrompt(phase, projectInstructions)
        : buildSystemPrompt(phase, projectInstructions, activePlans, [], roots),
    cwd: useProject().projectRoot.value || undefined,
    enableTools: useOllama ? true : undefined,
    freshContext: (useOllama && !isGen5 && !isGen6 && !isGen7 && !isHydra && !isAccordion && !isGen8) ? true : undefined,
    thinkMode: thinkMode || undefined,
    paestroMode: paestroMode || undefined,
    hydraAngels: hydraAngels || undefined,
    model: model || undefined
  }

  let accumulatedContent = ''
  let usage = null
  const toolUseToActivity = new Map()  // toolUseId → activityId
  const toolUseMeta = new Map()        // toolUseId → { name, args }

  const sendFn = isGen8
    ? (opts, cbs) => sendGen8Chat(opts, cbs)
    : isAccordion
    ? (opts, cbs) => sendAccordionChat(opts, cbs)
    : isHydra
    ? (opts, cbs) => sendHydraChat(opts, cbs)
    : isGen7
    ? (opts, cbs) => sendArkChat(opts, cbs)
    : isGen6
    ? (opts, cbs) => sendHolyTrinityChat(opts, cbs)
    : isGen5
    ? (opts, cbs) => sendQuinnGen5Chat(opts, cbs)
    : useOllama
    ? (opts, cbs) => sendOllamaChat(opts, cbs)
    : useGemini
      ? (opts, cbs) => sendGeminiChat(opts, cbs)
      : useCopilot
        ? (opts, cbs) => sendCopilotChat(opts, cbs)
        : useCodex
          ? (opts, cbs) => sendCodexChat(opts, cbs)
          : (opts, cbs) => sendClaudeChat(opts, cbs)
  const streamGenerator = useOllama ? streamOllamaChat : useGemini ? streamGeminiChat : useCopilot ? streamCopilotChat : useCodex ? streamCodexChat : streamClaudeChat

  for await (const chunk of streamGenerator(sendFn, cliOptions)) {
    if (chunk.type === 'content') {
      accumulatedContent += chunk.text
      onContent(accumulatedContent)
    } else if (chunk.type === 'usage') {
      usage = chunk.usage
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
          const resolvedModelName = useOllama ? getOllamaModelName(model) : useGemini ? getGeminiModelName(model) : useCopilot ? getCopilotModelName(model) : useCodex ? getCodexModelName(model) : getCliModelName(model)
          registerFlowSession(cliSessionIdToRegister, resolvedModelName, cliOptions.cwd, sessionId)
        }
      }

      // Always update DB when session ID is provided — backends like Copilot may
      // emit a pre-generated UUID initially, then the real session ID from the result
      // event. The latest ID must be persisted for correct session resumption.
      if (chunk.sessionId) {
        await db.sessions.update(sessionId, { cliSessionId: chunk.sessionId, cliBackend: currentBackend })
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

  return { content: accumulatedContent, usage }
}

export function stopCli(sessionState, model) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }
  if (sessionState.cliRequestId) {
    const { stopClaudeChat, stopCodexChat, stopCopilotChat, stopGeminiChat, stopOllamaChat } = useMCP()
    if (model && isOllamaModel(model)) {
      stopOllamaChat(sessionState.cliRequestId)
    } else if (model && isGeminiModel(model)) {
      stopGeminiChat(sessionState.cliRequestId)
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
