import { computed } from 'vue'
import db from '../services/db.js'
import { readFile } from '../services/filesystem.js'
import { getAllTools } from '../services/tools.js'
import { useOpenRouter } from './useOpenRouter.js'
import { useMCP } from './useMCP.js'
import { usePermissions } from './usePermissions.js'
import { useProject } from './useProject.js'
import { isCliModel } from '../services/claudeStream.js'
import { buildSystemPrompt } from './useSystemPrompt.js'
import { useToolExecution } from './useToolExecution.js'
import { useSessionState } from './useSessionState.js'
import { runOpenRouterLoop } from './useOpenRouterChat.js'
import { runCliChat, stopCli, clearCliRequestId } from './useCliChat.js'
import { classifyResult } from '../utils/toolClassifier.js'

/** Strip non-cloneable values (Vue reactive proxies, functions, etc.) for IndexedDB. */
function sanitizeForDB(obj) {
  try { return JSON.parse(JSON.stringify(obj)) } catch { return obj }
}

/**
 * Starts a periodic save of streaming content to the drafts table.
 * Acts as a write-ahead log — if the page crashes mid-stream, the draft
 * survives in IndexedDB and can be recovered on reload.
 */
function startStreamingDraftSave(sessionId, s, model) {
  let lastSaved = ''

  async function save() {
    const content = s.streamingContent.value
    if (!content || content === lastSaved) return
    lastSaved = content
    try {
      const existing = await db.drafts.get(sessionId) || {}
      await db.drafts.put({
        sessionId,
        ...existing,
        streamingDraft: {
          content,
          toolActivity: sanitizeForDB(s.toolActivity.value),
          model,
          timestamp: Date.now()
        }
      })
    } catch (e) {
      console.warn('[draft] save failed:', e.message)
    }
  }

  const timer = setInterval(save, 2000)

  return {
    /** Immediate flush — call from beforeunload or before clearing state. */
    flush: save,
    /** Stop the timer. If completed=true, removes the draft. */
    async cleanup(completed) {
      clearInterval(timer)
      if (completed) {
        try {
          const existing = await db.drafts.get(sessionId)
          if (existing?.streamingDraft) {
            delete existing.streamingDraft
            await db.drafts.put(existing)
          }
        } catch { /* best-effort */ }
      }
    }
  }
}

/**
 * Recovers any streaming drafts left behind by a crash/refresh.
 * Promotes them to interrupted assistant messages in the messages table.
 */
async function recoverStreamingDrafts(sessionId) {
  if (!sessionId) return
  try {
    const draft = await db.drafts.get(sessionId)
    if (!draft?.streamingDraft) return

    const { content, toolActivity, model, timestamp } = draft.streamingDraft
    if (content) {
      const assistantMsg = sanitizeForDB({
        sessionId,
        role: 'assistant',
        content,
        model: model || null,
        interrupted: true,
        toolActivity: toolActivity || [],
        files: [],
        timestamp: timestamp || Date.now()
      })
      await db.messages.add(assistantMsg)
      console.log('[recovery] Recovered interrupted streaming message for session', sessionId)
    }

    // Clean up the draft
    delete draft.streamingDraft
    await db.drafts.put(draft)
  } catch (e) {
    console.warn('[recovery] Failed to recover streaming draft:', e.message)
  }
}

