import { ref, watch } from 'vue'
import { fetchModels as fetchModelsApi, validateApiKey as validateApi } from '../services/openrouter.js'
import { CLI_MODELS, isCliModel } from '../services/claudeStream.js'

const _saved = import.meta.hot ? window.__PALOMA_OPENROUTER__ : undefined

const models = ref(_saved?.models ?? [])
const loadingModels = ref(_saved?.loadingModels ?? false)
const modelsError = ref(_saved?.modelsError ?? null)

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_OPENROUTER__ = {
      models: models.value,
      loadingModels: loadingModels.value,
      modelsError: modelsError.value
    }
  }
  save()
  watch([models, loadingModels, modelsError], save, { flush: 'sync' })
  import.meta.hot.accept()
}

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
      console.time('[perf] loadModels:fetch')
      const all = await fetchModelsApi(apiKey)
      console.timeEnd('[perf] loadModels:fetch')
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
