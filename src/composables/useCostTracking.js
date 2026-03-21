import { computed } from 'vue'
import { useChat } from './useChat.js'
import { useOpenRouter } from './useOpenRouter.js'
import db from '../services/db.js'

// Singleton state — computed once, shared across all callers
const { messages } = useChat()
const { getModelInfo } = useOpenRouter()

function calculateMessageCost(msg) {
  if (!msg.usage || !msg.model) return 0
  const model = getModelInfo(msg.model)
  if (!model?.pricing) return 0
  const promptPrice = parseFloat(model.pricing.prompt) || 0
  const completionPrice = parseFloat(model.pricing.completion) || 0
  return (msg.usage.promptTokens * promptPrice) + (msg.usage.completionTokens * completionPrice)
}

const sessionCost = computed(() =>
  messages.value
    .filter(m => m.role === 'assistant' && m.usage)
    .reduce((sum, m) => sum + calculateMessageCost(m), 0)
)

const sessionTokens = computed(() => {
  const msgs = messages.value.filter(m => m.role === 'assistant' && m.usage)
  return {
    prompt: msgs.reduce((s, m) => s + (m.usage.promptTokens || 0), 0),
    completion: msgs.reduce((s, m) => s + (m.usage.completionTokens || 0), 0),
    total: msgs.reduce((s, m) => s + (m.usage.totalTokens || 0), 0)
  }
})

export function useCostTracking() {

  function getContextUsage(modelId) {
    const model = getModelInfo(modelId)
    if (!model?.context_length) return null
    const lastAssistant = [...messages.value].reverse().find(m => m.role === 'assistant' && m.usage)
    if (!lastAssistant) return null
    // promptTokens on the last response = entire conversation history sent to the model,
    // plus completionTokens = total context consumed after that response.
    // This is the best approximation of current context window usage.
    const used = (lastAssistant.usage.promptTokens || 0) + (lastAssistant.usage.completionTokens || 0)
    return {
      used,
      limit: model.context_length,
      percentage: (used / model.context_length) * 100
    }
  }

  async function getProjectCost(projectPath) {
    const sessions = await db.sessions.where('projectPath').equals(projectPath).toArray()
    let total = 0
    for (const s of sessions) {
      const msgs = await db.messages.where('sessionId').equals(s.id).toArray()
      total += msgs
        .filter(m => m.role === 'assistant' && m.usage)
        .reduce((sum, m) => sum + calculateMessageCost(m), 0)
    }
    return total
  }

  function formatCost(cost) {
    if (cost == null || cost === 0) return '$0.00'
    if (cost < 0.01) return '<$0.01'
    return '$' + cost.toFixed(2)
  }

  function formatTokens(count) {
    if (count == null) return '0'
    if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
    return count.toString()
  }

  function formatTokenBreakdown(usage) {
    if (!usage) return ''
    const parts = []
    if (usage.promptTokens) parts.push(`Prompt: ${formatTokens(usage.promptTokens)}`)
    if (usage.completionTokens) parts.push(`Completion: ${formatTokens(usage.completionTokens)}`)
    if (usage.totalTokens) parts.push(`Total: ${formatTokens(usage.totalTokens)}`)
    return parts.join(' | ')
  }

  return { sessionCost, sessionTokens, getContextUsage, getProjectCost, calculateMessageCost, formatCost, formatTokens, formatTokenBreakdown }
}
