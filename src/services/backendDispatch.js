/**
 * Backend Dispatch Utility
 * 
 * Replaces the 8-level ternary chains in useCliChat.js for send function
 * and model name resolution with a clean lookup table.
 * 
 * Usage:
 *   const dispatch = resolveBackend(model)
 *   const sendFn = dispatch.sendFn(opts, cbs)
 *   const streamGen = dispatch.streamGenerator
 *   const modelName = dispatch.modelName
 *   const stopFn = dispatch.stopFn
 */

import { useMCP } from '../composables/useMCP.js'
import { 
  isDirectCliModel, isCodexModel, isCopilotModel, isGeminiModel, isOllamaModel, 
  getCliModelName, getCodexModelName, getCopilotModelName, getGeminiModelName, getOllamaModelName,
  streamClaudeChat, streamCodexChat, streamCopilotChat, streamGeminiChat, streamOllamaChat
} from './claudeStream.js'
import { isQuinnGen5Model, isHolyTrinityModel, isHydraModel, isAccordionModel, isPaestroModel } from './claudeStream.js'

// MCP stop functions
const { 
  stopClaudeChat, stopCodexChat, stopCopilotChat, stopGeminiChat, stopOllamaChat,
  stopQuinnGen5Chat, stopHolyTrinityChat, stopArkChat, stopHydraChat, stopAccordionChat, stopPaestroChat
} = useMCP()

// Model type detectors (inlined from useCliChat.js)
function _isDirectCliModel(model) { return model?.startsWith('claude-cli-direct:') }
function _isCodexModel(model) { return model?.startsWith('codex-cli:') }
function _isCopilotModel(model) { return model?.startsWith('copilot-cli:') }
function _isGeminiModel(model) { return model?.startsWith('gemini-cli:') }
function _isOllamaModel(model) { return model?.startsWith('ollama:') }

// Model metadata lookup table
const MODEL_INFO = {
  // Paestro models (Qwen 3.5 variants and legacy)
  'ollama:67': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:67', stop: stopPaestroChat },
  'ollama:67:8b': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:67', stop: stopPaestroChat },
  'ollama:qwen3.5:35b': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:qwen3.5:35b', stop: stopPaestroChat },
  'ollama:qwen3.5:27b': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:qwen3.5:27b', stop: stopPaestroChat },
  'ollama:qwen3.5:9b': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:qwen3.5:9b', stop: stopPaestroChat },
  // Gen5: Quinn Gen5
  'ollama:quinn-gen5': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:quinn-gen5', stop: stopQuinnGen5Chat },
  // Gen6: Holy Trinity
  'ollama:holy-trinity': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:holy-trinity', stop: stopHolyTrinityChat },
  // Gen7: Ark, Hydra, Accordion
  'ollama:ark': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:ark', stop: stopArkChat },
  'ollama:hydra': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:hydra', stop: stopHydraChat },
  'ollama:accordion': { backend: 'ollama', send: streamOllamaChat, name: 'ollama:accordion', stop: stopAccordionChat },
  // Default Ollama
  'ollama:qwen2.5-coder:32b': { backend: 'ollama', send: streamOllamaChat, name: getOllamaModelName, stop: stopOllamaChat },
  'ollama:qwen2.5-coder:7b': { backend: 'ollama', send: streamOllamaChat, name: getOllamaModelName, stop: stopOllamaChat },
  // Claude backends
  'claude-cli:opus': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  'claude-cli:sonnet': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  'claude-cli:haiku': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  'claude-cli-direct:opus': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  'claude-cli-direct:sonnet': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  'claude-cli-direct:haiku': { backend: 'claude', send: streamClaudeChat, name: getCliModelName, stop: stopClaudeChat },
  // Codex backends
  'codex-cli:codex-max': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:codex': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:o3': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:o4-mini': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:gpt-4.1': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:gpt-4.1-mini': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  'codex-cli:gpt-4.1-nano': { backend: 'codex', send: streamCodexChat, name: getCodexModelName, stop: stopCodexChat },
  // Copilot backends
  'copilot-cli:claude-sonnet-4.6': { backend: 'copilot', send: streamCopilotChat, name: getCopilotModelName, stop: stopCopilotChat },
  'copilot-cli:claude-opus-4.6': { backend: 'copilot', send: streamCopilotChat, name: getCopilotModelName, stop: stopCopilotChat },
  'copilot-cli:gpt-5.4': { backend: 'copilot', send: streamCopilotChat, name: getCopilotModelName, stop: stopCopilotChat },
  'copilot-cli:gemini-3-pro-preview': { backend: 'copilot', send: streamCopilotChat, name: getCopilotModelName, stop: stopCopilotChat },
  // Gemini backends
  'gemini-cli:gemini-3.1-pro-preview': { backend: 'gemini', send: streamGeminiChat, name: getGeminiModelName, stop: stopGeminiChat },
  'gemini-cli:gemini-2.5-pro': { backend: 'gemini', send: streamGeminiChat, name: getGeminiModelName, stop: stopGeminiChat },
  'gemini-cli:gemini-2.5-flash': { backend: 'gemini', send: streamGeminiChat, name: getGeminiModelName, stop: stopGeminiChat },
  'gemini-cli:gemini-2.0-flash': { backend: 'gemini', send: streamGeminiChat, name: getGeminiModelName, stop: stopGeminiChat },
  'gemini-cli:gemini-exp': { backend: 'gemini', send: streamGeminiChat, name: getGeminiModelName, stop: stopGeminiChat },
}

