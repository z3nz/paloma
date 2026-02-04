import { ref, computed } from 'vue'
import { extractAnnotatedCodeBlocks } from '../services/codeBlockExtractor.js'
import { readFileSafe, requestWritePermission, writeFile } from '../services/filesystem.js'
import { resolveEdit } from '../services/editing.js'
import db from '../services/db.js'

const pendingChanges = ref([])
const currentSessionId = ref(null)

async function persistChanges() {
  const sessionId = currentSessionId.value
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

export function useChanges() {
  const hasPendingChanges = computed(() =>
    pendingChanges.value.some(c => c.status === 'pending')
  )

  const pendingCount = computed(() =>
    pendingChanges.value.filter(c => c.status === 'pending').length
  )

  async function loadSessionChanges(sessionId) {
    currentSessionId.value = sessionId
    if (!sessionId) {
      pendingChanges.value = []
      return
    }
    const draft = await db.drafts.get(sessionId)
    pendingChanges.value = draft?.pendingChanges || []
  }

  async function detectChanges(markdown, dirHandle) {
    const blocks = extractAnnotatedCodeBlocks(markdown)
    if (blocks.length === 0) {
      pendingChanges.value = []
      await persistChanges()
      return
    }

    // Group blocks by path (preserving order of first appearance)
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
        // Apply blocks sequentially — output of first becomes input to second
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
    await persistChanges()
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
        await persistChanges()
        return
      }
      await writeFile(dirHandle, change.path, change.newContent)
      change.status = 'applied'
      pendingChanges.value = [...pendingChanges.value]
      await persistChanges()
    } catch (err) {
      change.error = `Failed to write file: ${err.message}`
      change.status = 'error'
      pendingChanges.value = [...pendingChanges.value]
      await persistChanges()
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
    await persistChanges()
  }

  async function dismissChange(index) {
    pendingChanges.value = pendingChanges.value.filter((_, i) => i !== index)
    await persistChanges()
  }

  async function dismissAll() {
    pendingChanges.value = []
    await persistChanges()
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
