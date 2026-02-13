import { ref, watch } from 'vue'
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
    if (!projectPath) {
      console.error('[Sessions] Cannot create session without projectPath')
      return null
    }
    const id = await db.sessions.add({
      projectPath,
      title: 'New Chat',
      model,
      phase,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    await loadSessions(projectPath)
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

  return {
    sessions,
    activeSessionId,
    loadSessions,
    createSession,
    updateSession,
    deleteSession,
    setActiveSession
  }
}