/**
 * Resolve backend dispatch configuration for a given model.
 * @param {string} model - The model identifier
 * @returns {Object} dispatch config with sendFn, streamGenerator, modelName, backendKey, stopFn
 */
export function resolveBackend(model) {
  // Check if model is in our lookup table first
  const modelInfo = MODEL_INFO[model]
  
  if (modelInfo) {
    const resolvedModelName = typeof modelInfo.name === 'function'
      ? modelInfo.name(model)
      : modelInfo.name

    // Model found in lookup table - return directly
    return {
      sendFn: (opts, cbs) => modelInfo.send(opts, cbs),
      stopFn: modelInfo.stop,
      streamGenerator: modelInfo.send,
      modelName: resolvedModelName,
      backendKey: modelInfo.backend
    }
  }

  // Fallback: model not in lookup table - use dynamic detection
  // This handles models added after the lookup table was built
  const isPaestro = isPaestroModel(model)
  const isAccordion = isAccordionModel(model)
  const isHydra = isHydraModel(model)
  const isGen7 = isHolyTrinityModel(model)
  const isGen6 = isHolyTrinityModel(model)
  const isGen5 = isQuinnGen5Model(model)

  // Default Ollama model name handler
  const modelNameHandler = isGen5 || isGen6 || isGen7 || isHydra || isAccordion || isPaestro
    ? model
    : isOllamaModel(model) ? getOllamaModelName : isDirectCliModel ? getCliModelName : _isCodexModel ? getCodexModelName : getCliModelName

  const stopFn = isPaestro
    ? stopPaestroChat
    : isAccordion
      ? stopAccordionChat
      : isHydra
        ? stopHydraChat
        : isGen7
          ? stopArkChat
          : isGen6
            ? stopHolyTrinityChat
            : isGen5
              ? stopQuinnGen5Chat
              : isOllamaModel(model)
                ? stopOllamaChat
                : _isGeminiModel(model)
                  ? stopGeminiChat
                  : _isCopilotModel(model)
                    ? stopCopilotChat
                    : _isCodexModel(model)
                      ? stopCodexChat
                      : stopClaudeChat

  const sendFn = isPaestro
    ? (opts, cbs) => sendPaestroChat(opts, cbs)
    : isAccordion
      ? (opts, cbs) => sendAccordionChat(opts, cbs)
      : isHydra
        ? (opts, cbs) => sendHydraChat(opts, cbs)
        : isGen7
          ? (opts, cbs) => sendArkChat(opts, cbs)
          : isGen6
            ? (opts, cbs) => sendHolyTrinityChat(opts, cbs)
            : isGen5
              ? (opts, cbs) => sendQuinnGen5Chat(opts, cbs)
              : isOllamaModel(model)
                ? (opts, cbs) => streamOllamaChat
                : _isGeminiModel(model)
                  ? (opts, cbs) => streamGeminiChat
                  : _isCopilotModel(model)
                    ? (opts, cbs) => streamCopilotChat
                    : _isCodexModel(model)
                      ? (opts, cbs) => streamCodexChat
                      : streamClaudeChat

  const streamGenerator = isPaestro || isAccordion || isHydra || isGen7 || isGen6 || isGen5
    ? sendFn // For these models, use the sendFn directly as the stream generator
    : isOllamaModel(model)
      ? streamOllamaChat
      : _isGeminiModel(model)
        ? streamGeminiChat
        : _isCopilotModel(model)
          ? streamCopilotChat
          : _isCodexModel(model)
            ? streamCodexChat
            : streamClaudeChat

  const backendKey = isPaestro
    ? 'paestro'
    : isAccordion
      ? 'accordion'
      : isHydra
        ? 'hydra'
        : isGen7
          ? 'ark'
          : isGen6
            ? 'holy-trinity'
            : isGen5
              ? 'quinn-gen5'
              : isOllamaModel(model)
                ? 'ollama'
                : _isGeminiModel(model)
                  ? 'gemini'
                  : _isCopilotModel(model)
                    ? 'copilot'
                    : _isCodexModel(model)
                      ? 'codex'
                      : 'claude'

  return {
    sendFn,
    stopFn,
    streamGenerator,
    modelName: modelNameHandler(model),
    backendKey
  }
}
