import { ref, watch } from 'vue'
import { fetchModels as fetchModelsApi, fetchProviders as fetchProvidersApi, validateApiKey as validateApi } from '../services/openrouter.js'
import { CLI_MODELS, isCliModel } from '../services/claudeStream.js'
import { POPULAR_OPENROUTER_MODEL_IDS, getModelDisplayName } from '../services/modelCatalog.js'

const _saved = import.meta.hot ? window.__PALOMA_OPENROUTER__ : undefined

const models = ref(_saved?.models ?? [])
const providers = ref(_saved?.providers ?? [])
const loadingModels = ref(_saved?.loadingModels ?? false)
const loadingProviders = ref(_saved?.loadingProviders ?? false)
const modelsError = ref(_saved?.modelsError ?? null)
const providersError = ref(_saved?.providersError ?? null)

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_OPENROUTER__ = {
      models: models.value,
        providers: providers.value,
      loadingModels: loadingModels.value,
        loadingProviders: loadingProviders.value,
        modelsError: modelsError.value,
        providersError: providersError.value
    }
  }
  save()
  watch([models, providers, loadingModels, loadingProviders, modelsError, providersError], save, { flush: 'sync' })
  import.meta.hot.accept()
}

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

  async function loadProviders(apiKey) {
    if (!apiKey) return
    loadingProviders.value = true
    providersError.value = null

    try {
      const all = await fetchProvidersApi(apiKey)
      providers.value = all
      try {
        localStorage.setItem('paloma:providerCache', JSON.stringify(all))
      } catch { /* quota exceeded — ignore */ }
    } catch (e) {
      providersError.value = e.message
      if (providers.value.length === 0) {
        try {
          const cached = JSON.parse(localStorage.getItem('paloma:providerCache'))
          if (cached?.length) {
            providers.value = cached
            console.log('[OpenRouter] Using cached provider list (%d providers)', cached.length)
          }
        } catch { /* corrupt cache — ignore */ }
      }
    } finally {
      loadingProviders.value = false
    }
  }

  async function loadCatalog(apiKey) {
    if (!apiKey) return
    await Promise.all([loadModels(apiKey), loadProviders(apiKey)])
  }

  async function validateApiKey(apiKey) {
    return await validateApi(apiKey)
  }

  function getPopularModels() {
    return POPULAR_OPENROUTER_MODEL_IDS
      .map(id => models.value.find(m => m.id === id))
      .filter(Boolean)
  }

  function getModelName(id) {
    if (isCliModel(id)) {
      const cli = CLI_MODELS.find(m => m.id === id)
      return cli?.name || id.split(':').pop() + ' (CLI)'
    }
    return getModelDisplayName(id, models.value)
  }

  function getModelInfo(id) {
    if (isCliModel(id)) {
      return CLI_MODELS.find(m => m.id === id) || null
    }
    return models.value.find(m => m.id === id) || null
  }

  return {
    models,
    providers,
    loadingModels,
    loadingProviders,
    modelsError,
    providersError,
    loadModels,
    loadProviders,
    loadCatalog,
    validateApiKey,
    getPopularModels,
    getModelName,
    getModelInfo
  }
}