export function useChat() {
  const { getState, activeState, activeId } = useSessionState()

  // Reactive lenses into the active session — these follow activeId automatically
  const current = computed(() => activeState())

  const messages = computed(() => current.value.messages.value)
  const streaming = computed(() => current.value.streaming.value)
  const streamingContent = computed(() => current.value.streamingContent.value)
  const error = computed(() => current.value.error.value)
  const contextWarning = computed(() => current.value.contextWarning.value)

  // Tool execution lenses
  const toolActivity = computed(() => current.value.toolActivity.value)
  const pendingToolConfirmation = computed(() => current.value.pendingToolConfirmation.value)

  async function loadMessages(sessionId) {
    if (!sessionId) {
      const s = activeState()
      s.messages.value = []
      return
    }
    // Recover any crashed streaming drafts BEFORE loading messages
    await recoverStreamingDrafts(sessionId)

    const s = getState(sessionId)
    console.time('[perf] loadMessages:db')
    const result = await db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp')
    console.timeEnd('[perf] loadMessages:db')
    s.messages.value = result
  }

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase, projectInstructions, activePlans, searchFn, mcpConfig) {
    const s = getState(sessionId)
    s.error.value = null
    s.streamInterrupted = false
    const { clearActivity, snapshotActivity } = useToolExecution(s)
    clearActivity()

    // Build file contents for attached files
    const fileContents = []
    if (dirHandle && attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const text = await readFile(dirHandle, file.path)
          fileContents.push({ path: file.path, content: text })
        } catch (e) {
          fileContents.push({ path: file.path, content: `[Error reading file: ${e.message}]` })
        }
      }
    }

    let fullContent = ''
    if (fileContents.length > 0) {
      fullContent += fileContents.map(f =>
        `<file path="${f.path}">\n${f.content}\n</file>`
      ).join('\n\n')
      fullContent += '\n\n'
    }
    fullContent += content

    // Save user message
    const userMsg = {
      sessionId,
      role: 'user',
      content: fullContent,
      files: attachedFiles.map(f => ({ path: f.path, name: f.name })),
      timestamp: Date.now()
    }
    const safeUserMsg = sanitizeForDB(userMsg)
    const userMsgId = await db.messages.add(safeUserMsg)
    safeUserMsg.id = userMsgId
    s.messages.value.push(safeUserMsg)

    // Resolve MCP tools
    const { getEnabledTools, callMcpTool } = useMCP()
    const { isAutoApproved } = usePermissions()
    const enabledMcpTools = mcpConfig ? getEnabledTools(mcpConfig) : []

    // Build messages array for API
    const apiMessages = []
    apiMessages.push({
      role: 'system',
      content: buildSystemPrompt(phase, projectInstructions, activePlans, enabledMcpTools)
    })
    for (const msg of s.messages.value) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const apiMsg = { role: msg.role, content: msg.content }
        if (msg.toolCalls) {
          apiMsg.tool_calls = msg.toolCalls
          if (!apiMsg.content) apiMsg.content = null
        }
        apiMessages.push(apiMsg)
      } else if (msg.role === 'tool') {
        apiMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content
        })
      }
    }

    s.streaming.value = true
    s.streamingContent.value = ''
    s.abortController = new AbortController()

    // Start periodic streaming draft save (crash recovery)
    const draftSaver = startStreamingDraftSave(sessionId, s, model)
    const flushOnUnload = () => draftSaver.flush()
    window.addEventListener('beforeunload', flushOnUnload)

    let completed = false

    try {
      if (isCliModel(model)) {
        // === CLI path ===
        const { content: cliContent, usage } = await runCliChat({
          sessionId, model, fullContent,
          phase, projectInstructions, activePlans,
          onContent(text) { s.streamingContent.value = text },
          sessionState: s
        })

        // If stopStreaming() was called during the stream, it already saved
        if (!s.streamInterrupted) {
          await saveAssistantMessage(sessionId, s, cliContent, null, usage, model, snapshotActivity())
          checkContextUsage(s, usage, model)
          completed = true

          if (s.messages.value.filter(m => m.role === 'user').length === 1) {
            return generateTitle(content)
          }
        } else {
          completed = true
        }
      } else {
        // === OpenRouter path ===
        if (!apiKey) {
          throw new Error('OpenRouter API key required for this model. Configure it in Settings, or switch to a CLI model.')
        }
        const tools = dirHandle ? getAllTools(enabledMcpTools) : enabledMcpTools.length ? getAllTools(enabledMcpTools) : []

        const result = await runOpenRouterLoop({
          apiKey, model, apiMessages, tools, sessionId,
          isAutoApproved, mcpConfig, callMcpTool, searchFn, dirHandle,
          signal: s.abortController.signal,
          onContent(text) { s.streamingContent.value = text },
          onResetStreaming() { s.streamingContent.value = '' },
          async onSaveAssistant(content, toolCalls, usage, model) {
            // Don't attach toolActivity here — tools haven't executed yet.
            // We'll update the message after tool execution via onUpdateAssistantActivity.
            return saveAssistantMessage(sessionId, s, content, toolCalls, usage, model)
          },
          async onSaveTool(callId, toolName, args, content) {
            const toolMsg = sanitizeForDB({
              sessionId,
              role: 'tool',
              toolCallId: callId,
              toolName,
              toolArgs: args,
              content,
              resultType: classifyResult(toolName, content),
              timestamp: Date.now()
            })
            const toolMsgId = await db.messages.add(toolMsg)
            toolMsg.id = toolMsgId
            s.messages.value.push(toolMsg)
          },
          async onToolsComplete(assistantMsg) {
            // Attach the tool activity snapshot now that all tools have finished
            const snapshot = snapshotActivity()
            if (snapshot.length && assistantMsg?.id) {
              assistantMsg.toolActivity = snapshot
              await db.messages.update(assistantMsg.id, { toolActivity: snapshot })
              // Trigger reactivity
              s.messages.value = [...s.messages.value]
            }
          },
          sessionState: s
        })

        if (!s.streamInterrupted) {
          if (result) {
            await saveAssistantMessage(sessionId, s, result.content, null, result.usage, result.model, snapshotActivity())
            checkContextUsage(s, result.usage, model)
            completed = true

            if (s.messages.value.filter(m => m.role === 'user').length === 1) {
              return generateTitle(content)
            }
          }
        } else {
          completed = true
        }
      }
    } catch (e) {
      // AbortError is expected when user stops streaming — not a real error
      if (e.name === 'AbortError') {
        console.log('[chat] Stream aborted by user')
        completed = true // stopStreaming already saved partial content
      } else {
        console.error(`[chat] error:`, e.message)
        s.error.value = e.message

        // Save partial content on error (bridge disconnect, network failure, etc.)
        const partialContent = s.streamingContent.value
        if (partialContent && sessionId && !s.streamInterrupted) {
          try {
            // Force-complete any running tool activities
            for (const a of s.toolActivity.value) {
              if (a.status === 'running') a.status = 'done'
            }
            await saveAssistantMessage(sessionId, s, partialContent, null, null, model, snapshotActivity(), true)
            completed = true
          } catch (saveErr) {
            console.error('[chat] Failed to save partial content:', saveErr.message)
          }
        }
      }
    } finally {
      window.removeEventListener('beforeunload', flushOnUnload)
      await draftSaver.cleanup(completed || s.streamInterrupted)
      s.streaming.value = false
      s.streamingContent.value = ''
      s.abortController = null
      s.streamInterrupted = false
      clearCliRequestId(s)
      // Clear live tool activity — persisted snapshot is now on the assistant message
      clearActivity()
    }

    return null
  }

  async function saveAssistantMessage(sessionId, s, content, toolCalls, usage, model, toolActivitySnapshot, interrupted = false) {
    const raw = {
      sessionId,
      role: 'assistant',
      content,
      model,
      files: [],
      timestamp: Date.now()
    }
    if (usage) raw.usage = usage
    if (toolCalls) raw.toolCalls = toolCalls
    if (toolActivitySnapshot?.length) raw.toolActivity = toolActivitySnapshot
    if (interrupted) raw.interrupted = true

    // JSON round-trip the entire message to strip reactive proxies, functions,
    // and anything else that would cause DataCloneError in IndexedDB
    const assistantMsg = sanitizeForDB(raw)
    const id = await db.messages.add(assistantMsg)
    assistantMsg.id = id
    s.messages.value.push(assistantMsg)
    return assistantMsg
  }

  function checkContextUsage(s, usage, model) {
    if (!usage) return
    const { getModelInfo } = useOpenRouter()
    const modelInfo = getModelInfo(model)
    if (modelInfo?.context_length) {
      const used = (usage.promptTokens || 0) + (usage.completionTokens || 0)
      const pct = (used / modelInfo.context_length) * 100
      if (pct >= 80) {
        s.contextWarning.value = `Context ${Math.round(pct)}% full (${used.toLocaleString()} / ${modelInfo.context_length.toLocaleString()} tokens). Consider starting a new session.`
      } else {
        s.contextWarning.value = null
      }
    }
  }

  function generateTitle(firstMessage) {
    const title = firstMessage.slice(0, 50).trim()
    return title + (firstMessage.length > 50 ? '...' : '')
  }

  async function stopStreaming() {
    const s = current.value
    const content = s.streamingContent.value
    const sid = activeId.value

    // Save partial content before killing the stream
    if (content && sid && !s.streamInterrupted) {
      try {
        const { snapshotActivity } = useToolExecution(s)
        // Force-complete any still-running tool activities
        for (const a of s.toolActivity.value) {
          if (a.status === 'running') a.status = 'done'
        }
        await saveAssistantMessage(sid, s, content, null, null, null, snapshotActivity(), true)
      } catch (e) {
        console.error('[chat] Failed to save partial content on stop:', e.message)
      }
    }

    s.streamInterrupted = true

    // Signal abort to both paths
    stopCli(s)
    if (s.abortController) {
      s.abortController.abort()
      s.abortController = null
    }
    s.streaming.value = false
  }

  function clearChat() {
    const s = current.value
    s.messages.value = []
    s.streamingContent.value = ''
    s.error.value = null
    const { clearActivity } = useToolExecution(s)
    clearActivity()
  }

  function resolveToolConfirmation(result) {
    const { resolveToolConfirmation: resolve } = useToolExecution(current.value)
    return resolve(result)
  }

  function rejectToolConfirmation(reason) {
    const { rejectToolConfirmation: reject } = useToolExecution(current.value)
    return reject(reason)
  }

  return {
    messages,
    streaming,
    streamingContent,
    toolActivity,
    error,
    pendingToolConfirmation,
    contextWarning,
    loadMessages,
    sendMessage,
    stopStreaming,
    clearChat,
    resolveToolConfirmation,
    rejectToolConfirmation
  }
}
