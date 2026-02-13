import { streamChat } from '../services/openrouter.js'
import { AUTO_EXECUTE_TOOLS, executeTool } from '../services/tools.js'
import { isMcpTool } from './useMCP.js'
import { useToolExecution } from './useToolExecution.js'

const MAX_TOOL_ROUNDS = 25

/**
 * Runs the OpenRouter tool loop: stream → handle tool calls → repeat.
 *
 * Returns { content, usage, toolCalls } from the final assistant turn,
 * plus appends all intermediate messages to apiMessages in-place.
 */
export async function runOpenRouterLoop({
  apiKey, model, apiMessages, tools, sessionId,
  isAutoApproved, mcpConfig, callMcpTool, searchFn, dirHandle,
  onContent, onToolCall, onSaveAssistant, onSaveTool, onResetStreaming,
  sessionState
}) {
  const { addActivity, markActivityDone, requestToolConfirmation } = useToolExecution(sessionState)

  let continueLoop = true
  let round = 0

  while (continueLoop) {
    if (round++ >= MAX_TOOL_ROUNDS) {
      throw new Error('Tool call limit reached')
    }
    continueLoop = false
    let accumulatedContent = ''
    let toolCalls = null
    let usage = null

    for await (const chunk of streamChat(apiKey, model, apiMessages,
      { tools: tools.length ? tools : undefined })) {
      if (chunk.type === 'content') {
        accumulatedContent += chunk.text
        onContent(accumulatedContent)
      } else if (chunk.type === 'tool_calls') {
        toolCalls = chunk.calls
      } else if (chunk.type === 'usage') {
        usage = chunk.usage
      }
    }

    if (toolCalls?.length) {
      // Save assistant message with tool calls
      const assistantMsg = await onSaveAssistant(accumulatedContent || null, toolCalls, usage, model)
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
        const activityId = addActivity(toolName, args)

        if (isMcpTool(toolName)) {
          if (isAutoApproved(toolName, mcpConfig)) {
            try {
              result = await callMcpTool(toolName, args)
            } catch (e) {
              result = JSON.stringify({ error: e.message })
            }
          } else {
            result = await requestToolConfirmation(toolName, args, dirHandle)
          }
        } else if (AUTO_EXECUTE_TOOLS.has(toolName)) {
          try {
            result = await executeTool(toolName, args, dirHandle, searchFn)
          } catch (e) {
            result = JSON.stringify({ error: e.message })
          }
        } else {
          // Write tool — needs confirmation
          result = await requestToolConfirmation(toolName, args, dirHandle)
        }

        markActivityDone(activityId)

        // Save tool result message
        const content = typeof result === 'string' ? result : JSON.stringify(result)
        await onSaveTool(call.id, toolName, args, content)
        apiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content
        })
      }

      // Reset for next round
      onResetStreaming()
      continueLoop = true
    } else {
      // Final assistant message (no tool calls)
      return { content: accumulatedContent, usage, model }
    }
  }
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
