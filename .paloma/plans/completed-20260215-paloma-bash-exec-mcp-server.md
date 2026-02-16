# Paloma — Bash Execution MCP Server (`exec.js`)

> **Purpose:** Give Paloma the ability to run shell commands through the bridge, enabling builds, deploys, and scripts without relying on the Claude Code CLI's native Bash tool.
> **Status:** Completed
> **Created:** 2026-02-15
> **Scope:** Paloma infrastructure

---

## The Problem

Paloma currently has two execution paths:

1. **Claude Code CLI** (subprocess via bridge) — has native `Bash` tool, can run anything
2. **OpenRouter / browser-side** — relies entirely on MCP tools for capabilities

The `@kevinwatt/shell-mcp` server only exposes a safe, read-only subset of commands (`ls`, `cat`, `grep`, `find`, `ps`, `free`, etc.). It deliberately excludes:

- `npm` / `npx` (can't install deps or run builds)
- `wrangler` (can't deploy to Cloudflare Pages)
- `git` CLI (covered by git MCP, but not for arbitrary git commands)
- Custom scripts (`./deploy.sh`, `python`, etc.)
- Any command that modifies state

This means **Paloma through the bridge cannot:**
- Run `npm install` or `npm run build`
- Deploy with `wrangler pages deploy`
- Execute project scaffolding scripts
- Run test suites
- Perform any multi-step automation that requires shell access

---

## The Solution

Build `mcp-servers/exec.js` — a custom MCP server following the exact same pattern as `web.js` and `fs-extra.js`. It exposes a single `bash_exec` tool that runs shell commands with safety guardrails.

---

## Design Principles

1. **Same pattern as existing servers** — low-level `Server` class, raw JSON Schema, stdio transport
2. **Home directory restriction** — commands can only execute within `/home/adam`
3. **Working directory support** — caller specifies `cwd`, defaults to home
4. **Timeout protection** — configurable timeout per command (default: 120s, max: 600s)
5. **Output capture** — returns stdout, stderr, and exit code
6. **Output truncation** — large outputs are truncated to prevent context overflow
7. **No command allowlist by default** — Paloma's permission system (bridge ToolConfirmation + `.paloma/mcp.json` autoExecute) already gates every tool call. The MCP server trusts the caller; the bridge gates the request.

---

## Tool Specification

### `bash_exec`

Execute a shell command and return the result.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The shell command to execute"
    },
    "cwd": {
      "type": "string",
      "description": "Working directory for the command (absolute path, must be within home directory). Defaults to home directory."
    },
    "timeout": {
      "type": "number",
      "description": "Timeout in milliseconds (default: 120000, max: 600000)"
    },
    "env": {
      "type": "object",
      "description": "Additional environment variables to set for the command",
      "additionalProperties": { "type": "string" }
    }
  },
  "required": ["command"]
}
```

**Output:**
```json
{
  "type": "text",
  "text": "Exit code: 0\nStdout:\n<stdout content>\n\nStderr:\n<stderr content>"
}
```

---

## Implementation

### `mcp-servers/exec.js`

```js
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
import { execSync, spawn } from 'node:child_process'
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
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    proc.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr: stderr + '\n' + err.message })
    })
  })
}

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max) + `\n\n[... truncated, ${str.length} total chars]`
}

const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## Configuration

### Add to `~/.paloma/mcp-settings.json`

```json
{
  "exec": {
    "command": "node",
    "args": ["/home/adam/paloma/mcp-servers/exec.js"]
  }
}
```

### Project-level permissions (`.paloma/mcp.json`)

For projects that should auto-approve certain exec commands (e.g., Fadden demo deploys):

```json
{
  "autoExecute": [
    {
      "server": "exec",
      "tools": []
    }
  ]
}
```

> **Note:** By default, `bash_exec` is NOT in any autoExecute list. Every execution goes through the bridge's ToolConfirmation dialog. This is intentional — shell execution should require explicit human approval unless the project opts in.

---

## Security Model

### Layers of Protection

1. **Bridge ToolConfirmation** — Every tool call from Paloma goes through the browser-side confirmation dialog unless auto-approved. This is the primary gate.

2. **MCP server path restriction** — `exec.js` refuses to run commands with a `cwd` outside `/home/adam`. This prevents escaping the home directory.

3. **Timeout enforcement** — Commands are killed after the timeout to prevent runaway processes.

4. **Project-level autoExecute** — Each project chooses whether to auto-approve exec tools. By default, none do.

### What This Does NOT Do

- **No command allowlist** — The server runs whatever command is approved through the bridge. This is by design: the permission layer is at the bridge, not the server.
- **No sandboxing** — Commands run as Adam's user. This is the same security model as Claude Code's native Bash tool.
- **No network restrictions** — Commands can make network calls (needed for `wrangler deploy`, `npm install`, etc.)

### Why This Is Acceptable

- Paloma is a personal development environment, not a multi-tenant system
- The bridge confirmation dialog is the trust boundary
- The same trust model applies to Claude Code's native Bash tool
- Adam can always see what command is about to run and approve/deny it

---

## Bridge Integration

### `bridge/mcp-proxy-server.js` Changes

None. The proxy server dynamically loads all servers from `~/.paloma/mcp-settings.json`. Adding `exec` to the settings file is sufficient — the proxy will discover and start it on next bridge restart.

### `bridge/config.js` Changes

None. Config already reads all servers from `mcp-settings.json`.

### Frontend Changes

The ToolConfirmation dialog already handles all MCP tools generically. No changes needed. The `bash_exec` tool call will show up with the command string in the confirmation dialog, which is exactly what we want — Adam sees the command and approves/denies it.

---

## Usage Examples

### Build and deploy a client demo
```
bash_exec:
  command: "npm run build && npx wrangler pages deploy dist/ --project-name=vs-fcps-demo"
  cwd: "/home/adam/paloma/projects/fcps-demo"
```

### Install dependencies for a new project
```
bash_exec:
  command: "npm install"
  cwd: "/home/adam/paloma/projects/newclient-demo"
```

### Run the deploy script (once we have one)
```
bash_exec:
  command: "./deploy-client.sh fcps"
  cwd: "/home/adam/paloma/projects/verifesto-studios"
```

### Run tests
```
bash_exec:
  command: "npm test"
  cwd: "/home/adam/paloma/projects/some-project"
```

---

## Implementation Steps

1. **Create `mcp-servers/exec.js`** — copy from the implementation above
2. **Add `exec` to `~/.paloma/mcp-settings.json`** — point to the new server
3. **Restart the bridge** — so the proxy picks up the new server
4. **Test** — run a simple command (`echo hello`) through the Paloma UI to verify the confirmation flow works
5. **Test a real deploy** — build + deploy the Fadden demo through Paloma to prove the full pipeline

---

## Future Enhancements

- **Streaming output** — Instead of buffering all output and returning at the end, stream stdout/stderr back to the UI in real-time. This matters for long-running commands like `npm install` or builds. Would require MCP protocol support for streaming tool results.
- **Command history** — Log all executed commands and their results to a file for audit/debugging.
- **Optional allowlist mode** — For high-security contexts, allow projects to specify a command allowlist in `.paloma/mcp.json`. Only whitelisted commands execute without confirmation.

---

*This server fills the last major capability gap in Paloma's MCP toolkit. With it, Paloma can fully manage the client demo lifecycle from scaffold to deploy without leaving the browser.*
