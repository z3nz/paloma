import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const scriptName = process.argv[2]

if (!scriptName) {
  console.error('Usage: node scripts/run-platform-script.js <script-base-name>')
  process.exit(1)
}

const isWindows = process.platform === 'win32'
const extension = isWindows ? '.ps1' : '.sh'
const scriptPath = resolve(__dirname, `${scriptName}${extension}`)

const command = isWindows ? 'powershell' : 'bash'
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
  : [scriptPath]

const child = spawn(command, args, {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
  env: process.env,
  windowsHide: false
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(`Failed to launch ${scriptName}${extension}: ${error.message}`)
  process.exit(1)
})