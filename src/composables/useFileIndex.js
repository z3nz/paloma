import { ref, shallowRef } from 'vue'
import Fuse from 'fuse.js'
import ignore from 'ignore'
import { walkDirectory, readGitignore, fileExists } from '../services/filesystem.js'

const files = ref([])
const indexing = ref(false)
const fuse = shallowRef(null)

const FUSE_OPTIONS = {
  keys: ['name', 'path'],
  threshold: 0.4,
  distance: 100,
  maxPatternLength: 64
}

function rebuildFuse(fileList) {
  return new Fuse(fileList, FUSE_OPTIONS)
}

function pathToEntry(path) {
  const name = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path
  const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
  return { path, name, dir }
}

export function useFileIndex() {
  async function buildIndex(dirHandle) {
    console.time('[perf] buildIndex')
    indexing.value = true
    files.value = []

    // Parse .gitignore
    const gitignoreContent = await readGitignore(dirHandle)
    const ig = ignore()
    if (gitignoreContent) {
      ig.add(gitignoreContent)
    }
    // Always ignore common dirs
    ig.add(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv'])

    const fileList = []
    for await (const entry of walkDirectory(dirHandle)) {
      if (!ig.ignores(entry.path)) {
        fileList.push(pathToEntry(entry.path))
      }
    }

    files.value = fileList
    fuse.value = rebuildFuse(fileList)

    indexing.value = false
    console.timeEnd('[perf] buildIndex')
  }

  async function updatePaths(dirHandle, changedPaths) {
    console.time('[perf] updatePaths')
    const updated = [...files.value]

    for (const change of changedPaths) {
      if (change.action === 'add' || change.action === 'update') {
        const exists = await fileExists(dirHandle, change.path)
        if (exists) {
          const idx = updated.findIndex(f => f.path === change.path)
          const entry = pathToEntry(change.path)
          if (idx >= 0) {
            updated[idx] = entry
          } else {
            updated.push(entry)
          }
        }
      } else if (change.action === 'remove') {
        const idx = updated.findIndex(f => f.path === change.path)
        if (idx >= 0) updated.splice(idx, 1)
      } else if (change.action === 'move') {
        const idx = updated.findIndex(f => f.path === change.fromPath)
        if (idx >= 0) updated.splice(idx, 1)
        const exists = await fileExists(dirHandle, change.toPath)
        if (exists) {
          updated.push(pathToEntry(change.toPath))
        }
      }
    }

    files.value = updated
    fuse.value = rebuildFuse(updated)
    console.timeEnd('[perf] updatePaths')
  }

  function search(query) {
    if (!fuse.value || !query) return []
    return fuse.value.search(query, { limit: 15 }).map(r => r.item)
  }

  function clearIndex() {
    files.value = []
    fuse.value = null
  }

  return {
    files,
    indexing,
    buildIndex,
    updatePaths,
    search,
    clearIndex
  }
}
