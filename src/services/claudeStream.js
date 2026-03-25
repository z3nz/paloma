// Pricing: per-token rates matching OpenRouter format (string).
// Claude models use Anthropic's published API rates for reference cost tracking.
// Ollama is free (local). Codex/Copilot are subscription — shown as $0.
const ANTHROPIC_PRICING = {
  opus:   { prompt: '0.000015',  completion: '0.000075' },   // $15/$75 per M tokens
  sonnet: { prompt: '0.000003',  completion: '0.000015' },   // $3/$15 per M tokens
  haiku:  { prompt: '0.0000008', completion: '0.000004' },   // $0.80/$4 per M tokens
}
const FREE_PRICING = { prompt: '0', completion: '0' }

export const CLI_MODELS = [
  { id: 'claude-cli:opus', name: 'Claude Opus (CLI)', context_length: 200000, direct: false, pricing: ANTHROPIC_PRICING.opus },
  { id: 'claude-cli:sonnet', name: 'Claude Sonnet (CLI)', context_length: 200000, direct: false, pricing: ANTHROPIC_PRICING.sonnet },
  { id: 'claude-cli:haiku', name: 'Claude Haiku (CLI)', context_length: 200000, direct: false, pricing: ANTHROPIC_PRICING.haiku },
  { id: 'claude-cli-direct:opus', name: 'Claude Opus (CLI Direct)', context_length: 200000, direct: true, pricing: ANTHROPIC_PRICING.opus },
  { id: 'claude-cli-direct:sonnet', name: 'Claude Sonnet (CLI Direct)', context_length: 200000, direct: true, pricing: ANTHROPIC_PRICING.sonnet },
  { id: 'claude-cli-direct:haiku', name: 'Claude Haiku (CLI Direct)', context_length: 200000, direct: true, pricing: ANTHROPIC_PRICING.haiku },
  { id: 'codex-cli:codex-max', name: 'GPT-5.1 Codex Max', context_length: 1000000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:codex', name: 'GPT-5.1 Codex', context_length: 200000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:o3', name: 'o3', context_length: 200000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:o4-mini', name: 'o4-mini', context_length: 200000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:gpt-4.1', name: 'GPT-4.1', context_length: 1000000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:gpt-4.1-mini', name: 'GPT-4.1 Mini', context_length: 1000000, codex: true, pricing: FREE_PRICING },
  { id: 'codex-cli:gpt-4.1-nano', name: 'GPT-4.1 Nano', context_length: 1000000, codex: true, pricing: FREE_PRICING },
  { id: 'copilot-cli:claude-sonnet-4.6', name: 'Claude Sonnet 4.6 (Copilot)', context_length: 200000, copilot: true, pricing: ANTHROPIC_PRICING.sonnet },
  { id: 'copilot-cli:claude-opus-4.6', name: 'Claude Opus 4.6 (Copilot)', context_length: 200000, copilot: true, pricing: ANTHROPIC_PRICING.opus },
  { id: 'copilot-cli:gpt-5.4', name: 'GPT-5.4 (Copilot)', context_length: 200000, copilot: true, pricing: FREE_PRICING },
  { id: 'copilot-cli:gemini-3-pro-preview', name: 'Gemini 3 Pro (Copilot)', context_length: 200000, copilot: true, pricing: FREE_PRICING },
  { id: 'gemini-cli:gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', context_length: 2000000, gemini: true, pricing: FREE_PRICING },
  { id: 'gemini-cli:gemini-2.5-pro', name: 'Gemini 2.5 Pro', context_length: 1000000, gemini: true, pricing: FREE_PRICING },
  { id: 'gemini-cli:gemini-2.5-flash', name: 'Gemini 2.5 Flash', context_length: 1000000, gemini: true, pricing: FREE_PRICING },
  { id: 'gemini-cli:gemini-2.0-flash', name: 'Gemini 2.0 Flash', context_length: 1000000, gemini: true, pricing: FREE_PRICING },
  { id: 'gemini-cli:gemini-exp', name: 'Gemini Experimental', context_length: 1000000, gemini: true, pricing: FREE_PRICING },
  { id: 'ollama:qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', context_length: 32768, ollama: true, pricing: FREE_PRICING },
  { id: 'ollama:qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', context_length: 32768, ollama: true, pricing: FREE_PRICING }
]

export function isCliModel(modelId) {
  return modelId?.startsWith('claude-cli:') || modelId?.startsWith('claude-cli-direct:') || modelId?.startsWith('codex-cli:') || modelId?.startsWith('copilot-cli:') || modelId?.startsWith('gemini-cli:') || modelId?.startsWith('ollama:')
}

export function isCodexModel(modelId) {
  return modelId?.startsWith('codex-cli:')
}

export function isCopilotModel(modelId) {
  return modelId?.startsWith('copilot-cli:')
}

export function isGeminiModel(modelId) {
  return modelId?.startsWith('gemini-cli:')
}

export function getGeminiModelName(modelId) {
  return modelId?.split(':')[1] || 'gemini-2.5-flash'
}

export function isOllamaModel(modelId) {
  return modelId?.startsWith('ollama:')
}

export function getOllamaModelName(modelId) {
  // 'ollama:qwen2.5-coder:32b' → 'qwen2.5-coder:32b'
  return modelId?.replace(/^ollama:/, '') || 'qwen2.5-coder:7b'
}

export function isDirectCliModel(modelId) {
  return modelId?.startsWith('claude-cli-direct:')
}

export function getCliModelName(modelId) {
  return modelId?.split(':')[1] || 'sonnet'
}

const CODEX_MODEL_MAP = {
  'codex-max': 'gpt-5.1-codex-max',
  'codex': 'gpt-5.1-codex',
  'o3': 'o3',
  'o4-mini': 'o4-mini',
  'gpt-4.1': 'gpt-4.1',
  'gpt-4.1-mini': 'gpt-4.1-mini',
  'gpt-4.1-nano': 'gpt-4.1-nano'
}

export function getCodexModelName(modelId) {
  const shortName = modelId?.split(':')[1] || 'codex-max'
  return CODEX_MODEL_MAP[shortName] || shortName
}

export function getCopilotModelName(modelId) {
  // 'copilot-cli:claude-sonnet-4.6' → 'claude-sonnet-4.6'
  return modelId?.split(':')[1] || 'claude-sonnet-4.6'
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
      } else if (event.type === 'user' && event.message?.content) {
        // CLI emits tool results as user-type events with tool_result content blocks
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const resultContent = Array.isArray(block.content)
              ? block.content.map(c => c.text || '').join('')
              : typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            yield { type: 'tool_result', toolUseId: block.tool_use_id, content: resultContent }
          }
        }
      } else if (event.type === 'content_block_start') {
        // CLI stream-json emits content_block_start for tool_use blocks
        if (event.content_block?.type === 'tool_use') {
          yield {
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: event.content_block.input || {}
          }
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'content', text: event.delta.text }
        }
      } else if (event.type === 'result') {
        if (event.subtype === 'done') continue // handled by done flag
        // Result event may contain tool_result blocks in its content
        if (event.result?.content) {
          for (const block of (Array.isArray(event.result.content) ? event.result.content : [])) {
            if (block.type === 'tool_result') {
              yield { type: 'tool_result', toolUseId: block.tool_use_id, content: block.content }
            }
          }
        }
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

/**
 * Async generator that bridges WebSocket Codex CLI events into the same
 * chunk format that useChat.js expects from Claude's streamChat().
 *
 * Codex emits complete items (not streaming deltas like Claude).
 * Yields: { type: 'content', text } | { type: 'session_id', sessionId }
 */
export async function* streamCodexChat(sendFn, options) {
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
      console.error(`[codex] stream error:`, err)
      streamError = err
      done = true
      if (resolve) { resolve(); resolve = null }
    }
  })

  yield { type: 'session_id', sessionId, requestId }

  while (!done || queue.length > 0) {
    await waitForItem()
    if (streamError) throw new Error(streamError)

    while (queue.length > 0) {
      const event = queue.shift()

      if (event.type === 'agent_message' && event.text) {
        yield { type: 'content', text: event.text }
      } else if (event.type === 'session_id') {
        yield { type: 'session_id', sessionId: event.sessionId, requestId }
      } else if (event.type === 'tool_use') {
        const tu = event.tool_use || {}
        yield { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input || {} }
      } else if (event.type === 'tool_result') {
        yield { type: 'tool_result', toolUseId: event.toolUseId, content: event.content }
      } else if (event.type === 'command_execution') {
        // Surface command executions as content so user sees what Codex did
        let text = ''
        if (event.command) text += `\`\`\`\n$ ${event.command}\n`
        if (event.output) text += event.output
        text += '\n```\n'
        yield { type: 'content', text }
      } else if (event.type === 'result' && event.subtype === 'done') {
        continue
      }
    }
  }
}

