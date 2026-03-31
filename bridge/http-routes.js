import { mkdir, writeFile, readFile, unlink, rename } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import { createLogger } from './logger.js'

const log = createLogger('http')

// ─── Constants ────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json'
}

const FILES_SLUG_RE = /^[a-z0-9_-]+$/i
const filesBasePath = join(homedir(), 'paloma/projects')
const FILE_MIME_TYPES = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.csv': 'text/csv',
  '.zip': 'application/zip', '.gz': 'application/gzip'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function validateSlug(slug) {
  return slug && FILES_SLUG_RE.test(slug) && !slug.includes('..')
}

function validateFilename(filename) {
  return filename && !filename.includes('/') && !filename.includes('\\') && !filename.includes('..')
}

async function readIndex(dirPath) {
  try {
    const raw = await readFile(join(dirPath, '.index.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeIndexAtomic(dirPath, entries) {
  const indexPath = join(dirPath, '.index.json')
  const tmpPath = indexPath + '.tmp'
  await writeFile(tmpPath, JSON.stringify(entries, null, 2))
  await rename(tmpPath, indexPath)
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleEmails(pathname, req, url, corsHeaders, deps) {
  const { emailStore, broadcast } = deps

  if (pathname === '/api/emails' && req.method === 'GET') {
    return async (res) => {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)
      const search = url.searchParams.get('search') || ''
      const result = emailStore.getThreads({ limit, offset, search })
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify(result))
    }
  }

  if (pathname.startsWith('/api/emails/') && req.method === 'GET') {
    return async (res) => {
      const parts = pathname.split('/')

      // GET /api/emails/session/:sessionId/history
      if (parts.length >= 6 && parts[3] === 'session' && parts[5] === 'history') {
        const sessionId = parts[4]
        const events = emailStore.getSessionEvents(sessionId)
        if (events) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ sessionId, events }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ error: 'Session not found' }))
        }
        return
      }

      const lastPart = parts[parts.length - 1]
      if (lastPart === 'stats') {
        const result = emailStore.getStats()
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify(result))
        return
      }

      if (lastPart) {
        const result = emailStore.getThread(lastPart)
        if (result) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify(result))
        } else {
          res.writeHead(404, corsHeaders)
          res.end('Thread not found')
        }
      }
    }
  }

  if (pathname === '/api/emails/sync' && req.method === 'POST') {
    return async (res) => {
      const result = await emailStore.syncFromGmail()
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify(result))
      broadcast({ type: 'email_store_updated' })
    }
  }

  return null
}

function handleHealth(pathname, req, corsHeaders, deps) {
  const { startTime, health, pillarManager, mcpManager } = deps

  if (pathname === '/api/health' && req.method === 'GET') {
    return async (res) => {
      const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.round((Date.now() - startTime) / 1000),
        backends: health ? health.status : {},
        pillars: pillarManager ? pillarManager.list().pillars.length : 0,
        mcpServers: mcpManager ? mcpManager.clients.size : 0
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify(status, null, 2))
    }
  }

  return null
}

