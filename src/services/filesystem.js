export async function openProject() {
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  return handle
}

export async function* walkDirectory(dirHandle, path = '') {
  for await (const entry of dirHandle.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name
    if (entry.kind === 'file') {
      yield { handle: entry, path: entryPath, name: entry.name }
    } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
      yield* walkDirectory(entry, entryPath)
    }
  }
}

export async function readFile(dirHandle, filePath) {
  const parts = filePath.split('/')
  let current = dirHandle
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part)
  }
  const fileHandle = await current.getFileHandle(parts.at(-1))
  const file = await fileHandle.getFile()
  return await file.text()
}

export async function readGitignore(dirHandle) {
  try {
    const fileHandle = await dirHandle.getFileHandle('.gitignore')
    const file = await fileHandle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

export async function readProjectInstructions(dirHandle) {
  try {
    const palomaDir = await dirHandle.getDirectoryHandle('.paloma')
    const fileHandle = await palomaDir.getFileHandle('instructions.md')
    const file = await fileHandle.getFile()
    return await file.text()
  } catch {
    return null
  }
}