/**
 * Async generator for Copilot CLI events. Same agent_message format as Codex.
 * Yields: { type: 'content', text } | { type: 'session_id', sessionId } | { type: 'tool_use' } | { type: 'tool_result' }
 */
export async function* streamCopilotChat(sendFn, options) {
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
      console.error(`[copilot] stream error:`, err)
      streamError = err
      done = true
      if (resolve) { resolve(); resolve = null }
    }
  })

  yield { type: 'session_id', sessionId, requestId }

  while (!done || queue.length > 0) {
    await waitForItem()
    if (streamError) throw new Error(streamError)

    while (queue.length > 0) {
      const event = queue.shift()

      if (event.type === 'agent_message' && event.text) {
        yield { type: 'content', text: event.text }
      } else if (event.type === 'session_id') {
        // Real session ID from result event — update frontend's stored ID
        yield { type: 'session_id', sessionId: event.sessionId, requestId }
      } else if (event.type === 'tool_use') {
        const tu = event.tool_use || {}
        yield { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input || {} }
      } else if (event.type === 'tool_result') {
        yield { type: 'tool_result', toolUseId: event.toolUseId, content: event.content }
      } else if (event.type === 'result' && event.subtype === 'done') {
        // Propagate final session ID so frontend updates its stored ID
        if (event.sessionId) {
          yield { type: 'session_id', sessionId: event.sessionId, requestId }
        }
        continue
      }
    }
  }
}

