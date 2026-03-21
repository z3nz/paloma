/**
 * Memory MCP Server — Persistent semantic memory with vector embeddings
 *
 * Storage backends:
 *   - Local JSON (default) — works immediately, no external services
 *   - MongoDB (when MONGODB_URI is set) — production-grade with Atlas Vector Search
 *
 * Embeddings: Ollama nomic-embed-text (1024-dim vectors)
 * Fallback: keyword search when Ollama is unavailable
 * Location: ~/.paloma/memory/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

// ─── Config ──────────────────────────────────────────────────────────────────

const MEMORY_DIR = resolve(homedir(), '.paloma', 'memory')
const MONGODB_URI = process.env.MONGODB_URI || null
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const EMBEDDING_MODEL = 'nomic-embed-text'
const EMBEDDING_DIM = 1024

// ─── Embedding Engine (Ollama) ───────────────────────────────────────────────

let embeddingReady = false

async function initEmbeddings () {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`)
    if (response.ok) {
      embeddingReady = true
      console.error('[memory] Ollama available for embeddings, model:', EMBEDDING_MODEL)
    }
  } catch {
    console.error('[memory] Ollama not reachable — falling back to keyword search')
    embeddingReady = false
  }
}

async function embed (text) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text })
    })
    if (!response.ok) {
      console.error('[memory] Ollama embed failed:', response.status)
      return null
    }
    const data = await response.json()
    const embedding = data.embeddings?.[0]
    if (embedding) {
      embeddingReady = true
      return embedding
    }
    return null
  } catch (err) {
    console.error('[memory] Ollama embed error:', err.message)
    embeddingReady = false
    return null
  }
}

function cosineSimilarity (a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0; let normA = 0; let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ─── Keyword Fallback Search ─────────────────────────────────────────────────

function keywordScore (query, content) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean)
  const contentLower = content.toLowerCase()
  let matches = 0
  for (const word of queryWords) {
    if (contentLower.includes(word)) matches++
  }
  return queryWords.length > 0 ? matches / queryWords.length : 0
}

// ─── Storage Interface ───────────────────────────────────────────────────────

class LocalStore {
  constructor (collection = 'default') {
    this.collection = collection
    this.filePath = join(MEMORY_DIR, `${collection}.json`)
    this.data = null
  }

  async load () {
    if (this.data) return
    await mkdir(MEMORY_DIR, { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      this.data = JSON.parse(raw)
    } catch {
      this.data = {
        memories: [],
        metadata: {
          created: new Date().toISOString(),
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIM,
          collection: this.collection
        }
      }
    }
  }

  async save () {
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  async store (memory) {
    await this.load()
    this.data.memories.push(memory)
    await this.save()
    return memory.id
  }

  async search (queryEmbedding, query, { limit = 5, tags = null, threshold = 0.3 } = {}) {
    await this.load()
    let candidates = this.data.memories

    // Filter by tags if provided
    if (tags && tags.length > 0) {
      candidates = candidates.filter(m =>
        m.tags && tags.some(t => m.tags.includes(t))
      )
    }

    // Score by embedding similarity or keyword fallback
    const scored = candidates.map(m => {
      const similarity = queryEmbedding
        ? cosineSimilarity(queryEmbedding, m.embedding)
        : keywordScore(query, m.content + ' ' + (m.context || '') + ' ' + (m.tags || []).join(' '))
      return { ...m, similarity }
    })

    // Filter by threshold, sort by similarity, limit results
    return scored
      .filter(m => m.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(({ embedding, ...rest }) => rest) // Strip embeddings from results
  }

  async list ({ limit = 20, tags = null, offset = 0 } = {}) {
    await this.load()
    let candidates = this.data.memories

    if (tags && tags.length > 0) {
      candidates = candidates.filter(m =>
        m.tags && tags.some(t => m.tags.includes(t))
      )
    }

    return candidates
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .slice(offset, offset + limit)
      .map(({ embedding, ...rest }) => rest)
  }

  async get (id) {
    await this.load()
    const memory = this.data.memories.find(m => m.id === id)
    if (!memory) return null
    const { embedding, ...rest } = memory
    return rest
  }

  async update (id, updates) {
    await this.load()
    const idx = this.data.memories.findIndex(m => m.id === id)
    if (idx === -1) return null
    this.data.memories[idx] = {
      ...this.data.memories[idx],
      ...updates,
      updated: new Date().toISOString()
    }
    await this.save()
    const { embedding, ...rest } = this.data.memories[idx]
    return rest
  }

  async forget (id) {
    await this.load()
    const idx = this.data.memories.findIndex(m => m.id === id)
    if (idx === -1) return false
    this.data.memories.splice(idx, 1)
    await this.save()
    return true
  }

  async stats () {
    await this.load()
    const memories = this.data.memories
    const tagCounts = {}
    for (const m of memories) {
      for (const t of (m.tags || [])) {
        tagCounts[t] = (tagCounts[t] || 0) + 1
      }
    }
    return {
      total: memories.length,
      collection: this.collection,
      backend: 'local',
      embeddingsEnabled: embeddingReady,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      tags: tagCounts,
      oldest: memories.length > 0
        ? memories.reduce((a, b) => new Date(a.created) < new Date(b.created) ? a : b).created
        : null,
      newest: memories.length > 0
        ? memories.reduce((a, b) => new Date(a.created) > new Date(b.created) ? a : b).created
        : null
    }
  }
}

// ─── MongoDB Store ───────────────────────────────────────────────────────────

class MongoStore {
  constructor (collection = 'default') {
    this.collectionName = collection
    this.client = null
    this.collection = null
  }

  async connect () {
    if (this.client) return
    const { MongoClient } = await import('mongodb')
    this.client = new MongoClient(MONGODB_URI)
    await this.client.connect()
    const db = this.client.db('paloma_memory')
    this.collection = db.collection(this.collectionName)

    // Create indexes
    await this.collection.createIndex({ id: 1 }, { unique: true })
    await this.collection.createIndex({ tags: 1 })
    await this.collection.createIndex({ created: -1 })
    console.error('[memory] Connected to MongoDB:', this.collectionName)
  }

  async store (memory) {
    await this.connect()
    await this.collection.insertOne(memory)
    return memory.id
  }

  async search (queryEmbedding, query, { limit = 5, tags = null, threshold = 0.3 } = {}) {
    await this.connect()

    // Try Atlas Vector Search if embedding available
    if (queryEmbedding) {
      try {
        const pipeline = [
          {
            $vectorSearch: {
              index: 'embedding_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit
            }
          },
          { $addFields: { similarity: { $meta: 'vectorSearchScore' } } },
          { $match: { similarity: { $gte: threshold } } },
          { $project: { embedding: 0, _id: 0 } }
        ]
        if (tags && tags.length > 0) {
          pipeline.splice(1, 0, { $match: { tags: { $in: tags } } })
        }
        return await this.collection.aggregate(pipeline).toArray()
      } catch {
        // Vector search index not configured, fall through to in-memory
        console.error('[memory] Atlas Vector Search not available, using in-memory fallback')
      }
    }

    // Fallback: fetch all and score in-memory
    const filter = tags && tags.length > 0 ? { tags: { $in: tags } } : {}
    const all = await this.collection.find(filter).toArray()
    const scored = all.map(m => {
      const similarity = queryEmbedding
        ? cosineSimilarity(queryEmbedding, m.embedding)
        : keywordScore(query, m.content + ' ' + (m.context || '') + ' ' + (m.tags || []).join(' '))
      return { ...m, similarity }
    })

    return scored
      .filter(m => m.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(({ embedding, _id, ...rest }) => rest)
  }

  async list ({ limit = 20, tags = null, offset = 0 } = {}) {
    await this.connect()
    const filter = tags && tags.length > 0 ? { tags: { $in: tags } } : {}
    return await this.collection
      .find(filter)
      .project({ embedding: 0, _id: 0 })
      .sort({ created: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()
  }

  async get (id) {
    await this.connect()
    return await this.collection.findOne({ id }, { projection: { embedding: 0, _id: 0 } })
  }

  async update (id, updates) {
    await this.connect()
    const result = await this.collection.findOneAndUpdate(
      { id },
      { $set: { ...updates, updated: new Date().toISOString() } },
      { returnDocument: 'after', projection: { embedding: 0, _id: 0 } }
    )
    return result || null
  }

  async forget (id) {
    await this.connect()
    const result = await this.collection.deleteOne({ id })
    return result.deletedCount > 0
  }

  async stats () {
    await this.connect()
    const total = await this.collection.countDocuments()
    const tagAgg = await this.collection.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } }
    ]).toArray()
    const tagCounts = Object.fromEntries(tagAgg.map(t => [t._id, t.count]))
    const oldest = await this.collection.findOne({}, { sort: { created: 1 }, projection: { created: 1 } })
    const newest = await this.collection.findOne({}, { sort: { created: -1 }, projection: { created: 1 } })
    return {
      total,
      collection: this.collectionName,
      backend: 'mongodb',
      embeddingsEnabled: embeddingReady,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      tags: tagCounts,
      oldest: oldest?.created || null,
      newest: newest?.created || null
    }
  }
}

// ─── Store Factory ───────────────────────────────────────────────────────────

const stores = new Map()

function getStore (collection = 'default') {
  if (!stores.has(collection)) {
    const store = MONGODB_URI ? new MongoStore(collection) : new LocalStore(collection)
    stores.set(collection, store)
  }
  return stores.get(collection)
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'memory', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_store',
      description: 'Store a memory with semantic embedding for later recall. Use this to remember facts, decisions, preferences, conversations, patterns, or anything worth persisting across sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The memory content to store. Be descriptive — this is what gets embedded and searched.'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and filtering (e.g., ["aws", "architecture", "mackay"])'
          },
          context: {
            type: 'string',
            description: 'Additional context about when/why this memory was created'
          },
          source: {
            type: 'string',
            description: 'Where this memory came from (e.g., "conversation", "code", "research", "decision")'
          },
          collection: {
            type: 'string',
            description: 'Memory collection name (default: "default"). Use to separate memory spaces.'
          }
        },
        required: ['content']
      }
    },
    {
      name: 'memory_recall',
      description: 'Semantically search memories using natural language. Returns the most relevant memories ranked by similarity to your query. This is the primary way to retrieve knowledge.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query — describe what you want to remember'
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 5)'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter results to only memories with these tags'
          },
          threshold: {
            type: 'number',
            description: 'Minimum similarity score 0-1 (default: 0.3). Lower = more results, higher = more relevant.'
          },
          collection: {
            type: 'string',
            description: 'Memory collection to search (default: "default")'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'memory_list',
      description: 'List recent memories, optionally filtered by tags. Returns memories in reverse chronological order.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max memories to return (default: 20)' },
          offset: { type: 'number', description: 'Skip this many memories (for pagination)' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags'
          },
          collection: { type: 'string', description: 'Memory collection (default: "default")' }
        }
      }
    },
    {
      name: 'memory_forget',
      description: 'Delete a specific memory by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to delete' },
          collection: { type: 'string', description: 'Memory collection (default: "default")' }
        },
        required: ['id']
      }
    },
    {
      name: 'memory_update',
      description: 'Update an existing memory. Can update content (re-embeds), tags, context, or source.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to update' },
          content: { type: 'string', description: 'New content (will re-embed)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
          context: { type: 'string', description: 'New context' },
          source: { type: 'string', description: 'New source' },
          collection: { type: 'string', description: 'Memory collection (default: "default")' }
        },
        required: ['id']
      }
    },
    {
      name: 'memory_stats',
      description: 'Get statistics about the memory store — total memories, tag distribution, backend info, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Memory collection (default: "default")' }
        }
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'memory_store': {
        const store = getStore(args.collection)
        const embedding = await embed(args.content)
        const memory = {
          id: randomUUID(),
          content: args.content,
          embedding,
          tags: args.tags || [],
          context: args.context || null,
          source: args.source || null,
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        }
        const id = await store.store(memory)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              stored: true,
              id,
              embeddingGenerated: !!embedding,
              tags: memory.tags,
              collection: args.collection || 'default'
            }, null, 2)
          }]
        }
      }

      case 'memory_recall': {
        const store = getStore(args.collection)
        const queryEmbedding = await embed(args.query)
        const results = await store.search(queryEmbedding, args.query, {
          limit: Math.min(args.limit || 5, 100),
          tags: args.tags || null,
          threshold: args.threshold ?? 0.3
        })
        return {
          content: [{
            type: 'text',
            text: results.length > 0
              ? JSON.stringify({
                  query: args.query,
                  count: results.length,
                  embeddingSearch: !!queryEmbedding,
                  results
                }, null, 2)
              : JSON.stringify({
                  query: args.query,
                  count: 0,
                  embeddingSearch: !!queryEmbedding,
                  message: 'No memories found matching your query.'
                }, null, 2)
          }]
        }
      }

      case 'memory_list': {
        const store = getStore(args.collection)
        const results = await store.list({
          limit: args.limit || 20,
          tags: args.tags || null,
          offset: args.offset || 0
        })
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: results.length,
              collection: args.collection || 'default',
              memories: results
            }, null, 2)
          }]
        }
      }

      case 'memory_forget': {
        const store = getStore(args.collection)
        const deleted = await store.forget(args.id)
        return {
          content: [{
            type: 'text',
            text: deleted
              ? `Memory ${args.id} deleted.`
              : `Memory ${args.id} not found.`
          }],
          isError: !deleted
        }
      }

      case 'memory_update': {
        const store = getStore(args.collection)
        const updates = {}
        if (args.content) {
          updates.content = args.content
          updates.embedding = await embed(args.content)
        }
        if (args.tags) updates.tags = args.tags
        if (args.context !== undefined) updates.context = args.context
        if (args.source !== undefined) updates.source = args.source

        const result = await store.update(args.id, updates)
        if (!result) {
          return {
            content: [{ type: 'text', text: `Memory ${args.id} not found.` }],
            isError: true
          }
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ updated: true, memory: result }, null, 2)
          }]
        }
      }

      case 'memory_stats': {
        const store = getStore(args.collection)
        const stats = await store.stats()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(stats, null, 2)
          }]
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        }
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    }
  }
})

// ─── Start ───────────────────────────────────────────────────────────────────

async function main () {
  console.error('[memory] Starting Memory MCP Server...')
  console.error('[memory] Storage:', MONGODB_URI ? 'MongoDB' : `Local (${MEMORY_DIR})`)
  // Check Ollama availability in background — server is usable immediately with keyword fallback
  initEmbeddings()

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[memory] Memory MCP Server running')
}

main().catch(err => {
  console.error('[memory] Fatal:', err)
  process.exit(1)
})
