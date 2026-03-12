#!/usr/bin/env node

// MCP server that provides shell command execution.
// Exposes one tool:
//   - bash_exec: execute a shell command and return stdout/stderr/exit code
//
// Safety: commands are restricted to execute within the home directory.
// The Paloma bridge permission system gates all tool calls before they reach here.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { access } from 'node:fs/promises'

const ALLOWED_ROOT = resolve(homedir())
const DEFAULT_TIMEOUT = 120_000  // 2 minutes
const MAX_TIMEOUT = 600_000      // 10 minutes
const MAX_OUTPUT = 100_000       // chars before truncation

function isAllowed(path) {
  const resolved = resolve(path)
  return resolved.startsWith(ALLOWED_ROOT)
}

const server = new Server(
  { name: 'exec', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'bash_exec',
      description:
        'Execute a shell command and return stdout, stderr, and exit code. ' +
        'Commands run within the home directory. Supports custom working directory, ' +
        'timeout, and environment variables.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute'
          },
          cwd: {
            type: 'string',
            description:
              'Working directory (absolute path, must be within home directory). Defaults to home.'
          },
          timeout: {
            type: 'number',
            description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`
          },
          env: {
            type: 'object',
            description: 'Additional environment variables for the command',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['command']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'bash_exec') return handleExec(args)

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  }
})

async function handleExec({ command, cwd, timeout, env = {} }) {
  try {
    // Resolve and validate working directory
    const workDir = cwd ? resolve(cwd) : ALLOWED_ROOT

    if (!isAllowed(workDir)) {
      return {
        content: [{
          type: 'text',
          text: `Blocked: working directory ${workDir} is outside allowed root (${ALLOWED_ROOT})`
        }],
        isError: true
      }
    }

    // Verify working directory exists
    try {
      await access(workDir)
    } catch {
      return {
        content: [{
          type: 'text',
          text: `Error: working directory does not exist: ${workDir}`
        }],
        isError: true
      }
    }

    // Clamp timeout
    const effectiveTimeout = Math.min(
      Math.max(timeout || DEFAULT_TIMEOUT, 1000),
      MAX_TIMEOUT
    )

    // Execute command
    const result = await execCommand(command, workDir, effectiveTimeout, env)

    // Format output
    const parts = [`Exit code: ${result.exitCode}`]

    if (result.stdout) {
      const stdout = truncate(result.stdout, MAX_OUTPUT)
      parts.push(`Stdout:\n${stdout}`)
    }

    if (result.stderr) {
      const stderr = truncate(result.stderr, MAX_OUTPUT)
      parts.push(`Stderr:\n${stderr}`)
    }

    if (!result.stdout && !result.stderr) {
      parts.push('(no output)')
    }

    return {
      content: [{ type: 'text', text: parts.join('\n\n') }],
      isError: result.exitCode !== 0
    }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Exec error: ${e.message}` }],
      isError: true
    }
  }
}

function execCommand(command, cwd, timeout, extraEnv) {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, ...extraEnv },
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      killSignal: 'SIGKILL'
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code, signal) => {
      if (timedOut) {
        resolve({
          exitCode: 124,
          stdout,
          stderr: stderr + `\n\nCommand timed out after ${timeout}ms`
        })
      } else if (signal) {
        resolve({
          exitCode: 128 + (signal === 'SIGKILL' ? 9 : 15),
          stdout,
          stderr: stderr + `\n\nCommand killed by signal: ${signal}`
        })
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr })
      }
    })

    proc.on('error', (err) => {
      if (err.code === 'ETIMEDOUT') {
        // Process timed out — Node.js will kill it and fire the close event next.
        // Set the flag so the close handler returns exit code 124 (standard timeout).
        // Do NOT resolve here to avoid a double-resolve.
        timedOut = true
      } else {
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + '\n' + err.message
        })
      }
    })
  })
}

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max) + `\n\n[... truncated, ${str.length} total chars]`
}

const transport = new StdioServerTransport()
await server.connect(transport)
