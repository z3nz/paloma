import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export class McpManager {
  constructor() {
    this.clients = new Map() // serverName -> { client, transport, tools, status }
  }

  async startAll(servers, onProgress) {
    const entries = Object.entries(servers)
    if (entries.length === 0) {
      return { serverCount: 0, toolCount: 0, failedCount: 0 }
    }

    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.startServer(name, config, onProgress))
    )

    let failedCount = 0
    for (let i = 0; i < entries.length; i++) {
      const [name] = entries[i]
      if (results[i].status === 'rejected') {
        failedCount++
        this.clients.set(name, { client: null, transport: null, tools: [], status: 'error', error: results[i].reason?.message })
        if (onProgress) onProgress(name, 'error', 0, results[i].reason?.message)
      }
    }

    const toolCount = [...this.clients.values()].reduce((sum, c) => sum + c.tools.length, 0)
    return { serverCount: entries.length, toolCount, failedCount }
  }

  async startServer(name, config, onProgress) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) }
    })

    const client = new Client({ name: `paloma-${name}`, version: '1.0.0' })
    try {
      await client.connect(transport)
    } catch (e) {
      try { await transport.close() } catch {}
      throw e
    }

    const { tools } = await client.listTools()
    this.clients.set(name, { client, transport, tools, status: 'connected' })

    if (onProgress) onProgress(name, 'ok', tools.length)
  }

  getTools() {
    const servers = {}
    for (const [name, entry] of this.clients) {
      servers[name] = {
        tools: entry.tools,
        status: entry.status,
        error: entry.error || null
      }
    }
    return servers
  }

  async callTool(serverName, toolName, args, { timeout = 5 * 60 * 1000 } = {}) {
    const entry = this.clients.get(serverName)
    if (!entry) throw new Error(`Unknown server: ${serverName}`)
    if (entry.status !== 'connected') throw new Error(`Server ${serverName} is not connected (status: ${entry.status})`)

    let timer
    try {
      const result = await Promise.race([
        entry.client.callTool({ name: toolName, arguments: args }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`MCP server ${serverName}.${toolName} timed out after ${Math.round(timeout / 1000)}s`)), timeout)
        })
      ])
      return result
    } finally {
      clearTimeout(timer)
    }
  }

  async shutdown() {
    for (const [, entry] of this.clients) {
      try {
        if (entry.client) await entry.transport.close()
      } catch { /* best-effort */ }
    }
    this.clients.clear()
  }
}
