#!/usr/bin/env node

// MCP server that exposes Ollama's API as MCP tools.
// Tools: ollama_chat, ollama_generate, ollama_embed, ollama_list_models, ollama_pull_model

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

const BASE_URL = process.env.OLLAMA_HOST || 'http://localhost:11434'

const server = new Server(
  { name: 'ollama', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

async function ollamaFetch(path, options = {}) {
  try {
    const url = `${BASE_URL}${path}`
    const response = await fetch(url, options)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Ollama API error ${response.status}: ${body || response.statusText}`)
    }
    return response
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
      throw new Error('Ollama not reachable. Is it running? Try: ollama serve')
    }
    throw err
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ollama_chat',
      description: 'Chat with a local Ollama model. Single-turn (non-streaming). Good for quick questions, code review, or getting a second opinion from a local model.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Ollama model name (e.g., qwen2.5-coder:32b, llama3.3:70b)' },
          prompt: { type: 'string', description: 'The user message to send' },
          system: { type: 'string', description: 'Optional system prompt' },
          num_ctx: { type: 'number', description: 'Context window size (default: 32768). Ollama defaults to 2048 if not set!', default: 32768 }
        },
        required: ['model', 'prompt']
      }
    },
    {
      name: 'ollama_generate',
      description: 'Raw text completion from a local Ollama model. No chat format, just prompt → completion.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Ollama model name' },
          prompt: { type: 'string', description: 'The prompt text' },
          num_ctx: { type: 'number', description: 'Context window size (default: 8192)', default: 8192 }
        },
        required: ['model', 'prompt']
      }
    },
    {
      name: 'ollama_embed',
      description: 'Generate embeddings using a local Ollama model. Returns a vector array.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Embedding model (default: nomic-embed-text)', default: 'nomic-embed-text' },
          input: { type: 'string', description: 'Text to embed' }
        },
        required: ['input']
      }
    },
    {
      name: 'ollama_list_models',
      description: 'List all locally installed Ollama models with sizes and modification dates.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'ollama_pull_model',
      description: 'Download/pull an Ollama model. This may take a while for large models.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model to pull (e.g., qwen2.5-coder:32b)' }
        },
        required: ['model']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'ollama_chat': return await handleChat(args)
      case 'ollama_generate': return await handleGenerate(args)
      case 'ollama_embed': return await handleEmbed(args)
      case 'ollama_list_models': return await handleListModels()
      case 'ollama_pull_model': return await handlePullModel(args)
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (err) {
    return { content: [{ type: 'text', text: err.message }], isError: true }
  }
})

async function handleChat({ model, prompt, system, num_ctx = 32768 }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const response = await ollamaFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { num_ctx } })
  })

  const data = await response.json()
  return {
    content: [{ type: 'text', text: data.message?.content || '(empty response)' }]
  }
}

async function handleGenerate({ model, prompt, num_ctx = 8192 }) {
  const response = await ollamaFetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_ctx } })
  })

  const data = await response.json()
  return {
    content: [{ type: 'text', text: data.response || '(empty response)' }]
  }
}

async function handleEmbed({ model = 'nomic-embed-text', input }) {
  const response = await ollamaFetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input })
  })

  const data = await response.json()
  const embedding = data.embeddings?.[0]
  if (!embedding) {
    return { content: [{ type: 'text', text: 'No embedding returned' }], isError: true }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ dimensions: embedding.length, embedding }) }]
  }
}

async function handleListModels() {
  const response = await ollamaFetch('/api/tags')
  const data = await response.json()

  if (!data.models?.length) {
    return { content: [{ type: 'text', text: 'No models installed. Pull one with ollama_pull_model.' }] }
  }

  const lines = data.models.map(m => {
    const sizeGB = (m.size / 1e9).toFixed(1)
    const modified = new Date(m.modified_at).toLocaleDateString()
    return `${m.name} (${sizeGB}GB, modified ${modified})`
  })

  return {
    content: [{ type: 'text', text: `Installed models:\n${lines.join('\n')}` }]
  }
}

async function handlePullModel({ model }) {
  const response = await ollamaFetch('/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false })
  })

  const data = await response.json()
  return {
    content: [{ type: 'text', text: data.status === 'success' ? `Model ${model} pulled successfully.` : `Pull result: ${JSON.stringify(data)}` }]
  }
}

// Start server on stdio
const transport = new StdioServerTransport()
await server.connect(transport)
