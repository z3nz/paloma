import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export class McpManager {
  constructor() {
    this.clients = new Map() // serverName -> { client, transport, tools, status }
  }

  async startAll(servers) {
    const entries = Object.entries(servers)
    if (entries.length === 0) {
      console.log('No MCP servers configured')
      return
    }

    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.startServer(name, config))
    )

    for (let i = 0; i < entries.length; i++) {
      const [name] = entries[i]
      if (results[i].status === 'rejected') {
        console.error(`Failed to start ${name}:`, results[i].reason?.message)
        this.clients.set(name, { client: null, transport: null, tools: [], status: 'error', error: results[i].reason?.message })
      }
    }
  }

  async startServer(name, config) {
    console.log(`Starting MCP server: ${name} (${config.command} ${(config.args || []).join(' ')})`)

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) }
    })

    const client = new Client({ name: `paloma-${name}`, version: '1.0.0' })
    await client.connect(transport)

    const { tools } = await client.listTools()
    console.log(`  ${name}: ${tools.length} tools discovered`)

    this.clients.set(name, { client, transport, tools, status: 'connected' })
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

  async callTool(serverName, toolName, args) {
    const entry = this.clients.get(serverName)
    if (!entry) throw new Error(`Unknown server: ${serverName}`)
    if (entry.status !== 'connected') throw new Error(`Server ${serverName} is not connected (status: ${entry.status})`)

    const result = await entry.client.callTool({ name: toolName, arguments: args })
    return result
  }

  async shutdown() {
    for (const [name, entry] of this.clients) {
      try {
        if (entry.client) {
          await entry.transport.close()
        }
        console.log(`Shut down: ${name}`)
      } catch (e) {
        console.error(`Error shutting down ${name}:`, e.message)
      }
    }
    this.clients.clear()
  }
}
