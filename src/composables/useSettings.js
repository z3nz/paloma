import { ref, watch } from 'vue'

const apiKey = ref(localStorage.getItem('paloma:apiKey') || '')
const defaultModel = ref(localStorage.getItem('paloma:defaultModel') || 'claude-cli:sonnet')

const preferences = ref(JSON.parse(localStorage.getItem('paloma:preferences') || '{}'))

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

export function useSettings() {
  return {
    apiKey,
    defaultModel,
    preferences
  }
}
