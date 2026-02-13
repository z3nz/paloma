import { computed } from 'vue'
import { extractAnnotatedCodeBlocks } from '../services/codeBlockExtractor.js'
import { readFileSafe, requestWritePermission, writeFile } from '../services/filesystem.js'
import { resolveEdit } from '../services/editing.js'
import db from '../services/db.js'
import { useSessionState } from './useSessionState.js'

async function persistChanges(sessionId, pendingChanges) {
  if (!sessionId) return
  try {
    const existing = await db.drafts.get(sessionId)
    await db.drafts.put({
      sessionId,
      ...existing,
      pendingChanges: pendingChanges.value.map(c => ({
        path: c.path,
        originalContent: c.originalContent,
        newContent: c.newContent,
        error: c.error,
        status: c.status
      })),
      updatedAt: Date.now()
    })
  } catch {
    // Best-effort persistence — UI continues working without storage
  }
}

export function useChanges(sessionState) {
  if (!sessionState) {
    const { activeState } = useSessionState()
    sessionState = activeState()
  }

  const pendingChanges = sessionState.pendingChanges
  let _sessionId = null

  const hasPendingChanges = computed(() =>
    pendingChanges.value.some(c => c.status === 'pending')
  )

  const pendingCount = computed(() =>
    pendingChanges.value.filter(c => c.status === 'pending').length
  )

  function autoRemoveApplied() {
    setTimeout(async () => {
      const remaining = pendingChanges.value.filter(c => c.status !== 'applied')
      if (remaining.length !== pendingChanges.value.length) {
        pendingChanges.value = remaining
        await persistChanges(_sessionId, pendingChanges)
      }
    }, 1500)
  }

  async function loadSessionChanges(sessionId) {
    _sessionId = sessionId
    if (!sessionId) {
      pendingChanges.value = []
      return
    }
    const { getState } = useSessionState()
    const state = getState(sessionId)
    const draft = await db.drafts.get(sessionId)
    state.pendingChanges.value = draft?.pendingChanges || []
  }

  async function detectChanges(markdown, dirHandle) {
    const blocks = extractAnnotatedCodeBlocks(markdown)
    if (blocks.length === 0) {
      pendingChanges.value = []
      await persistChanges(_sessionId, pendingChanges)
      return
    }

    const grouped = new Map()
    for (const block of blocks) {
      if (!grouped.has(block.path)) {
        grouped.set(block.path, [])
      }
      grouped.get(block.path).push(block)
    }

    const changes = []
    for (const [path, fileBlocks] of grouped) {
      const originalContent = await readFileSafe(dirHandle, path)
      let newContent = null
      let error = null

      try {
        let current = originalContent
        for (const block of fileBlocks) {
          const result = resolveEdit(block.code, current)
          current = result.newContent
        }
        newContent = current
      } catch (err) {
        error = err.message
      }

      changes.push({
        path,
        originalContent,
        newContent,
        error,
        status: error ? 'error' : 'pending'
      })
    }

    pendingChanges.value = changes
    await persistChanges(_sessionId, pendingChanges)
  }

  async function applyChange(index, dirHandle) {
    const change = pendingChanges.value[index]
    if (!change || change.status !== 'pending') return

    try {
      const granted = await requestWritePermission(dirHandle)
      if (!granted) {
        change.error = 'Write permission denied.'
        change.status = 'error'
        pendingChanges.value = [...pendingChanges.value]
        await persistChanges(_sessionId, pendingChanges)
        return
      }
      await writeFile(dirHandle, change.path, change.newContent)
      change.status = 'applied'
      pendingChanges.value = [...pendingChanges.value]
      await persistChanges(_sessionId, pendingChanges)
      autoRemoveApplied()
    } catch (err) {
      change.error = `Failed to write file: ${err.message}`
      change.status = 'error'
      pendingChanges.value = [...pendingChanges.value]
      await persistChanges(_sessionId, pendingChanges)
    }
  }

  async function applyAll(dirHandle) {
    const pending = pendingChanges.value.filter(c => c.status === 'pending')
    if (pending.length === 0) return

    try {
      const granted = await requestWritePermission(dirHandle)
      if (!granted) return
    } catch {
      return
    }

    for (const change of pending) {
      try {
        await writeFile(dirHandle, change.path, change.newContent)
        change.status = 'applied'
      } catch (err) {
        change.error = `Failed to write file: ${err.message}`
        change.status = 'error'
      }
    }
    pendingChanges.value = [...pendingChanges.value]
    await persistChanges(_sessionId, pendingChanges)
    autoRemoveApplied()
  }

  async function dismissChange(index) {
    pendingChanges.value = pendingChanges.value.filter((_, i) => i !== index)
    await persistChanges(_sessionId, pendingChanges)
  }

  async function dismissAll() {
    pendingChanges.value = []
    await persistChanges(_sessionId, pendingChanges)
  }

  return {
    pendingChanges,
    hasPendingChanges,
    pendingCount,
    loadSessionChanges,
    detectChanges,
    applyChange,
    applyAll,
    dismissChange,
    dismissAll
  }
}
