import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createLogger } from './logger.js'

const log = createLogger('persistence')

/**
 * Simple JSON persistence utility with debouncing.
 */
export class Persistence {
  constructor(filePath, { debounceMs = 2000 } = {}) {
    this.filePath = filePath
    this.debounceMs = debounceMs
    this._saveTimer = null
    this._pendingData = null
  }

  /**
   * Save data to disk with debouncing.
   * @param {Object} data 
   */
  async save(data) {
    this._pendingData = data
    if (this._saveTimer) return

    this._saveTimer = setTimeout(async () => {
      try {
        const json = JSON.stringify(this._pendingData, null, 2)
        await writeFile(this.filePath, json, 'utf8')
        // console.log(`[persistence] Saved state to ${this.filePath}`)
      } catch (err) {
        log.error(`Failed to save state to ${this.filePath}: ${err.message}`)
      } finally {
        this._saveTimer = null
      }
    }, this.debounceMs)
  }

  /**
   * Load data from disk.
   * @returns {Object|null}
   */
  async load() {
    if (!existsSync(this.filePath)) return null
    try {
      const json = await readFile(this.filePath, 'utf8')
      return JSON.parse(json)
    } catch (err) {
      log.error(`Failed to load state from ${this.filePath}: ${err.message}`)
      return null
    }
  }

  /**
   * Force immediate save.
   */
  async flush() {
    if (!this._pendingData) return
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    try {
      const json = JSON.stringify(this._pendingData, null, 2)
      await writeFile(this.filePath, json, 'utf8')
    } catch (err) {
      log.error(`Failed to flush state to ${this.filePath}: ${err.message}`)
    }
  }
}
