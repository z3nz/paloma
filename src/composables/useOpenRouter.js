import { ref } from 'vue'
import { fetchModels as fetchModelsApi, validateApiKey as validateApi } from '../services/openrouter.js'
import { CLI_MODELS, isCliModel } from '../services/claudeStream.js'

const models = ref([])
const loadingModels = ref(false)
const modelsError = ref(null)

// Curated popular models shown at top
const POPULAR_MODEL_IDS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
  'openai/gpt-4o',
  'openai/o1',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-pro-preview',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct'
]

export function useOpenRouter() {
  async function loadModels(apiKey) {
    if (!apiKey) return
    loadingModels.value = true
    modelsError.value = null

    try {
      if (import.meta.env.DEV) console.time('[perf] loadModels:fetch')
      const all = await fetchModelsApi(apiKey)
      if (import.meta.env.DEV) console.timeEnd('[perf] loadModels:fetch')
      models.value = all
      // Cache for fallback on future failures
      try {
        localStorage.setItem('paloma:modelCache', JSON.stringify(all.map(m => ({ id: m.id, name: m.name }))))
      } catch { /* quota exceeded — ignore */ }
    } catch (e) {
      modelsError.value = e.message
      // Try localStorage cache before giving up
      if (models.value.length === 0) {
        try {
          const cached = JSON.parse(localStorage.getItem('paloma:modelCache'))
          if (cached?.length) {
            models.value = cached
            console.log('[OpenRouter] Using cached model list (%d models)', cached.length)
          }
        } catch { /* corrupt cache — ignore */ }
      }
    } finally {
      loadingModels.value = false
    }
  }

  async function validateApiKey(apiKey) {
    return await validateApi(apiKey)
  }

  function getPopularModels() {
    return POPULAR_MODEL_IDS
      .map(id => models.value.find(m => m.id === id))
      .filter(Boolean)
  }

  function getModelName(id) {
    if (isCliModel(id)) {
      const cli = CLI_MODELS.find(m => m.id === id)
      return cli?.name || id.split(':').pop() + ' (CLI)'
    }
    const model = models.value.find(m => m.id === id)
    return model?.name || id.split('/').pop()
  }

  function getModelInfo(id) {
    if (isCliModel(id)) {
      return CLI_MODELS.find(m => m.id === id) || null
    }
    return models.value.find(m => m.id === id) || null
  }

  return {
    models,
    loadingModels,
    modelsError,
    loadModels,
    validateApiKey,
    getPopularModels,
    getModelName,
    getModelInfo
  }
}
