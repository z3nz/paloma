#!/usr/bin/env node

// MCP server that provides web fetching capabilities.
// Exposes two tools:
//   - web_fetch: fetch a URL and return text content (HTML, JSON, etc.)
//   - web_download: download a file to a local path (binary-safe)

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const server = new Server(
  { name: 'web', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'web_fetch',
      description: 'Fetch a URL and return its text content (HTML, JSON, plain text, etc.). Useful for reading web pages, APIs, or any text-based resource.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch'
          },
          headers: {
            type: 'object',
            description: 'Optional HTTP headers to send with the request',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['url']
      }
    },
    {
      name: 'web_download',
      description: 'Download a file from a URL and save it to a local path. Binary-safe — works for images, PDFs, archives, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to download from'
          },
          path: {
            type: 'string',
            description: 'Local file path to save the downloaded file to (absolute path)'
          },
          headers: {
            type: 'object',
            description: 'Optional HTTP headers to send with the request',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['url', 'path']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'web_fetch') {
    return handleWebFetch(args)
  } else if (name === 'web_download') {
    return handleWebDownload(args)
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  }
})

async function handleWebFetch({ url, headers = {} }) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Paloma/1.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    })

    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()

    // Truncate very large responses to avoid overwhelming context
    const maxLength = 100000
    const truncated = text.length > maxLength
    const content = truncated ? text.slice(0, maxLength) + '\n\n[... truncated]' : text

    return {
      content: [{
        type: 'text',
        text: `HTTP ${response.status} ${response.statusText}\nContent-Type: ${contentType}\nLength: ${text.length} chars${truncated ? ' (truncated)' : ''}\n\n${content}`
      }]
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Fetch error: ${e.message}` }],
      isError: true
    }
  }
}

async function handleWebDownload({ url, path, headers = {} }) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Paloma/1.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    })

    if (!response.ok) {
      return {
        content: [{ type: 'text', text: `Download failed: HTTP ${response.status} ${response.statusText}` }],
        isError: true
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Ensure parent directory exists
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buffer)

    const contentType = response.headers.get('content-type') || 'unknown'
    return {
      content: [{
        type: 'text',
        text: `Downloaded ${buffer.length} bytes to ${path}\nContent-Type: ${contentType}`
      }]
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Download error: ${e.message}` }],
      isError: true
    }
  }
}

// Start server on stdio
const transport = new StdioServerTransport()
await server.connect(transport)
