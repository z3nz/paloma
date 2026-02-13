import { ref, watch } from 'vue'
import db from '../services/db.js'
import { readFile } from '../services/filesystem.js'
import { getAllTools } from '../services/tools.js'
import { useOpenRouter } from './useOpenRouter.js'
import { useMCP } from './useMCP.js'
import { useProject } from './useProject.js'
import { isCliModel } from '../services/claudeStream.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import { useToolExecution } from './useToolExecution.js'
import { runOpenRouterLoop } from './useOpenRouterChat.js'
import { runCliChat, stopCli, clearCliRequestId } from './useCliChat.js'

const _saved = import.meta.hot ? window.__PALOMA_CHAT__ : undefined

const messages = ref(_saved?.messages ?? [])
const streaming = ref(_saved?.streaming ?? false)
const streamingContent = ref(_saved?.streamingContent ?? '')
const error = ref(_saved?.error ?? null)
const contextWarning = ref(_saved?.contextWarning ?? null)
let abortController = _saved?.abortController ?? null

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_CHAT__ = {
      messages: messages.value,
      streaming: streaming.value,
      streamingContent: streamingContent.value,
      error: error.value,
      contextWarning: contextWarning.value,
      abortController
    }
  }
  save()
  watch([messages, streaming, streamingContent, error, contextWarning], save, { flush: 'sync' })
  import.meta.hot.accept()
}

export function useChat() {
  const { toolActivity, pendingToolConfirmation, clearActivity, resolveToolConfirmation, rejectToolConfirmation } = useToolExecution()

  async function loadMessages(sessionId) {
    if (!sessionId) {
      messages.value = []
      return
    }
    console.time('[perf] loadMessages:db')
    const result = await db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp')
    console.timeEnd('[perf] loadMessages:db')
    messages.value = result
  }

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase, projectInstructions, activePlans, searchFn, mcpConfig) {
    error.value = null
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
    messages.value.push(userMsg)

    // Resolve MCP tools
    const { getEnabledTools, getAutoExecuteServers, callMcpTool } = useMCP()
    const enabledMcpTools = mcpConfig ? getEnabledTools(mcpConfig) : []
    const mcpAutoExec = mcpConfig ? getAutoExecuteServers(mcpConfig) : new Set()

    // Build messages array for API
    const apiMessages = []
    apiMessages.push({
      role: 'system',
      content: buildSystemPrompt(phase, projectInstructions, activePlans, enabledMcpTools)
    })
    for (const msg of messages.value) {
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

    streaming.value = true
    streamingContent.value = ''
    abortController = new AbortController()

    try {
      if (isCliModel(model)) {
        // === CLI path ===
        const { content: cliContent, usage } = await runCliChat({
          sessionId, model, fullContent,
          phase, projectInstructions, activePlans,
          onContent(text) { streamingContent.value = text }
        })

        await saveAssistantMessage(sessionId, cliContent, null, usage, model)
        checkContextUsage(usage, model)

        if (messages.value.filter(m => m.role === 'user').length === 1) {
          return generateTitle(content)
        }
      } else {
        // === OpenRouter path ===
        const tools = dirHandle ? getAllTools(enabledMcpTools) : enabledMcpTools.length ? getAllTools(enabledMcpTools) : []

        const result = await runOpenRouterLoop({
          apiKey, model, apiMessages, tools, sessionId,
          mcpAutoExec, callMcpTool, searchFn, dirHandle,
          onContent(text) { streamingContent.value = text },
          onResetStreaming() { streamingContent.value = '' },
          async onSaveAssistant(content, toolCalls, usage, model) {
            return saveAssistantMessage(sessionId, content, toolCalls, usage, model)
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
            messages.value.push(toolMsg)
          }
        })

        if (result) {
          await saveAssistantMessage(sessionId, result.content, null, result.usage, result.model)
          checkContextUsage(result.usage, model)

          if (messages.value.filter(m => m.role === 'user').length === 1) {
            return generateTitle(content)
          }
        }
      }
    } catch (e) {
      console.error(`[chat] error:`, e.message)
      error.value = e.message
    } finally {
      streaming.value = false
      streamingContent.value = ''
      // Don't clear tool activity here — let it persist so users can see what happened.
      // It gets cleared at the start of the next sendMessage() call.
      abortController = null
      clearCliRequestId()
    }

    return null
  }

  async function saveAssistantMessage(sessionId, content, toolCalls, usage, model) {
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
    messages.value.push(assistantMsg)
    return assistantMsg
  }

  function checkContextUsage(usage, model) {
    if (!usage) return
    const { getModelInfo } = useOpenRouter()
    const modelInfo = getModelInfo(model)
    if (modelInfo?.context_length) {
      // promptTokens = entire conversation sent to model, completionTokens = response generated
      // Together they represent the total context consumed after this response
      const used = (usage.promptTokens || 0) + (usage.completionTokens || 0)
      const pct = (used / modelInfo.context_length) * 100
      if (pct >= 80) {
        contextWarning.value = `Context ${Math.round(pct)}% full (${used.toLocaleString()} / ${modelInfo.context_length.toLocaleString()} tokens). Consider starting a new session.`
      } else {
        contextWarning.value = null
      }
    }
  }

  function generateTitle(firstMessage) {
    const title = firstMessage.slice(0, 50).trim()
    return title + (firstMessage.length > 50 ? '...' : '')
  }

  function stopStreaming() {
    stopCli()
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    streaming.value = false
  }

  function clearChat() {
    messages.value = []
    streamingContent.value = ''
    error.value = null
    clearActivity()
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