function handleUsage(pathname, req, corsHeaders, deps) {
  const { usageTracker, broadcast } = deps

  if (pathname === '/api/usage' && req.method === 'GET') {
    return async (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify(usageTracker.getSummary(), null, 2))
    }
  }

  if (pathname === '/api/usage/toggle' && req.method === 'POST') {
    return async (res) => {
      const body = await readBody(req)
      const { backend: backendName, override } = JSON.parse(body)
      if (!backendName) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'backend is required' }))
        return
      }
      const ok = usageTracker.setManualOverride(backendName, override ?? null)
      if (!ok) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: `Unknown backend: ${backendName}` }))
        return
      }
      broadcast({ type: 'usage_updated', usage: usageTracker.getSummary() })
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ ok: true, usage: usageTracker.getSummary() }))
    }
  }

  if (pathname === '/api/usage/config' && req.method === 'POST') {
    return async (res) => {
      const body = await readBody(req)
      const { backend: backendName, ...newLimits } = JSON.parse(body)
      if (!backendName) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'backend is required' }))
        return
      }
      const ok = await usageTracker.updateLimits(backendName, newLimits)
      if (!ok) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: `Unknown backend: ${backendName}` }))
        return
      }
      broadcast({ type: 'usage_updated', usage: usageTracker.getSummary() })
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ ok: true, limits: usageTracker.limits, usage: usageTracker.getSummary() }))
    }
  }

  if (pathname === '/api/usage/reset' && req.method === 'POST') {
    return async (res) => {
      const body = await readBody(req)
      const { backend: backendName } = JSON.parse(body)
      if (!backendName) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'backend is required' }))
        return
      }
      const targets = backendName === 'all'
        ? ['claude', 'copilot', 'gemini', 'codex', 'ollama']
        : [backendName]
      for (const t of targets) {
        if (usageTracker.data[t]) {
          usageTracker.data[t].sessions = 0
          usageTracker.data[t].requests = 0
          usageTracker.data[t].disabled = false
          usageTracker.data[t].disabledReason = null
          usageTracker.data[t].manualOverride = null
        }
      }
      await usageTracker.flush()
      broadcast({ type: 'usage_updated', usage: usageTracker.getSummary() })
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ ok: true, reset: targets, usage: usageTracker.getSummary() }))
    }
  }

  return null
}

