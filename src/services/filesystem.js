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

export async function readActivePlans(dirHandle) {
  try {
    const palomaDir = await dirHandle.getDirectoryHandle('.paloma')
    const plansDir = await palomaDir.getDirectoryHandle('plans')
    const activeDir = await plansDir.getDirectoryHandle('active')
    const plans = []
    for await (const entry of activeDir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        const file = await entry.getFile()
        const content = await file.text()
        plans.push({ name: entry.name, content })
      }
    }
    plans.sort((a, b) => a.name.localeCompare(b.name))
    return plans
  } catch {
    return []
  }
}

export async function readMcpConfig(dirHandle) {
  try {
    const palomaDir = await dirHandle.getDirectoryHandle('.paloma')
    const fileHandle = await palomaDir.getFileHandle('mcp.json')
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function requestWritePermission(dirHandle) {
  const status = await dirHandle.queryPermission({ mode: 'readwrite' })
  if (status === 'granted') return true
  const result = await dirHandle.requestPermission({ mode: 'readwrite' })
  return result === 'granted'
}

export async function writeFile(dirHandle, filePath, content) {
  const parts = filePath.split('/')
  let current = dirHandle
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part, { create: true })
  }
  const fileHandle = await current.getFileHandle(parts.at(-1), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function readFileSafe(dirHandle, filePath) {
  try {
    return await readFile(dirHandle, filePath)
  } catch {
    return null
  }
}

export async function deleteFile(dirHandle, filePath) {
  const parts = filePath.split('/')
  let current = dirHandle
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part)
  }
  await current.removeEntry(parts.at(-1))
}

export async function moveFile(dirHandle, fromPath, toPath) {
  const content = await readFile(dirHandle, fromPath)
  await writeFile(dirHandle, toPath, content)
  await deleteFile(dirHandle, fromPath)
}

export async function fileExists(dirHandle, filePath) {
  try {
    await readFile(dirHandle, filePath)
    return true
  } catch {
    return false
  }
}
