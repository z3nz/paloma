#!/usr/bin/env node

// MCP server for client file management.
// Tools: files_list, files_upload, files_delete, files_search
// Files stored at ~/paloma/projects/{slug}/files/ with .index.json sidecar.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { readFile, writeFile, mkdir, unlink, rename, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { homedir } from 'node:os'

const PROJECTS_BASE = join(homedir(), 'paloma/projects')
const SLUG_RE = /^[a-z0-9_-]+$/i

// ── Helpers ──────────────────────────────────────────────

function filesDir(slug) {
  return join(PROJECTS_BASE, slug, 'files')
}

function indexPath(slug) {
  return join(filesDir(slug), '.index.json')
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'projectSlug is required'
  if (!SLUG_RE.test(slug)) return `Invalid projectSlug: "${slug}" — must match /^[a-z0-9_-]+$/i`
  return null
}

function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'filename is required'
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return `Invalid filename: "${filename}" — must not contain path separators or ".."`
  }
  return null
}

async function readIndex(slug) {
  try {
    const raw = await readFile(indexPath(slug), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeIndex(slug, entries) {
  const dir = filesDir(slug)
  await mkdir(dir, { recursive: true })
  const target = indexPath(slug)
  const tmp = target + '.tmp'
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8')
  await rename(tmp, target)
}

function collisionName(filename) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const stamp = `${hh}${mm}${ss}`
  const ext = extname(filename)
  const base = ext ? filename.slice(0, -ext.length) : filename
  return `${base}-${stamp}${ext}`
}

// ── Tool Handlers ────────────────────────────────────────

async function handleList({ projectSlug }) {
  try {
    const err = validateSlug(projectSlug)
    if (err) return { content: [{ type: 'text', text: JSON.stringify({ error: err }) }], isError: true }

    const entries = await readIndex(projectSlug)
    return { content: [{ type: 'text', text: JSON.stringify({ files: entries }) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true }
  }
}

async function handleUpload({ projectSlug, filename, content, encoding, mimeType, uploadedBy }) {
  try {
    const slugErr = validateSlug(projectSlug)
    if (slugErr) return { content: [{ type: 'text', text: JSON.stringify({ error: slugErr }) }], isError: true }

    const nameErr = validateFilename(filename)
    if (nameErr) return { content: [{ type: 'text', text: JSON.stringify({ error: nameErr }) }], isError: true }

    if (!content || typeof content !== 'string') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'content is required' }) }], isError: true }
    }

    if (encoding !== 'base64' && encoding !== 'utf8') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'encoding must be "base64" or "utf8"' }) }], isError: true }
    }

    const dir = filesDir(projectSlug)
    await mkdir(dir, { recursive: true })

    // Read existing index and check for collision
    const entries = await readIndex(projectSlug)
    let finalName = filename
    if (entries.some(e => e.filename === filename)) {
      finalName = collisionName(filename)
    }

    // Write the file
    const filePath = join(dir, finalName)
    const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    await writeFile(filePath, buf)

    // Update index
    entries.push({
      filename: finalName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy || 'unknown',
      size: buf.length,
      mimeType: mimeType || 'application/octet-stream'
    })
    await writeIndex(projectSlug, entries)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, filename: finalName, size: buf.length, path: filePath })
      }]
    }
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true }
  }
}

async function handleDelete({ projectSlug, filename }) {
  try {
    const slugErr = validateSlug(projectSlug)
    if (slugErr) return { content: [{ type: 'text', text: JSON.stringify({ error: slugErr }) }], isError: true }

    const nameErr = validateFilename(filename)
    if (nameErr) return { content: [{ type: 'text', text: JSON.stringify({ error: nameErr }) }], isError: true }

    const filePath = join(filesDir(projectSlug), filename)

    // Verify file exists
    try {
      await stat(filePath)
    } catch {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `File not found: ${filename}` }) }], isError: true }
    }

    await unlink(filePath)

    // Update index
    const entries = await readIndex(projectSlug)
    const updated = entries.filter(e => e.filename !== filename)
    await writeIndex(projectSlug, updated)

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, filename }) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true }
  }
}

async function handleSearch({ projectSlug, query }) {
  try {
    const slugErr = validateSlug(projectSlug)
    if (slugErr) return { content: [{ type: 'text', text: JSON.stringify({ error: slugErr }) }], isError: true }

    if (!query || typeof query !== 'string') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }], isError: true }
    }

    const entries = await readIndex(projectSlug)
    const q = query.toLowerCase()
    const matches = entries.filter(e => e.filename.toLowerCase().includes(q))

    return { content: [{ type: 'text', text: JSON.stringify({ files: matches }) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true }
  }
}

// ── MCP Server ───────────────────────────────────────────

const server = new Server(
  { name: 'files', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'files_list',
      description: 'List all files for a project. Returns metadata from .index.json sidecar.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: {
            type: 'string',
            description: 'Project slug (last segment of project path, e.g. "fadden-demo")'
          }
        },
        required: ['projectSlug']
      }
    },
    {
      name: 'files_upload',
      description: 'Upload a file to a project. Content can be base64-encoded binary or UTF-8 text. On filename collision, appends a timestamp suffix.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: {
            type: 'string',
            description: 'Project slug (e.g. "fadden-demo")'
          },
          filename: {
            type: 'string',
            description: 'Target filename. Use naming convention: type-descriptor-date.ext (e.g. "contract-sow-march2026.pdf")'
          },
          content: {
            type: 'string',
            description: 'File content — base64-encoded binary or UTF-8 text'
          },
          encoding: {
            type: 'string',
            enum: ['base64', 'utf8'],
            description: 'Content encoding: "base64" for binary files, "utf8" for text files'
          },
          mimeType: {
            type: 'string',
            description: 'MIME type (e.g. "application/pdf", "image/png"). Defaults to "application/octet-stream"'
          },
          uploadedBy: {
            type: 'string',
            description: 'Who uploaded: "paloma", "kelsey", "adam", etc. Defaults to "unknown"'
          }
        },
        required: ['projectSlug', 'filename', 'content', 'encoding']
      }
    },
    {
      name: 'files_delete',
      description: 'Delete a file from a project. Removes the file and its .index.json entry.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: {
            type: 'string',
            description: 'Project slug (e.g. "fadden-demo")'
          },
          filename: {
            type: 'string',
            description: 'Exact filename to delete'
          }
        },
        required: ['projectSlug', 'filename']
      }
    },
    {
      name: 'files_search',
      description: 'Search files by filename substring. Case-insensitive match against .index.json entries.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: {
            type: 'string',
            description: 'Project slug (e.g. "fadden-demo")'
          },
          query: {
            type: 'string',
            description: 'Search query — matches against filename (case-insensitive substring match)'
          }
        },
        required: ['projectSlug', 'query']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'files_list') return handleList(args)
  if (name === 'files_upload') return handleUpload(args)
  if (name === 'files_delete') return handleDelete(args)
  if (name === 'files_search') return handleSearch(args)

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
