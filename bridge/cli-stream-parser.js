/**
 * Shared JSONL stream parser for CLI subprocess stdout.
 *
 * All 4 CLI managers (claude, codex, copilot, gemini) use the same pattern:
 * accumulate stdout chunks into a buffer, split on newlines, parse each
 * complete line as JSON, and dispatch to a callback. This module extracts
 * that pattern into a reusable utility.
 *
 * Usage:
 *   import { attachStreamParser } from './cli-stream-parser.js'
 *   const flush = attachStreamParser(proc.stdout, (event) => {
 *     // handle parsed JSON event
 *   })
 *   proc.on('close', () => { flush() })  // flush remaining buffer
 */

/**
 * Attach a JSONL stream parser to a readable stream (typically proc.stdout).
 *
 * @param {import('stream').Readable} stream - The readable stream to parse
 * @param {(event: object) => void} onEvent - Called for each successfully parsed JSON object
 * @returns {() => object|null} flush - Call on process close to parse any remaining buffered data.
 *                                      Returns the parsed event or null if nothing/unparseable.
 */
export function attachStreamParser(stream, onEvent) {
  let buffer = ''

  stream.on('data', (data) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed)
        onEvent(event)
      } catch {
        // skip non-JSON lines (progress bars, warnings, etc.)
      }
    }
  })

  // Return a flush function for the close handler
  return function flush() {
    const remaining = buffer.trim()
    buffer = ''
    if (!remaining) return null
    try {
      const event = JSON.parse(remaining)
      onEvent(event)
      return event
    } catch {
      return null
    }
  }
}

