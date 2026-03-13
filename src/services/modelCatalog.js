import { CLI_MODELS, isCliModel, isCodexModel, isOllamaModel } from './claudeStream.js'

export const POPULAR_OPENROUTER_MODEL_IDS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
  'openai/gpt-4o',
  'openai/o1',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-pro-preview',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct'
]

function titleCaseFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getOpenRouterModelId(model) {
  return typeof model === 'string' ? model : model?.id || ''
}

export function getOpenRouterProviderSlug(modelId) {
  return modelId?.includes('/') ? modelId.split('/')[0] : ''
}

export function getModelDisplayName(modelId, models = []) {
  if (!modelId) return 'Select model'

  if (isCliModel(modelId)) {
    const cli = CLI_MODELS.find(m => m.id === modelId)
    if (cli) return cli.name
    if (isOllamaModel(modelId)) return `${modelId.replace('ollama:', '')} (Ollama)`
    if (isCodexModel(modelId)) return `${modelId.split(':').pop()} (Codex)`
    return `${modelId.split(':').pop()} (CLI)`
  }

  const model = models.find(entry => getOpenRouterModelId(entry) === modelId)
  return model?.name || modelId.split('/').pop()
}

export function getOpenRouterProviderOptions(models = [], providers = []) {
  const providerNameBySlug = new Map(
    providers
      .filter(provider => provider?.slug)
      .map(provider => [provider.slug, provider.name || titleCaseFromSlug(provider.slug)])
  )

  const counts = new Map()
  for (const model of models) {
    const slug = getOpenRouterProviderSlug(getOpenRouterModelId(model))
    if (!slug) continue
    counts.set(slug, (counts.get(slug) || 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([slug, modelCount]) => ({
      slug,
      name: providerNameBySlug.get(slug) || titleCaseFromSlug(slug),
      modelCount
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getOpenRouterModelsForProvider(models = [], providerSlug = '') {
  if (!providerSlug) return []
  return models
    .filter(model => getOpenRouterProviderSlug(getOpenRouterModelId(model)) === providerSlug)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
}