const BASE_URL = 'https://openrouter.ai/api/v1'

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

export async function* streamChat(apiKey, model, messages) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Paloma'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmed.slice(6))
          const content = data.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  }
}