/**
 * Async generator that bridges WebSocket Ollama events into the same
 * chunk format that useChat.js expects. Ollama uses Claude-compatible
 * content_block_delta shape, so this is simpler than the Claude generator.
 *
 * Yields: { type: 'content', text } | { type: 'session_id', sessionId }
 */
export async function* streamOllamaChat(sendFn, options) {
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
      console.error(`[ollama] stream error:`, err)
      streamError = err
      done = true
      if (resolve) { resolve(); resolve = null }
    }
  })

  yield { type: 'session_id', sessionId, requestId }

  while (!done || queue.length > 0) {
    await waitForItem()
    if (streamError) throw new Error(streamError)

    while (queue.length > 0) {
      const event = queue.shift()

      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'content', text: event.delta.text }
        }
      } else if (event.type === 'tool_use') {
        // Bridge emits tool_use when Ollama calls a tool
        const tu = event.tool_use || {}
        yield { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input || {} }
      } else if (event.type === 'tool_result') {
        // Bridge emits tool_result after executing the tool
        yield { type: 'tool_result', toolUseId: event.toolUseId, content: event.content }
      } else if (event.type === 'result' && event.subtype === 'done') {
        continue
      }
    }
  }
}

/**
 * Async generator for Gemini CLI events. Same agent_message format as Codex/Copilot.
 * Yields: { type: 'content', text } | { type: 'session_id', sessionId }
 */
export async function* streamGeminiChat(sendFn, options) {
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
      console.error(`[gemini] stream error:`, err)
      streamError = err
      done = true
      if (resolve) { resolve(); resolve = null }
    }
  })

  yield { type: 'session_id', sessionId, requestId }

  while (!done || queue.length > 0) {
    await waitForItem()
    if (streamError) throw new Error(streamError)

    while (queue.length > 0) {
      const event = queue.shift()

      if (event.type === 'agent_message' && event.text) {
        yield { type: 'content', text: event.text }
      } else if (event.type === 'session_id') {
        yield { type: 'session_id', sessionId: event.sessionId, requestId }
      } else if (event.type === 'tool_use') {
        const tu = event.tool_use || {}
        yield { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input || {} }
      } else if (event.type === 'tool_result') {
        yield { type: 'tool_result', toolUseId: event.toolUseId, content: event.content }
      } else if (event.type === 'result' && event.subtype === 'done') {
        continue
      }
    }
  }
}

// Enable HMR boundary
if (import.meta.hot) import.meta.hot.accept()
