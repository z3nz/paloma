import { ref, shallowRef } from 'vue'
import Fuse from 'fuse.js'
import ignore from 'ignore'
import { walkDirectory, readGitignore } from '../services/filesystem.js'

const files = ref([])
const indexing = ref(false)
const fuse = shallowRef(null)

export function useFileIndex() {
  async function buildIndex(dirHandle) {
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
        const dir = entry.path.includes('/')
          ? entry.path.substring(0, entry.path.lastIndexOf('/'))
          : ''
        fileList.push({
          path: entry.path,
          name: entry.name,
          dir
        })
      }
    }

    files.value = fileList
    fuse.value = new Fuse(fileList, {
      keys: ['name', 'path'],
      threshold: 0.4,
      distance: 100,
      maxPatternLength: 64
    })

    indexing.value = false
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
    search,
    clearIndex
  }
}
