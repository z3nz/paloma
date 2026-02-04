import { ref } from 'vue'
import db from '../services/db.js'

const sessions = ref([])
const activeSessionId = ref(null)

export function useSessions() {
  async function loadSessions(projectPath) {
    const result = await db.sessions
      .where('projectPath')
      .equals(projectPath)
      .reverse()
      .sortBy('updatedAt')
    sessions.value = result
  }

  async function createSession(projectPath, model, phase = 'research') {
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
    const projectPath = sessions.value.find(s => s.id === id)?.projectPath
    if (activeSessionId.value === id) {
      activeSessionId.value = null
    }
    if (projectPath) await loadSessions(projectPath)
  }

  function setActiveSession(id) {
    activeSessionId.value = id
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
