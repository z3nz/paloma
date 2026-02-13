import { ref, watch } from 'vue'

const _saved = import.meta.hot ? window.__PALOMA_SETTINGS__ : undefined

const apiKey = ref(_saved?.apiKey ?? (localStorage.getItem('paloma:apiKey') || ''))
const defaultModel = ref(_saved?.defaultModel ?? (localStorage.getItem('paloma:defaultModel') || 'claude-cli:sonnet'))

const preferences = ref(_saved?.preferences ?? JSON.parse(localStorage.getItem('paloma:preferences') || '{}'))

watch(apiKey, (val) => {
  if (val) localStorage.setItem('paloma:apiKey', val)
  else localStorage.removeItem('paloma:apiKey')
})

watch(defaultModel, (val) => {
  localStorage.setItem('paloma:defaultModel', val)
})

watch(preferences, (val) => {
  localStorage.setItem('paloma:preferences', JSON.stringify(val))
}, { deep: true })

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_SETTINGS__ = {
      apiKey: apiKey.value,
      defaultModel: defaultModel.value,
      preferences: preferences.value
    }
  }
  save()
  watch([apiKey, defaultModel, preferences], save, { flush: 'sync' })
}

export function useSettings() {
  return {
    apiKey,
    defaultModel,
    preferences
  }
}
