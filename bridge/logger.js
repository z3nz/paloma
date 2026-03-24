/**
 * Lightweight structured logger for bridge modules.
 * Wraps console with level, ISO timestamp, and component tag.
 *
 * Usage:
 *   import { createLogger } from './logger.js'
 *   const log = createLogger('pillar')
 *   log.info('Session spawned', { pillarId, backend })
 *   log.warn('Timeout approaching', { remaining: 5000 })
 *   log.error('Spawn failed', { error: err.message })
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

// Global minimum level — set via LOG_LEVEL env var (default: info)
const globalLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info

function formatArgs(msg, data) {
  if (data === undefined) return msg
  if (typeof data === 'string') return `${msg} ${data}`
  try {
    return `${msg} ${JSON.stringify(data)}`
  } catch {
    return `${msg} [unserializable]`
  }
}

export function createLogger(component) {
  const tag = `[${component}]`

  return {
    debug(msg, data) {
      if (globalLevel > LEVELS.debug) return
      console.debug(`${new Date().toISOString()} DEBUG ${tag} ${formatArgs(msg, data)}`)
    },

    info(msg, data) {
      if (globalLevel > LEVELS.info) return
      console.log(`${new Date().toISOString()} INFO  ${tag} ${formatArgs(msg, data)}`)
    },

    warn(msg, data) {
      if (globalLevel > LEVELS.warn) return
      console.warn(`${new Date().toISOString()} WARN  ${tag} ${formatArgs(msg, data)}`)
    },

    error(msg, data) {
      // errors always log
      console.error(`${new Date().toISOString()} ERROR ${tag} ${formatArgs(msg, data)}`)
    }
  }
}
