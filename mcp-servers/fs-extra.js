#!/usr/bin/env node

// MCP server that extends filesystem capabilities with operations
// that the standard @modelcontextprotocol/server-filesystem doesn't provide.
// Specifically: delete files/directories and copy files.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { rm, cp, access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

// Safety: only allow operations under /home/adam
const ALLOWED_ROOT = resolve(homedir())

function isAllowed(path) {
  const resolved = resolve(path)
  return resolved.startsWith(ALLOWED_ROOT)
}

const server = new Server(
  { name: 'fs-extra', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'delete',
      description: 'Delete a file or directory. Supports recursive deletion for directories. Only works within the home directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to the file or directory to delete'
          },
          recursive: {
            type: 'boolean',
            description: 'If true, recursively delete directories and their contents. Required for non-empty directories.',
            default: false
          }
        },
        required: ['path']
      }
    },
    {
      name: 'copy',
      description: 'Copy a file or directory to a new location. Supports recursive copy for directories. Only works within the home directory.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Absolute path to the source file or directory'
          },
          destination: {
            type: 'string',
            description: 'Absolute path to the destination'
          },
          recursive: {
            type: 'boolean',
            description: 'If true, recursively copy directories',
            default: false
          }
        },
        required: ['source', 'destination']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'delete') return handleDelete(args)
  if (name === 'copy') return handleCopy(args)

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  }
})

async function handleDelete({ path, recursive = false }) {
  try {
    const resolved = resolve(path)

    if (!isAllowed(resolved)) {
      return {
        content: [{ type: 'text', text: `Blocked: ${resolved} is outside allowed directory (${ALLOWED_ROOT})` }],
        isError: true
      }
    }

    // Don't allow deleting the home directory itself
    if (resolved === ALLOWED_ROOT) {
      return {
        content: [{ type: 'text', text: 'Blocked: cannot delete the home directory' }],
        isError: true
      }
    }

    // Check the target exists
    const info = await stat(resolved)
    const type = info.isDirectory() ? 'directory' : 'file'

    await rm(resolved, { recursive, force: false })

    return {
      content: [{ type: 'text', text: `Deleted ${type}: ${resolved}` }]
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Delete error: ${e.message}` }],
      isError: true
    }
  }
}

async function handleCopy({ source, destination, recursive = false }) {
  try {
    const resolvedSrc = resolve(source)
    const resolvedDst = resolve(destination)

    if (!isAllowed(resolvedSrc)) {
      return {
        content: [{ type: 'text', text: `Blocked: source ${resolvedSrc} is outside allowed directory` }],
        isError: true
      }
    }
    if (!isAllowed(resolvedDst)) {
      return {
        content: [{ type: 'text', text: `Blocked: destination ${resolvedDst} is outside allowed directory` }],
        isError: true
      }
    }

    await cp(resolvedSrc, resolvedDst, { recursive })

    return {
      content: [{ type: 'text', text: `Copied ${resolvedSrc} → ${resolvedDst}` }]
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Copy error: ${e.message}` }],
      isError: true
    }
  }
}

const transport = new StdioServerTransport()
await server.connect(transport)
