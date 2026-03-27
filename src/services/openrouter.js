const BASE_URL = 'https://openrouter.ai/api/v1'

function parseStreamEvent(rawLine, toolCallAccumulator) {
  const trimmed = rawLine.trim()
  if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') {
    return []
  }

  try {
    const data = JSON.parse(trimmed.replace(/^data:\s*/, ''))
    const events = []

    if (data.usage) {
      events.push({
        type: 'usage',
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        }
      })
    }

    const choice = data.choices?.[0]
    if (!choice) return events

    const content = choice.delta?.content
    if (content) {
      events.push({ type: 'content', text: content })
    }

    const deltaToolCalls = choice.delta?.tool_calls
    if (deltaToolCalls) {
      for (const tc of deltaToolCalls) {
        const idx = tc.index
        if (!toolCallAccumulator[idx]) {
          toolCallAccumulator[idx] = {
            id: tc.id,
            type: 'function',
            function: { name: tc.function?.name || '', arguments: '' }
          }
        } else {
          if (tc.id) toolCallAccumulator[idx].id = tc.id
          if (tc.function?.name) toolCallAccumulator[idx].function.name = tc.function.name
        }
        if (tc.function?.arguments) {
          toolCallAccumulator[idx].function.arguments += tc.function.arguments
        }
      }
    }

    if (choice.finish_reason === 'tool_calls') {
      events.push({ type: 'tool_calls', calls: Object.values(toolCallAccumulator) })
    }

    return events
  } catch {
    return []
  }
}

export async function validateApiKey(apiKey) {
  try {
    const response = await fetch(`${BASE_URL}/auth/key`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    if (!response.ok) return false
    const data = await response.json()
    return data?.data?.label !== undefined
  } catch {
    return false
  }
}

export async function fetchModels(apiKey) {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  if (!response.ok) throw new Error('Failed to fetch models')
  const data = await response.json()
  return data.data
    .filter(m => m.id && m.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function* streamChat(apiKey, model, messages, options = {}) {
  const body = {
    model,
    messages,
    stream: true
  }

  if (options.tools?.length) {
    body.tools = options.tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Paloma'
    },
    body: JSON.stringify(body),
    signal: options.signal
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCallAccumulator = {}

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      for (const event of parseStreamEvent(line, toolCallAccumulator)) {
        yield event
      }
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    for (const event of parseStreamEvent(buffer, toolCallAccumulator)) {
      yield event
    }
  }
}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
