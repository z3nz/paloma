import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from './logger.js'

const log = createLogger('config')

const CONFIG_PATH = join(homedir(), '.paloma', 'mcp-settings.json')

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    return config.servers || {}
  } catch (e) {
    if (e.code === 'ENOENT') {
      log.info(`No MCP config found at ${CONFIG_PATH}`)
      return {}
    }
    log.error(`Error reading MCP config: ${e.message}`)
    return {}
  }
}
