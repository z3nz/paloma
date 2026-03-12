#!/usr/bin/env node

// MCP server that provides text-to-speech via Kokoro TTS.
// Exposes one tool:
//   - speak: speak text aloud using JARVIS-like British male voice
//
// Internally spawns the Python voice-speak.py script using the kokoro_env
// virtual environment. Audio plays through the platform's native audio backend.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const PYTHON = resolve(PROJECT_ROOT, 'kokoro_env', 'bin', 'python')
const SCRIPT = resolve(__dirname, 'voice-speak.py')

const server = new Server(
  { name: 'voice', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'speak',
      description:
        'Speak text aloud using Kokoro TTS with a JARVIS-like British male voice. ' +
        'The text is automatically stripped of markdown formatting before speech. ' +
        'Keep messages short (1-3 sentences) for best results. ' +
        'Use this at the end of tasks, when asking questions, or for status updates.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to speak aloud. Will be stripped of markdown. Keep it short and conversational.'
          },
          voice: {
            type: 'string',
            description: 'Kokoro voice name (default: bm_george). Options: bm_george, bm_fable, bm_daniel, bm_lewis',
            default: 'bm_george'
          },
          speed: {
            type: 'number',
            description: 'Speech speed multiplier (default: 1.0). Range: 0.5-2.0',
            default: 1.0
          }
        },
        required: ['text']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'speak') return handleSpeak(args)

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  }
})

async function handleSpeak({ text, voice = 'bm_george', speed = 1.0 }) {
  if (!text || !text.trim()) {
    return {
      content: [{ type: 'text', text: 'Nothing to speak — empty text provided.' }],
      isError: false
    }
  }

  try {
    const result = await runTTS(text, voice, speed)
    return {
      content: [{
        type: 'text',
        text: result.success
          ? `Spoken: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`
          : `Speech failed: ${result.error}`
      }],
      isError: !result.success
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Speech error: ${e.message}` }],
      isError: true
    }
  }
}

function runTTS(text, voice, speed) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [
      SCRIPT,
      '--voice', voice,
      '--speed', String(speed),
      '--lang', voice.startsWith('a') ? 'a' : 'b'
    ], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000
    })

    let stderr = ''
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.stdin.write(text)
    proc.stdin.end()

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: stderr.trim() || `Exit code ${code}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

// Start server on stdio
const transport = new StdioServerTransport()
await server.connect(transport)
