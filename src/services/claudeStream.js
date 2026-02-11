export const CLI_MODELS = [
  { id: 'claude-cli:opus', name: 'Claude Opus (CLI)', context_length: 200000, direct: false },
  { id: 'claude-cli:sonnet', name: 'Claude Sonnet (CLI)', context_length: 200000, direct: false },
  { id: 'claude-cli:haiku', name: 'Claude Haiku (CLI)', context_length: 200000, direct: false },
  { id: 'claude-cli-direct:opus', name: 'Claude Opus (CLI Direct)', context_length: 200000, direct: true },
  { id: 'claude-cli-direct:sonnet', name: 'Claude Sonnet (CLI Direct)', context_length: 200000, direct: true },
  { id: 'claude-cli-direct:haiku', name: 'Claude Haiku (CLI Direct)', context_length: 200000, direct: true }
]

export function isCliModel(modelId) {
  return modelId?.startsWith('claude-cli:') || modelId?.startsWith('claude-cli-direct:')
}

export function isDirectCliModel(modelId) {
  return modelId?.startsWith('claude-cli-direct:')
}

export function getCliModelName(modelId) {
  return modelId?.split(':')[1] || 'sonnet'
}

/**
 * Async generator that bridges WebSocket Claude CLI events into the same
 * chunk format that useChat.js expects from OpenRouter's streamChat().
 *
 * Yields: { type: 'content', text } | { type: 'usage', usage } | { type: 'session_id', sessionId }
 */
export async function* streamClaudeChat(sendFn, options) {
  // Push-pull pattern: WebSocket callbacks push into queue, generator pulls
  const queue = []
  let resolve = null
  let done = false
  let streamError = null

  function push(item) {
    queue.push(item)
    if (resolve) {
      resolve()
      resolve = null
    }
  }

  function waitForItem() {
    if (queue.length > 0 || done) return Promise.resolve()
    return new Promise(r => { resolve = r })
  }

  const { requestId, sessionId } = await sendFn(options, {
    onStream(event) {
      push(event)
    },
    onDone(sid, exitCode) {
      push({ type: 'result', subtype: 'done', sessionId: sid, exitCode })
      done = true
      if (resolve) { resolve(); resolve = null }
    },
    onError(err) {
      console.error(`[cli] stream error:`, err)
      streamError = err
      done = true
      if (resolve) { resolve(); resolve = null }
    }
  })

  // Yield the session ID immediately so caller can persist it
  yield { type: 'session_id', sessionId, requestId }

  while (!done || queue.length > 0) {
    await waitForItem()
    if (streamError) throw new Error(streamError)

    while (queue.length > 0) {
      const event = queue.shift()

      // Claude CLI stream-json events:
      // { type: "assistant", message: { content: [...] } } — partial messages with content blocks
      // { type: "result", ... } — final result with usage
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            yield { type: 'content', text: block.text }
          } else if (block.type === 'tool_use') {
            yield { type: 'tool_use', id: block.id, name: block.name, input: block.input }
          } else if (block.type === 'tool_result') {
            yield { type: 'tool_result', toolUseId: block.tool_use_id, content: block.content }
          }
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'content', text: event.delta.text }
        }
      } else if (event.type === 'result') {
        if (event.subtype === 'done') continue // handled by done flag
        // Result event with usage stats
        if (event.usage) {
          yield {
            type: 'usage',
            usage: {
              promptTokens: event.usage.input_tokens || 0,
              completionTokens: event.usage.output_tokens || 0,
              totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
            }
          }
        }
      }
    }
  }
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
