import { ref, watch } from 'vue'
import db from '../services/db.js'
import { streamChat } from '../services/openrouter.js'
import { readFile } from '../services/filesystem.js'
import { BASE_INSTRUCTIONS } from '../prompts/base.js'
import { PHASE_INSTRUCTIONS } from '../prompts/phases.js'
import { getAllTools, AUTO_EXECUTE_TOOLS, executeTool } from '../services/tools.js'
import { useOpenRouter } from './useOpenRouter.js'

const _saved = import.meta.hot ? window.__PALOMA_CHAT__ : undefined

const messages = ref(_saved?.messages ?? [])
const streaming = ref(_saved?.streaming ?? false)
const streamingContent = ref(_saved?.streamingContent ?? '')
const error = ref(_saved?.error ?? null)
const toolActivity = ref(_saved?.toolActivity ?? [])
const pendingToolConfirmation = ref(_saved?.pendingToolConfirmation ?? null)
const contextWarning = ref(_saved?.contextWarning ?? null)
let abortController = _saved?.abortController ?? null

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_CHAT__ = {
      messages: messages.value,
      streaming: streaming.value,
      streamingContent: streamingContent.value,
      error: error.value,
      toolActivity: toolActivity.value,
      pendingToolConfirmation: pendingToolConfirmation.value,
      contextWarning: contextWarning.value,
      abortController
    }
  }
  save()
  watch([messages, streaming, streamingContent, error, toolActivity, pendingToolConfirmation, contextWarning], save, { flush: 'sync' })
}

const MAX_TOOL_ROUNDS = 25

