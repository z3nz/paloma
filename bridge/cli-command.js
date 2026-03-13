import { existsSync, readFileSync } from 'fs'
import { delimiter, join } from 'path'

function findWindowsShim(command) {
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)

  for (const dir of pathDirs) {
    const shimPath = join(dir, `${command}.cmd`)
    if (!existsSync(shimPath)) continue

    const shim = readFileSync(shimPath, 'utf8')
    const match = shim.match(/"%dp0%\\([^\"]+\.js)"/i)
    if (!match) continue

    const relativeScriptPath = match[1].replace(/\\/g, '/')
    const scriptPath = join(dir, relativeScriptPath)
    const nodePath = existsSync(join(dir, 'node.exe')) ? join(dir, 'node.exe') : process.execPath

    return { command: nodePath, prependArgs: [scriptPath] }
  }

  return null
}

export function buildCliSpawn(command, args) {
  if (process.platform === 'win32') {
    const resolved = findWindowsShim(command)
    if (resolved) {
      return {
        command: resolved.command,
        args: [...resolved.prependArgs, ...args]
      }
    }
  }

  return { command, args }
}