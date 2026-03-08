import { ref, computed, watch } from 'vue'
import db from '../services/db.js'

const _saved = import.meta.hot ? window.__PALOMA_SESSIONS__ : undefined

const sessions = ref(_saved?.sessions ?? [])
const activeSessionId = ref(_saved?.activeSessionId ?? (Number(sessionStorage.getItem('paloma:activeSessionId')) || null))

if (import.meta.hot) {
  const save = () => {
    window.__PALOMA_SESSIONS__ = {
      sessions: sessions.value,
      activeSessionId: activeSessionId.value
    }
  }
  save()
  watch([sessions, activeSessionId], save, { flush: 'sync' })
}

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
    const childMap = new Map()
    const parentIds = new Set(sessions.value.map(s => s.id))

    for (const session of sessions.value) {
      if (session.parentFlowSessionId && parentIds.has(session.parentFlowSessionId)) {
        const siblings = childMap.get(session.parentFlowSessionId) || []
        siblings.push(session)
        childMap.set(session.parentFlowSessionId, siblings)
      }
    }

    const topLevel = []
    for (const session of sessions.value) {
      const isOrphan = session.parentFlowSessionId && !parentIds.has(session.parentFlowSessionId)
      if (!session.parentFlowSessionId || isOrphan) {
        const children = (childMap.get(session.id) || [])
          .sort((a, b) => a.createdAt - b.createdAt)
        topLevel.push({ ...session, children })
      }
    }

    return topLevel
  })

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
    setActiveSession
  }
}
