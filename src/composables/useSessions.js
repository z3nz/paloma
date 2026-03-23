import { ref, computed } from 'vue'
import db from '../services/db.js'

const sessions = ref([])
const activeSessionId = ref(Number(sessionStorage.getItem('paloma:activeSessionId')) || null)

// Prevent concurrent hydration of the same session (race condition guard)
const _pendingHydrations = new Map()

export function useSessions() {
  async function recoverOrphanedSessions(projectPath) {
    const orphans = await db.sessions
      .filter(s => !s.projectPath)
      .toArray()
    if (orphans.length > 0) {
      await Promise.all(
        orphans.map(s => db.sessions.update(s.id, { projectPath }))
      )
      console.log(`[Recovery] Assigned ${orphans.length} orphaned sessions to "${projectPath}"`)
    }
    return orphans.length
  }

  async function loadSessions(projectPath) {
    await recoverOrphanedSessions(projectPath)
    const result = await db.sessions
      .where('projectPath')
      .equals(projectPath)
      .reverse()
      .sortBy('updatedAt')
    sessions.value = result
  }

  async function createSession(projectPath, model, phase = 'flow') {
    // Default to 'paloma' when no project is attached
    const resolvedPath = projectPath || 'paloma'
    const id = await db.sessions.add({
      projectPath: resolvedPath,
      title: 'New Chat',
      model,
      phase,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    await loadSessions(resolvedPath)
    activeSessionId.value = id
    sessionStorage.setItem('paloma:activeSessionId', id)
    return id
  }

  async function updateSession(id, updates) {
    await db.sessions.update(id, { ...updates, updatedAt: Date.now() })
    const session = sessions.value.find(s => s.id === id)
    if (session) {
      Object.assign(session, updates, { updatedAt: Date.now() })
    }
  }

  async function deleteSession(id) {
    await db.sessions.delete(id)
    await db.messages.where('sessionId').equals(id).delete()
    await db.drafts.delete(id)
    const projectPath = sessions.value.find(s => s.id === id)?.projectPath
    if (activeSessionId.value === id) {
      activeSessionId.value = null
      sessionStorage.removeItem('paloma:activeSessionId')
    }
    if (projectPath) await loadSessions(projectPath)
  }

  function setActiveSession(id) {
    activeSessionId.value = id
    if (id != null) {
      sessionStorage.setItem('paloma:activeSessionId', id)
    } else {
      sessionStorage.removeItem('paloma:activeSessionId')
    }
  }

  /**
   * Find the most recent Flow session for a project.
   * Returns the session object or null.
   */
  function findFlowSession(projectPath) {
    return sessions.value.find(s => s.projectPath === projectPath && s.phase === 'flow') || null
  }

  /**
   * Create a new session for a pillar transition.
   * Injects a birth/transition message as the first user message.
   */
  async function createPhaseSession(projectPath, model, phase, birthContext) {
    const resolvedPath = projectPath || 'paloma'
    const id = await db.sessions.add({
      projectPath: resolvedPath,
      title: `${phase.charAt(0).toUpperCase() + phase.slice(1)} Session`,
      model,
      phase,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    // Inject birth message
    if (birthContext) {
      await db.messages.add({
        sessionId: id,
        role: 'user',
        content: birthContext,
        files: [],
        timestamp: Date.now()
      })
    }

    await loadSessions(resolvedPath)
    activeSessionId.value = id
    sessionStorage.setItem('paloma:activeSessionId', id)
    return id
  }

  /**
   * Create a session for a pillar spawned by Flow (sub-agent orchestration).
   * Does NOT set it as active — pillar sessions run in the background.
   * Returns the new dbSessionId.
   */
  async function createPillarSession(projectPath, model, phase, pillarId, flowRequestId, prompt) {
    const resolvedPath = projectPath || 'paloma'
    const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1)
    const id = await db.sessions.add({
      projectPath: resolvedPath,
      title: `${phaseLabel} (spawned)`,
      model,
      phase,
      pillarId,
      parentFlowSessionId: flowRequestId, // links child to parent Flow
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    // Inject the birth/prompt message
    if (prompt) {
      await db.messages.add({
        sessionId: id,
        role: 'user',
        content: prompt,
        files: [],
        timestamp: Date.now()
      })
    }

    await loadSessions(resolvedPath)
    return id
  }

  const sessionTree = computed(() => {
    // Filter out email sessions — they belong in the inbox, not the chat sidebar
    const chatSessions = sessions.value.filter(s => s.source !== 'email')
    const childMap = new Map()
    const parentIds = new Set(chatSessions.map(s => s.id))

    for (const session of chatSessions) {
      if (session.parentFlowSessionId && parentIds.has(session.parentFlowSessionId)) {
        const siblings = childMap.get(session.parentFlowSessionId) || []
        siblings.push(session)
        childMap.set(session.parentFlowSessionId, siblings)
      }
    }

    const topLevel = []
    for (const session of chatSessions) {
      const isOrphan = session.parentFlowSessionId && !parentIds.has(session.parentFlowSessionId)
      if (!session.parentFlowSessionId || isOrphan) {
        const children = (childMap.get(session.id) || [])
          .sort((a, b) => a.createdAt - b.createdAt)
        topLevel.push({ ...session, children })
      }
    }

    return topLevel
  })

  async function hydrateSessionFromBridge(cliSessionId, messageId, emailContext = null) {
    if (!cliSessionId) return null
    const pillarId = `email:${messageId}`
    
    // If hydration is already in progress for this pillarId, return the same promise
    if (_pendingHydrations.has(pillarId)) return _pendingHydrations.get(pillarId)
    
    const promise = (async () => {
      // 1. Check if session already exists by pillarId
      const existing = await db.sessions.where('pillarId').equals(pillarId).first()
      if (existing) return existing.id
      
      // 2. Fetch history from bridge
      const wsUrl = localStorage.getItem('paloma:mcpBridgeUrl') || 'ws://localhost:19191'
      const baseUrl = wsUrl.replace(/^ws/, 'http')
      
      try {
        const resp = await fetch(`${baseUrl}/api/emails/session/${cliSessionId}/history`)
        if (!resp.ok) return null
        const { events } = await resp.json()
        if (!events || events.length === 0) return null
        
        // 3. Create session in IndexedDB
        const id = await db.sessions.add({
          projectPath: 'paloma',
          title: emailContext?.subject || 'Email Session',
          model: 'claude-cli:opus',
          phase: 'flow',
          pillarId,
          source: 'email',
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
        
        // 4. Map events to messages
        await mapEventsToMessages(id, events, emailContext)
        
        // 5. Reload sessions
        await loadSessions('paloma')
        return id
      } catch (err) {
        console.error('[hydrate] Failed to hydrate session:', err)
        return null
      }
    })()
    
    _pendingHydrations.set(pillarId, promise)
    promise.finally(() => _pendingHydrations.delete(pillarId))
    return promise
  }

  async function mapEventsToMessages(dbSessionId, events, emailContext = null) {
    // If we have emailContext, create the initial user message if it's not in the events
    if (emailContext) {
      const summary = [`From: ${emailContext.from}`, `Subject: ${emailContext.subject}`, '', emailContext.body || ''].join('\n')
      await db.messages.add({
        sessionId: dbSessionId,
        role: 'user',
        content: summary,
        timestamp: Date.now()
      })
    }

    // Claude CLI emits both streaming events (content_block_*) AND a final complete
    // 'assistant' event. If the final event is present, skip streaming events to
    // avoid duplicating text and tool activities.
    const hasAssistantEvent = events.some(w => {
      const e = w.event || w
      return e.type === 'assistant' && e.message?.content
    })

    let assistantText = ''
    let toolActivities = []

    for (const wrapper of events) {
      const event = wrapper.event || wrapper // Support both wrapped and direct formats
      
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            assistantText += block.text
          } else if (block.type === 'tool_use') {
            toolActivities.push({
              id: block.id,
              name: block.name,
              input: block.input,
              status: 'done'
            })
          }
        }
      } else if (!hasAssistantEvent && event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        // Fallback: only use streaming events if no final assistant event exists
        const block = event.content_block
        toolActivities.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
          status: 'done'
        })
      } else if (!hasAssistantEvent && event.type === 'content_block_delta') {
        // Fallback: only use streaming events if no final assistant event exists
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          assistantText += event.delta.text
        }
      } else if (event.type === 'user' && event.message?.content) {
        // Handle tool results
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const activity = toolActivities.find(a => a.id === block.tool_use_id)
            let resultStr = ''
            try {
              resultStr = Array.isArray(block.content)
                ? block.content.map(c => c.text || '').join('')
                : typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            } catch { resultStr = '[Error serializing tool result]' }

            if (activity) activity.result = resultStr

            await db.messages.add({
              sessionId: dbSessionId,
              role: 'tool',
              toolCallId: block.tool_use_id,
              toolName: activity?.name || 'unknown',
              toolArgs: activity?.input || {},
              content: resultStr,
              timestamp: Date.now()
            })
          }
        }
      }
    }

    // Final assistant message
    if (assistantText || toolActivities.length > 0) {
      await db.messages.add({
        sessionId: dbSessionId,
        role: 'assistant',
        content: assistantText,
        toolActivity: toolActivities.length ? toolActivities : undefined,
        timestamp: Date.now()
      })
    }
  }

  return {
    sessions,
    sessionTree,
    activeSessionId,
    loadSessions,
    createSession,
    createPhaseSession,
    createPillarSession,
    findFlowSession,
    updateSession,
    deleteSession,
    setActiveSession,
    hydrateSessionFromBridge
  }
}