export function useChat() {
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

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase, projectInstructions, activePlans, searchFn) {
    error.value = null
    toolActivity.value = []

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

    // Build user message content with file contents
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

    // Build messages array for API
    const apiMessages = []

    // Layered system prompt: base + project + phase
    apiMessages.push({
      role: 'system',
      content: buildSystemPrompt(phase, projectInstructions, activePlans)
    })

    // Add conversation history (including tool messages)
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

    // Stream response with tool loop
    streaming.value = true
    streamingContent.value = ''
    abortController = new AbortController()

    const tools = dirHandle ? getAllTools() : []
    let continueLoop = true
    let round = 0

    try {
      while (continueLoop) {
        if (round++ >= MAX_TOOL_ROUNDS) {
          error.value = 'Tool call limit reached'
          break
        }
        continueLoop = false
        let accumulatedContent = ''
        let toolCalls = null
        let usage = null

        for await (const chunk of streamChat(apiKey, model, apiMessages,
          { tools: tools.length ? tools : undefined })) {
          if (chunk.type === 'content') {
            accumulatedContent += chunk.text
            streamingContent.value = accumulatedContent
          } else if (chunk.type === 'tool_calls') {
            toolCalls = chunk.calls
          } else if (chunk.type === 'usage') {
            usage = chunk.usage
          }
        }

        if (toolCalls?.length) {
          // Save assistant message with tool calls
          const assistantMsg = {
            sessionId,
            role: 'assistant',
            content: accumulatedContent || null,
            toolCalls,
            usage,
            model,
            files: [],
            timestamp: Date.now()
          }
          const assistantMsgId = await db.messages.add(assistantMsg)
          assistantMsg.id = assistantMsgId
          messages.value.push(assistantMsg)
          apiMessages.push({
            role: 'assistant',
            content: accumulatedContent || null,
            tool_calls: toolCalls
          })

          // Execute each tool call
          for (const call of toolCalls) {
            let args
            try {
              args = JSON.parse(call.function.arguments)
            } catch {
              args = {}
            }

            const toolName = call.function.name
            let result

            const activityEntry = { name: toolName, args, status: 'running' }
            toolActivity.value = [...toolActivity.value, activityEntry]

            if (AUTO_EXECUTE_TOOLS.has(toolName)) {
              try {
                result = await executeTool(toolName, args, dirHandle, searchFn)
              } catch (e) {
                result = JSON.stringify({ error: e.message })
              }
            } else {
              // Write tool — needs confirmation
              result = await requestToolConfirmation(toolName, args, dirHandle)
            }

            activityEntry.status = 'done'
            toolActivity.value = [...toolActivity.value]

            // Save tool result message
            const toolMsg = {
              sessionId,
              role: 'tool',
              toolCallId: call.id,
              toolName,
              toolArgs: args,
              content: typeof result === 'string' ? result : JSON.stringify(result),
              timestamp: Date.now()
            }
            const toolMsgId = await db.messages.add(toolMsg)
            toolMsg.id = toolMsgId
            messages.value.push(toolMsg)
            apiMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: toolMsg.content
            })
          }

          // Reset for next round
          streamingContent.value = ''
          continueLoop = true
        } else {
          // Final assistant message (no tool calls)
          const assistantMsg = {
            sessionId,
            role: 'assistant',
            content: accumulatedContent,
            usage,
            model,
            files: [],
            timestamp: Date.now()
          }
          const assistantMsgId = await db.messages.add(assistantMsg)
          assistantMsg.id = assistantMsgId
          messages.value.push(assistantMsg)

          // Check context usage and set warning
          if (usage) {
            const { getModelInfo } = useOpenRouter()
            const modelInfo = getModelInfo(model)
            if (modelInfo?.context_length) {
              const pct = (usage.totalTokens / modelInfo.context_length) * 100
              if (pct >= 80) {
                contextWarning.value = `Context ${Math.round(pct)}% full (${usage.totalTokens.toLocaleString()} / ${modelInfo.context_length.toLocaleString()} tokens). Consider starting a new session.`
              } else {
                contextWarning.value = null
              }
            }
          }

          // Auto-generate title from first exchange
          if (messages.value.filter(m => m.role === 'user').length === 1) {
            return generateTitle(content)
          }
        }
      }
    } catch (e) {
      error.value = e.message
    } finally {
      streaming.value = false
      streamingContent.value = ''
      toolActivity.value = []
      abortController = null
    }

    return null
  }

  function requestToolConfirmation(toolName, args, dirHandle) {
    return new Promise(resolve => {
      pendingToolConfirmation.value = { toolName, args, dirHandle, resolve }
    })
  }

  function resolveToolConfirmation(result) {
    if (pendingToolConfirmation.value) {
      pendingToolConfirmation.value.resolve(result)
      pendingToolConfirmation.value = null
    }
  }

  function rejectToolConfirmation(reason) {
    if (pendingToolConfirmation.value) {
      pendingToolConfirmation.value.resolve(JSON.stringify({ error: `Denied: ${reason}` }))
      pendingToolConfirmation.value = null
    }
  }

  function generateTitle(firstMessage) {
    const title = firstMessage.slice(0, 50).trim()
    return title + (firstMessage.length > 50 ? '...' : '')
  }

  function stopStreaming() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    streaming.value = false
  }

  function buildSystemPrompt(phase, projectInstructions, activePlans) {
    let prompt = BASE_INSTRUCTIONS

    if (projectInstructions) {
      prompt += '\n\n## Project Instructions\n\n' + projectInstructions
    }

    if (activePlans?.length > 0) {
      prompt += '\n\n## Active Plans\n\n'
      prompt += activePlans.map(p =>
        `<plan name="${p.name}">\n${p.content}\n</plan>`
      ).join('\n\n')
    }

    const activePhase = phase || 'research'
    prompt += '\n\n## Current Phase: ' + activePhase.charAt(0).toUpperCase() + activePhase.slice(1) + '\n\n'
    prompt += PHASE_INSTRUCTIONS[activePhase] || PHASE_INSTRUCTIONS.research

    return prompt
  }

  function clearChat() {
    messages.value = []
    streamingContent.value = ''
    error.value = null
    toolActivity.value = []
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
