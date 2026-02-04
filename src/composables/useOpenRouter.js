import { ref } from 'vue'
import { fetchModels as fetchModelsApi, validateApiKey as validateApi } from '../services/openrouter.js'

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
      const all = await fetchModelsApi(apiKey)
      models.value = all
    } catch (e) {
      modelsError.value = e.message
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
    const model = models.value.find(m => m.id === id)
    return model?.name || id.split('/').pop()
  }

  return {
    models,
    loadingModels,
    modelsError,
    loadModels,
    validateApiKey,
    getPopularModels,
    getModelName
  }
}
