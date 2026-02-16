import { readFileSafe, writeFile, requestWritePermission } from './filesystem.js'
import { deleteFile as fsDeleteFile, moveFile as fsMoveFile, fileExists as fsFileExists } from './filesystem.js'

const MAX_FILE_SIZE = 100 * 1024 // 100KB

export const READ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listDirectory',
      description: 'List all entries (files and directories) in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project root. Use "" or "." for root.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'searchFiles',
      description: 'Fuzzy search for files by name or path',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to match against file names and paths' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fileExists',
      description: 'Check if a file exists at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' }
        },
        required: ['path']
      }
    }
  }
]

export const WRITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'createFile',
      description: 'Create a new file with the given content. Fails if the file already exists.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: { type: 'string', description: 'Content to write to the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deleteFile',
      description: 'Delete a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'moveFile',
      description: 'Move or rename a file from one path to another',
      parameters: {
        type: 'object',
        properties: {
          fromPath: { type: 'string', description: 'Current file path relative to project root' },
          toPath: { type: 'string', description: 'Destination file path relative to project root' }
        },
        required: ['fromPath', 'toPath']
      }
    }
  }
]

export const SYSTEM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_chat_title',
      description: 'Set the title of the current conversation. Call this once during your first response to give the chat a concise, descriptive title (5-8 words).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise descriptive title (5-8 words)' }
        },
        required: ['title']
      }
    }
  }
]

export const AUTO_EXECUTE_TOOLS = new Set([
  'readFile', 'listDirectory', 'searchFiles', 'fileExists', 'set_chat_title'
])

export function getAllTools(mcpTools = []) {
  return [...READ_TOOLS, ...WRITE_TOOLS, ...SYSTEM_TOOLS, ...mcpTools]
}

export async function executeTool(name, args, dirHandle, searchFn) {
  switch (name) {
    case 'readFile': {
      const content = await readFileSafe(dirHandle, args.path)
      if (content === null) {
        return JSON.stringify({ error: `File not found: ${args.path}` })
      }
      if (content.length > MAX_FILE_SIZE) {
        return content.slice(0, MAX_FILE_SIZE) + `\n\n[Truncated — file is ${content.length} bytes, showing first ${MAX_FILE_SIZE} bytes]`
      }
      return content
    }

    case 'listDirectory': {
      try {
        const path = args.path === '.' || args.path === '' ? '' : args.path
        let current = dirHandle
        if (path) {
          const parts = path.split('/')
          for (const part of parts) {
            current = await current.getDirectoryHandle(part)
          }
        }
        const entries = []
        for await (const entry of current.values()) {
          entries.push({
            name: entry.name,
            kind: entry.kind
          })
        }
        entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        return JSON.stringify(entries)
      } catch (e) {
        return JSON.stringify({ error: `Cannot list directory: ${args.path} — ${e.message}` })
      }
    }

    case 'searchFiles': {
      if (!searchFn) {
        return JSON.stringify({ error: 'File search is not available' })
      }
      const results = searchFn(args.query)
      const paths = results.slice(0, 20).map(r => r.path)
      return JSON.stringify(paths)
    }

    case 'fileExists': {
      const exists = await fsFileExists(dirHandle, args.path)
      return JSON.stringify({ exists })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

export async function executeWriteTool(name, args, dirHandle) {
  const granted = await requestWritePermission(dirHandle)
  if (!granted) {
    return JSON.stringify({ error: 'Write permission denied by user' })
  }

  switch (name) {
    case 'createFile': {
      const exists = await fsFileExists(dirHandle, args.path)
      if (exists) {
        return JSON.stringify({ error: `File already exists: ${args.path}` })
      }
      await writeFile(dirHandle, args.path, args.content)
      return JSON.stringify({ success: true, path: args.path })
    }

    case 'deleteFile': {
      const exists = await fsFileExists(dirHandle, args.path)
      if (!exists) {
        return JSON.stringify({ error: `File not found: ${args.path}` })
      }
      await fsDeleteFile(dirHandle, args.path)
      return JSON.stringify({ success: true, path: args.path })
    }

    case 'moveFile': {
      const sourceExists = await fsFileExists(dirHandle, args.fromPath)
      if (!sourceExists) {
        return JSON.stringify({ error: `Source file not found: ${args.fromPath}` })
      }
      await fsMoveFile(dirHandle, args.fromPath, args.toPath)
      return JSON.stringify({ success: true, fromPath: args.fromPath, toPath: args.toPath })
    }

    default:
      return JSON.stringify({ error: `Unknown write tool: ${name}` })
  }
}

// Enable HMR boundary — errors here don't cascade to full reload
if (import.meta.hot) import.meta.hot.accept()