function handleFiles(pathname, req, corsHeaders) {
  // POST /api/files/upload
  if (pathname === '/api/files/upload' && req.method === 'POST') {
    return async (res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const { slug, filename, data, mimeType } = body

      if (!validateSlug(slug)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Invalid project slug' }))
        return
      }
      if (!filename || !validateFilename(filename)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Invalid filename' }))
        return
      }
      if (!data) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Missing file data' }))
        return
      }

      const dirPath = join(filesBasePath, slug, 'files')
      await mkdir(dirPath, { recursive: true })

      const index = await readIndex(dirPath)
      let finalName = filename
      if (index.some(e => e.filename === filename)) {
        const now = new Date()
        const ts = String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0')
        const dotIdx = filename.lastIndexOf('.')
        finalName = dotIdx > 0
          ? filename.slice(0, dotIdx) + '-' + ts + filename.slice(dotIdx)
          : filename + '-' + ts
      }

      const fileBuf = Buffer.from(data, 'base64')
      const filePath = join(dirPath, finalName)

      if (!filePath.startsWith(dirPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Path traversal rejected' }))
        return
      }

      await writeFile(filePath, fileBuf)

      index.push({
        filename: finalName,
        uploadedAt: new Date().toISOString(),
        uploadedBy: body.uploadedBy || 'unknown',
        size: fileBuf.length,
        mimeType: mimeType || 'application/octet-stream'
      })
      await writeIndexAtomic(dirPath, index)

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ success: true, filename: finalName, size: fileBuf.length }))
    }
  }

  // DELETE /api/files/:slug/:filename
  if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
    return async (res) => {
      const parts = pathname.split('/').filter(Boolean)
      const slug = parts[2]
      const filename = parts[3] ? decodeURIComponent(parts[3]) : undefined

      if (!validateSlug(slug)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Invalid project slug' }))
        return
      }
      if (!filename || !validateFilename(filename)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Invalid filename' }))
        return
      }

      const dirPath = join(filesBasePath, slug, 'files')
      const filePath = join(dirPath, filename)

      if (!filePath.startsWith(dirPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Path traversal rejected' }))
        return
      }

      try {
        await unlink(filePath)
      } catch (unlinkErr) {
        if (unlinkErr.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ error: 'File not found' }))
          return
        }
        throw unlinkErr
      }

      const index = await readIndex(dirPath)
      const updated = index.filter(e => e.filename !== filename)
      await writeIndexAtomic(dirPath, updated)

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ success: true, filename }))
    }
  }

  // GET /api/files/:slug or GET /api/files/:slug/:filename
  if (pathname.startsWith('/api/files/') && req.method === 'GET') {
    return async (res) => {
      const parts = pathname.split('/').filter(Boolean)
      const slug = parts[2]

      if (!validateSlug(slug)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Invalid project slug' }))
        return
      }

      const dirPath = join(filesBasePath, slug, 'files')

      // GET /api/files/:slug — list files
      if (parts.length === 3) {
        const index = await readIndex(dirPath)
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ files: index }))
        return
      }

      // GET /api/files/:slug/:filename — download file
      if (parts.length === 4) {
        const filename = decodeURIComponent(parts[3])
        if (!validateFilename(filename)) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ error: 'Invalid filename' }))
          return
        }

        const filePath = join(dirPath, filename)
        if (!filePath.startsWith(dirPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
          res.end(JSON.stringify({ error: 'Path traversal rejected' }))
          return
        }

        const ext = extname(filename).toLowerCase()
        const contentType = FILE_MIME_TYPES[ext] || 'application/octet-stream'

        const stream = createReadStream(filePath)
        stream.on('open', () => {
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`,
            ...corsHeaders
          })
          stream.pipe(res)
        })
        stream.on('error', (streamErr) => {
          if (res.headersSent) {
            log.error(`GET /api/files stream error after headers sent: ${streamErr.message}`)
            res.end()
            return
          }
          if (streamErr.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: 'File not found' }))
          } else {
            log.error(`GET /api/files download error: ${streamErr.message}`)
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: streamErr.message }))
          }
        })
        return
      }

      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ error: 'Invalid files API path' }))
    }
  }

  return null
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Creates the HTTP request handler for the bridge server.
 *
 * @param {Object} deps - Runtime dependencies
 * @param {number} deps.port - Server port (for URL parsing)
 * @param {number} deps.startTime - Server start timestamp
 * @param {Object} deps.health - BackendHealth instance
 * @param {Object} deps.pillarManager - PillarManager instance (may be null during startup)
 * @param {Object} deps.mcpManager - McpManager instance
 * @param {Object} deps.usageTracker - UsageTracker instance
 * @param {Object} deps.emailStore - Email store
 * @param {Function} deps.broadcast - Broadcast to all WS clients
 * @returns {Function} HTTP request handler (req, res) => void
 */
export function createHttpHandler(deps) {
  const distDir = join(process.cwd(), 'dist')
  const hasDistDir = existsSync(join(distDir, 'index.html'))

  return async (req, res) => {
    const url = new URL(req.url, `http://localhost:${deps.port}`)
    const pathname = url.pathname

    // CORS headers for API routes (dev mode: Vite on :5173 → Bridge on :19191)
    const corsHeaders = pathname.startsWith('/api/') ? {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    } : {}

    // Handle CORS preflight
    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    // Try each route group — first match wins
    const routeGroups = [
      () => handleEmails(pathname, req, url, corsHeaders, deps),
      () => handleHealth(pathname, req, corsHeaders, deps),
      () => handleUsage(pathname, req, corsHeaders, deps),
      () => handleFiles(pathname, req, corsHeaders),
    ]

    for (const tryRoute of routeGroups) {
      const handler = tryRoute()
      if (handler) {
        try {
          await handler(res)
        } catch (err) {
          log.error(`${req.method} ${pathname} error: ${err.message}`)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
            res.end(JSON.stringify({ error: err.message }))
          }
        }
        return
      }
    }

    // ─── Frontend Static Serving ─────────────────────────────────────────
    if (!hasDistDir) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Paloma: run "npm run build" first to generate the frontend')
      return
    }

    let filePath = join(distDir, pathname === '/' ? 'index.html' : pathname)
    const ext = extname(filePath)

    // SPA fallback: non-file routes serve index.html
    if (!ext) filePath = join(distDir, 'index.html')

    const mime = MIME_TYPES[ext] || 'application/octet-stream'
    const stream = createReadStream(filePath)
    stream.on('open', () => {
      const headers = { 'Content-Type': mime }
      if (pathname.startsWith('/assets/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable'
      } else {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
      }
      res.writeHead(200, headers)
      stream.pipe(res)
    })
    stream.on('error', () => {
      // File not found → SPA fallback
      const indexStream = createReadStream(join(distDir, 'index.html'))
      indexStream.on('open', () => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        indexStream.pipe(res)
      })
      indexStream.on('error', () => {
        res.writeHead(404)
        res.end('Not found')
      })
    })
  }
}
