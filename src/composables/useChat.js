import { computed } from 'vue'
import db from '../services/db.js'
import { readFile } from '../services/filesystem.js'
import { getAllTools } from '../services/tools.js'
import { useOpenRouter } from './useOpenRouter.js'
import { useMCP } from './useMCP.js'
import { usePermissions } from './usePermissions.js'
import { useProject } from './useProject.js'
import { isCliModel } from '../services/claudeStream.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { runOpenRouterLoop } from './useOpenRouterChat.js'
import { runCliChat, stopCli, clearCliRequestId } from './useCliChat.js'

export function useChat() {
  const { getState, activeState, activeId } = useSessionState()

  // Reactive lenses into the active session — these follow activeId automatically
  const current = computed(() => activeState())

  const messages = computed(() => current.value.messages.value)
  const streaming = computed(() => current.value.streaming.value)
  const streamingContent = computed(() => current.value.streamingContent.value)
  const error = computed(() => current.value.error.value)
  const contextWarning = computed(() => current.value.contextWarning.value)

  // Tool execution lenses
  const toolActivity = computed(() => current.value.toolActivity.value)
  const pendingToolConfirmation = computed(() => current.value.pendingToolConfirmation.value)

  async function loadMessages(sessionId) {
    if (!sessionId) {
      const s = activeState()
      s.messages.value = []
      return
    }
    const s = getState(sessionId)
    console.time('[perf] loadMessages:db')
    const result = await db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp')
    console.timeEnd('[perf] loadMessages:db')
    s.messages.value = result
  }

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase, projectInstructions, activePlans, searchFn, mcpConfig) {
    const s = getState(sessionId)
    s.error.value = null
    const { clearActivity } = useToolExecution(s)
    clearActivity()

    // Build file contents for attached files
    const fileContents = []
    if (dirHandle && attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const text = await readFile(dirHandle, file.path)
          fileContents.push({ path: file.path, content: text })
        } catch (e) {
          fileContents.push({ path: file.path, content: `[Error reading file: ${e.message}]` })
        }
      }
    }

    let fullContent = ''
    if (fileContents.length > 0) {
      fullContent += fileContents.map(f =>
        `<file path="${f.path}">\n${f.content}\n</file>`
      ).join('\n\n')
      fullContent += '\n\n'
    }
    fullContent += content

    // Save user message
    const userMsg = {
      sessionId,
      role: 'user',
      content: fullContent,
      files: attachedFiles.map(f => ({ path: f.path, name: f.name })),
      timestamp: Date.now()
    }
    const userMsgId = await db.messages.add(userMsg)
    userMsg.id = userMsgId
    s.messages.value.push(userMsg)

    // Resolve MCP tools
    const { getEnabledTools, callMcpTool } = useMCP()
    const { isAutoApproved } = usePermissions()
    const enabledMcpTools = mcpConfig ? getEnabledTools(mcpConfig) : []

    // Build messages array for API
    const apiMessages = []
    apiMessages.push({
      role: 'system',
      content: buildSystemPrompt(phase, projectInstructions, activePlans, enabledMcpTools)
    })
    for (const msg of s.messages.value) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const apiMsg = { role: msg.role, content: msg.content }
        if (msg.toolCalls) {
          apiMsg.tool_calls = msg.toolCalls
          if (!apiMsg.content) apiMsg.content = null
        }
        apiMessages.push(apiMsg)
      } else if (msg.role === 'tool') {
        apiMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content
        })
      }
    }

    s.streaming.value = true
    s.streamingContent.value = ''
    s.abortController = new AbortController()

    try {
      if (isCliModel(model)) {
        // === CLI path ===
        const { content: cliContent, usage } = await runCliChat({
          sessionId, model, fullContent,
          phase, projectInstructions, activePlans,
          onContent(text) { s.streamingContent.value = text },
          sessionState: s
        })

        await saveAssistantMessage(sessionId, s, cliContent, null, usage, model)
        checkContextUsage(s, usage, model)

        if (s.messages.value.filter(m => m.role === 'user').length === 1) {
          return generateTitle(content)
        }
      } else {
        // === OpenRouter path ===
        if (!apiKey) {
          throw new Error('OpenRouter API key required for this model. Configure it in Settings, or switch to a CLI model.')
        }
        const tools = dirHandle ? getAllTools(enabledMcpTools) : enabledMcpTools.length ? getAllTools(enabledMcpTools) : []

        const result = await runOpenRouterLoop({
          apiKey, model, apiMessages, tools, sessionId,
          isAutoApproved, mcpConfig, callMcpTool, searchFn, dirHandle,
          onContent(text) { s.streamingContent.value = text },
          onResetStreaming() { s.streamingContent.value = '' },
          async onSaveAssistant(content, toolCalls, usage, model) {
            return saveAssistantMessage(sessionId, s, content, toolCalls, usage, model)
          },
          async onSaveTool(callId, toolName, args, content) {
            const toolMsg = {
              sessionId,
              role: 'tool',
              toolCallId: callId,
              toolName,
              toolArgs: args,
              content,
              timestamp: Date.now()
            }
            const toolMsgId = await db.messages.add(toolMsg)
            toolMsg.id = toolMsgId
            s.messages.value.push(toolMsg)
          },
          sessionState: s
        })

        if (result) {
          await saveAssistantMessage(sessionId, s, result.content, null, result.usage, result.model)
          checkContextUsage(s, result.usage, model)

          if (s.messages.value.filter(m => m.role === 'user').length === 1) {
            return generateTitle(content)
          }
        }
      }
    } catch (e) {
      console.error(`[chat] error:`, e.message)
      s.error.value = e.message
    } finally {
      s.streaming.value = false
      s.streamingContent.value = ''
      s.abortController = null
      clearCliRequestId(s)
    }

    return null
  }

  async function saveAssistantMessage(sessionId, s, content, toolCalls, usage, model) {
    const assistantMsg = {
      sessionId,
      role: 'assistant',
      content,
      usage,
      model,
      files: [],
      timestamp: Date.now()
    }
    if (toolCalls) assistantMsg.toolCalls = toolCalls
    const id = await db.messages.add(assistantMsg)
    assistantMsg.id = id
    s.messages.value.push(assistantMsg)
    return assistantMsg
  }

  function checkContextUsage(s, usage, model) {
    if (!usage) return
    const { getModelInfo } = useOpenRouter()
    const modelInfo = getModelInfo(model)
    if (modelInfo?.context_length) {
      const used = (usage.promptTokens || 0) + (usage.completionTokens || 0)
      const pct = (used / modelInfo.context_length) * 100
      if (pct >= 80) {
        s.contextWarning.value = `Context ${Math.round(pct)}% full (${used.toLocaleString()} / ${modelInfo.context_length.toLocaleString()} tokens). Consider starting a new session.`
      } else {
        s.contextWarning.value = null
      }
    }
  }

  function generateTitle(firstMessage) {
    const title = firstMessage.slice(0, 50).trim()
    return title + (firstMessage.length > 50 ? '...' : '')
  }

  function stopStreaming() {
    const s = current.value
    stopCli(s)
    if (s.abortController) {
      s.abortController.abort()
      s.abortController = null
    }
    s.streaming.value = false
  }

  function clearChat() {
    const s = current.value
    s.messages.value = []
    s.streamingContent.value = ''
    s.error.value = null
    const { clearActivity } = useToolExecution(s)
    clearActivity()
  }

  function resolveToolConfirmation(result) {
    const { resolveToolConfirmation: resolve } = useToolExecution(current.value)
    return resolve(result)
  }

  function rejectToolConfirmation(reason) {
    const { rejectToolConfirmation: reject } = useToolExecution(current.value)
    return reject(reason)
  }

  return {
    messages,
    streaming,
    streamingContent,
    toolActivity,
    error,
    pendingToolConfirmation,
    contextWarning,
    loadMessages,
    sendMessage,
    stopStreaming,
    clearChat,
    resolveToolConfirmation,
    rejectToolConfirmation
  }
}
