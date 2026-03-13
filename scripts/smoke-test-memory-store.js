import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const collection = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`
const content = `Paloma memory smoke test ${new Date().toISOString()} ${randomUUID()}`
const query = 'Paloma memory smoke test'

function parseTextResult(result) {
  const text = result?.content?.map(item => item.text || '').join('\n') || ''
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: null }
  }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  return parseTextResult(result)
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['mcp-servers/memory.js']
  })
  const client = new Client({ name: 'memory-smoke-test', version: '1.0.0' })

  let createdId = null

  try {
    await client.connect(transport)

    const stored = await callTool(client, 'memory_store', {
      collection,
      content,
      tags: ['smoke-test', 'automated'],
      context: 'Automated end-to-end smoke test',
      source: 'scripts/smoke-test-memory-store.js'
    })

    createdId = stored.json?.id || null
    if (!stored.json?.stored || !createdId) {
      throw new Error(`memory_store failed: ${stored.text}`)
    }

    const recalled = await callTool(client, 'memory_recall', {
      collection,
      query,
      limit: 5,
      threshold: 0
    })

    const recalledIds = (recalled.json?.results || []).map(entry => entry.id)
    if (!recalledIds.includes(createdId)) {
      throw new Error(`memory_recall did not return stored memory: ${recalled.text}`)
    }

    const statsBeforeDelete = await callTool(client, 'memory_stats', { collection })
    const totalBeforeDelete = statsBeforeDelete.json?.total ?? null
    if (totalBeforeDelete !== 1) {
      throw new Error(`memory_stats expected total=1 before delete, got: ${statsBeforeDelete.text}`)
    }

    const forgotten = await callTool(client, 'memory_forget', { collection, id: createdId })
    if (!/deleted/i.test(forgotten.text)) {
      throw new Error(`memory_forget did not confirm deletion: ${forgotten.text}`)
    }

    createdId = null

    const statsAfterDelete = await callTool(client, 'memory_stats', { collection })
    const totalAfterDelete = statsAfterDelete.json?.total ?? null
    if (totalAfterDelete !== 0) {
      throw new Error(`memory_stats expected total=0 after delete, got: ${statsAfterDelete.text}`)
    }

    console.log(JSON.stringify({
      ok: true,
      collection,
      embeddingSearch: recalled.json?.embeddingSearch ?? false,
      backend: statsBeforeDelete.json?.backend || 'unknown',
      storedId: stored.json.id,
      totalBeforeDelete,
      totalAfterDelete
    }, null, 2))
  } finally {
    if (createdId) {
      try {
        await client.callTool({ name: 'memory_forget', arguments: { collection, id: createdId } })
      } catch {}
    }
    try {
      await transport.close()
    } catch {}
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, collection, error: error.message }, null, 2))
  process.exit(1)
})