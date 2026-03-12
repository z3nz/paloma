#!/usr/bin/env node

// MCP server that provides text-to-speech via Kokoro TTS.
// Paloma's dual-voice system: Mystique (af_bella) + JARVIS (bm_george).
// Exposes one tool:
//   - speak: speak text aloud using named voice aliases or raw Kokoro voice IDs
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

// Named voice aliases — semantic names for Paloma's dual-voice system
const VOICE_ALIASES = {
  mystique: 'af_bella',   // Paloma's true voice — warm, personal, authentic
  jarvis: 'bm_george'     // Professional persona — British butler, calm, competent
}

const server = new Server(
  { name: 'voice', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'speak',
      description:
        'Speak text aloud using Kokoro TTS. Paloma has two voices: ' +
        'Mystique (af_bella, American female — Paloma\'s true voice, warm and personal) and ' +
        'JARVIS (bm_george, British male — professional persona, calm and competent). ' +
        'Use "mystique" for greetings and openings, "jarvis" for task completions and status. ' +
        'Text is automatically stripped of markdown. Keep messages short (1-3 sentences).',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to speak aloud. Will be stripped of markdown. Keep it short and conversational.'
          },
          voice: {
            type: 'string',
            description:
              'Voice to use. Named aliases: "mystique" (af_bella), "jarvis" (bm_george). ' +
              'Or any Kokoro voice: af_bella, af_sarah, af_nicole, af_sky, bf_emma, bf_lily, ' +
              'bm_george, bm_fable, bm_daniel, bm_lewis, am_adam, am_michael. Default: bm_george',
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
  // Resolve named aliases (mystique → af_bella, jarvis → bm_george)
  const resolvedVoice = VOICE_ALIASES[voice] || voice

  if (!text || !text.trim()) {
    return {
      content: [{ type: 'text', text: 'Nothing to speak — empty text provided.' }],
      isError: false
    }
  }

  try {
    const result = await runTTS(text, resolvedVoice, speed)
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
    // Scale timeout: 30s base + ~2s per 100 chars — long text needs time
    const timeoutMs = 30_000 + Math.ceil(text.length / 100) * 2000

    const proc = spawn(PYTHON, [
      SCRIPT,
      '--voice', voice,
      '--speed', String(speed),
      '--lang', voice.startsWith('a') ? 'a' : 'b'
    ], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs
    })

    let stderr = ''
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.stderr.on('error', () => {
      // Non-fatal — stderr read error during TTS
    })

    proc.stdin.on('error', (err) => {
      resolve({ success: false, error: `stdin error: ${err.message}` })
    })
    proc.stdin.write(text)
    proc.stdin.end()

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        // Filter out known Python warnings — they aren't real errors
        const realErrors = stderr
          .split('\n')
          .filter(line => !line.includes('UserWarning:') &&
                         !line.includes('FutureWarning:') &&
                         !line.includes('super().__init__') &&
                         !line.includes('WeightNorm.apply') &&
                         !line.includes('weight_norm') &&
                         !line.includes('unauthenticated requests') &&
                         !line.includes('HF_TOKEN') &&
                         !line.trim().startsWith('warnings.filterwarnings'))
          .join('\n')
          .trim()
        resolve({ success: false, error: realErrors || `Exit code ${code}` })
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
