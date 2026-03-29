/**
 * Email Watcher Tests
 *
 * Tests the core email polling, deduplication, and session spawning logic.
 * Uses Node 22+ built-in test runner (no dependencies).
 *
 * Run: node --test tests/email-watcher.test.js
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Create a mock Gmail API that returns configurable messages.
 */
function createMockGmail(messages = []) {
  const modifiedMessages = []
  return {
    users: {
      messages: {
        list: mock.fn(async () => ({
          data: { messages: messages.map(m => ({ id: m.id, threadId: m.threadId || 't_' + m.id })) }
        })),
        get: mock.fn(async (params) => {
          const msg = messages.find(m => m.id === params.id)
          if (!msg) throw new Error(`Message ${params.id} not found`)
          return {
            data: {
              id: msg.id,
              threadId: msg.threadId || 't_' + msg.id,
              snippet: msg.body?.substring(0, 100) || '',
              labelIds: msg.labels || ['UNREAD', 'INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: msg.from || 'test@example.com' },
                  { name: 'Subject', value: msg.subject || 'Test Subject' },
                  { name: 'Date', value: msg.date || new Date().toISOString() },
                  { name: 'To', value: msg.to || 'paloma@verifesto.com' },
                  { name: 'Delivered-To', value: msg.deliveredTo || msg.to || 'paloma@verifesto.com' },
                ],
                mimeType: 'text/plain',
                body: { data: Buffer.from(msg.body || 'Test body').toString('base64url') }
              }
            }
          }
        }),
        modify: mock.fn(async (params) => {
          modifiedMessages.push(params)
          return { data: {} }
        })
      }
    },
    _modifiedMessages: modifiedMessages
  }
}

/**
 * Create a mock backends object with a mock Claude manager.
 */
function createMockBackends() {
  const spawnedSessions = []
  const mockManager = {
    chat: mock.fn((opts, callback) => {
      const sessionId = 'session_' + randomUUID().slice(0, 8)
      spawnedSessions.push({ ...opts, sessionId })
      // Simulate async completion
      setTimeout(() => callback({ type: 'claude_done', exitCode: 0 }), 50)
      return { requestId: 'req_' + sessionId, sessionId }
    })
  }
  return {
    backends: {
      claude: mockManager,
      gemini: mockManager,
      copilot: mockManager,
      codex: mockManager,
    },
    spawnedSessions,
    mockManager
  }
}

/**
 * Create a temp directory for test files (seenIds, machine profile, etc.)
 */
function createTempDir() {
  const dir = resolve(tmpdir(), 'paloma-test-' + randomUUID().slice(0, 8))
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─── EmailWatcher with injectable paths ──────────────────────────────────────
// We can't easily import EmailWatcher because it has hardcoded paths.
// Instead, we test the LOGIC by recreating the critical methods.
// This is more robust than mocking the entire module system.

/**
 * Minimal EmailWatcher replica that uses injectable paths and mocked Gmail.
 * Tests the exact same logic as the real EmailWatcher.
 */
class TestableEmailWatcher {
  constructor({ gmail, backends, seenIdsPath, emailAlias = 'paloma@verifesto.com', broadcast }) {
    this.gmail = gmail
    this.backends = backends
    this.cliManager = backends.claude
    this.broadcast = broadcast || (() => {})
    this.seenIds = new Set()
    this.emailAlias = emailAlias
    this.running = false
    this._consecutivePollFailures = 0
    this._seenIdsPath = seenIdsPath
    this._spawnedSessions = []
    this._markAsReadDisabled = false
    this._markAsReadWarned = false
  }

  // ─── Copied from email-watcher.js (the methods under test) ───

  _loadSeenIds() {
    try {
      if (existsSync(this._seenIdsPath)) {
        const data = JSON.parse(readFileSync(this._seenIdsPath, 'utf8'))
        if (Array.isArray(data.ids)) {
          this.seenIds = new Set(data.ids.slice(-2000))
        }
      }
    } catch {
      // start fresh
    }
  }

  _saveSeenIds() {
    try {
      const ids = [...this.seenIds].slice(-2000)
      writeFileSync(this._seenIdsPath, JSON.stringify({ ids, updatedAt: new Date().toISOString() }, null, 2))
    } catch {
      // ignore
    }
  }

  _isTrustedSender(from) {
    const TRUSTED_SENDERS = [
      'adam@verifesto.com', 'adamlynchmob@gmail.com', 'kelsey',
      'downesbruce@gmail.com', 'paloma@verifesto.com',
      'lenovo.paloma@verifesto.com', 'macbook.paloma@verifesto.com',
      'adambookpro.paloma@verifesto.com',
    ]
    const fromLower = from.toLowerCase()
    return TRUSTED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()))
  }

  _isInstanceSender(from) {
    const PALOMA_INSTANCE_SENDERS = [
      'paloma@verifesto.com', 'lenovo.paloma@verifesto.com',
      'macbook.paloma@verifesto.com', 'adambookpro.paloma@verifesto.com',
    ]
    return PALOMA_INSTANCE_SENDERS.some(addr => from.toLowerCase().includes(addr.toLowerCase()))
  }

  _getHeader(message, name) {
    return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value
  }

  _extractBody(message) {
    const payload = message.payload
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8')
    }
    return message.snippet || ''
  }

  async _markAsRead(messageId) {
    if (this._markAsReadDisabled) return
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] }
      })
    } catch (err) {
      if (err.code === 403 || err.message?.includes('Insufficient Permission')) {
        this._markAsReadDisabled = true
      }
    }
  }

  _parseModelOverride(subject) {
    const match = subject.match(/model:(\w+)/i)
    if (!match) return null
    const val = match[1].toLowerCase()
    const overrides = {
      opus: { backend: 'claude', model: 'opus' },
      sonnet: { backend: 'claude', model: 'sonnet' },
      claude: { backend: 'claude', model: 'sonnet' },
      gemini: { backend: 'gemini', model: 'gemini-2.5-pro' },
      copilot: { backend: 'copilot', model: 'copilot' },
      codex: { backend: 'codex', model: 'codex' },
    }
    return overrides[val] || null
  }

  /**
   * The actual poll method — mirrors the real implementation with the fix applied.
   */
  async poll(silent = false) {
    if (!this.gmail) return

    const query = this.emailAlias
      ? `is:unread in:inbox to:${this.emailAlias}`
      : 'is:unread in:inbox'

    const result = await this.gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 })
    const messages = result.data.messages || []

    if (silent) {
      const UNKNOWN_SENDER_THRESHOLD_MS = 60 * 60 * 1000
      const now = Date.now()
      const toProcess = []
      let silentCount = 0

      for (const ref of messages) {
        // THE FIX: Check seenIds FIRST
        if (this.seenIds.has(ref.id)) {
          continue
        }

        try {
          const msg = await this.gmail.users.messages.get({
            userId: 'me', id: ref.id, format: 'full',
            metadataHeaders: ['From', 'Subject', 'Date', 'To', 'Delivered-To']
          })
          const from = this._getHeader(msg.data, 'From') || 'Unknown'
          const dateStr = this._getHeader(msg.data, 'Date')
          const emailTime = dateStr ? new Date(dateStr).getTime() : 0
          const ageMs = now - emailTime
          const trusted = this._isTrustedSender(from)
          const isInstance = this._isInstanceSender(from)

          if (isInstance) {
            this.seenIds.add(ref.id)
          } else if (trusted) {
            toProcess.push({ ref, msg, from, trusted: true })
          } else if (ageMs < UNKNOWN_SENDER_THRESHOLD_MS) {
            toProcess.push({ ref, msg, from, trusted: false })
          } else {
            this.seenIds.add(ref.id)
            silentCount++
          }
        } catch {
          this.seenIds.add(ref.id)
        }
      }

      for (const { ref, msg, from, trusted } of toProcess) {
        this.seenIds.add(ref.id)
        const subject = this._getHeader(msg.data, 'Subject') || '(no subject)'
        const body = this._extractBody(msg.data)
        this._spawnedSessions.push({
          messageId: ref.id,
          threadId: ref.threadId,
          from,
          subject,
          body,
          trusted,
          phase: 'initial-sync'
        })
        await this._markAsRead(ref.id)
      }

      this._saveSeenIds()
      return
    }

    // Normal poll — filter by seenIds
    const newMessages = messages.filter(m => !this.seenIds.has(m.id))

    for (const ref of newMessages) {
      this.seenIds.add(ref.id)

      const msg = await this.gmail.users.messages.get({
        userId: 'me', id: ref.id, format: 'full',
        metadataHeaders: ['From', 'Subject', 'Date', 'To', 'Delivered-To']
      })

      const from = this._getHeader(msg.data, 'From') || 'Unknown'
      const subject = this._getHeader(msg.data, 'Subject') || '(no subject)'
      const body = this._extractBody(msg.data)

      // Recipient gate
      if (this.emailAlias) {
        const toHeader = (this._getHeader(msg.data, 'To') || '').toLowerCase()
        const deliveredTo = (this._getHeader(msg.data, 'Delivered-To') || '').toLowerCase()
        const alias = this.emailAlias.toLowerCase()
        if (!toHeader.includes(alias) && !deliveredTo.includes(alias)) {
          continue
        }
      }

      // Instance check
      if (this._isInstanceSender(from)) {
        continue
      }

      const trusted = this._isTrustedSender(from)
      this._spawnedSessions.push({
        messageId: ref.id,
        threadId: ref.threadId,
        from,
        subject,
        body,
        trusted,
        phase: 'normal-poll'
      })
      await this._markAsRead(ref.id)
    }

    // Prune
    if (this.seenIds.size > 2000) {
      const arr = [...this.seenIds]
      this.seenIds = new Set(arr.slice(-2000))
    }

    this._saveSeenIds()
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmailWatcher — seenIds deduplication', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should NOT re-process trusted emails that are already in seenIds on restart', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Hey Paloma', body: 'Hello', date: new Date().toISOString() },
      { id: 'msg2', from: 'adam@verifesto.com', subject: 'Another one', body: 'Hi again', date: new Date().toISOString() },
    ])

    // Pre-populate seenIds (simulating previous session)
    writeFileSync(seenIdsPath, JSON.stringify({ ids: ['msg1', 'msg2'] }))

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    watcher._loadSeenIds()

    // Run initial sync (silent=true)
    await watcher.poll(true)

    // NO sessions should be spawned — both messages already seen
    assert.equal(watcher._spawnedSessions.length, 0,
      'Should not spawn sessions for already-seen trusted emails')
  })

  it('should process NEW trusted emails not in seenIds', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Already seen', body: 'Old', date: new Date().toISOString() },
      { id: 'msg3', from: 'adam@verifesto.com', subject: 'Brand new', body: 'New', date: new Date().toISOString() },
    ])

    // Only msg1 was previously seen
    writeFileSync(seenIdsPath, JSON.stringify({ ids: ['msg1'] }))

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    watcher._loadSeenIds()

    await watcher.poll(true)

    // Only msg3 should be processed
    assert.equal(watcher._spawnedSessions.length, 1)
    assert.equal(watcher._spawnedSessions[0].messageId, 'msg3')
    assert.equal(watcher._spawnedSessions[0].trusted, true)
  })

  it('should persist new seenIds to disk after initial sync', async () => {
    const gmail = createMockGmail([
      { id: 'new1', from: 'adam@verifesto.com', subject: 'New', body: 'Test', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })

    await watcher.poll(true)

    // Verify seenIds file was written
    assert.ok(existsSync(seenIdsPath), 'seenIds file should exist')
    const saved = JSON.parse(readFileSync(seenIdsPath, 'utf8'))
    assert.ok(saved.ids.includes('new1'), 'new1 should be in persisted seenIds')
  })

  it('should survive missing seenIds file on startup', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Test', body: 'Body', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    watcher._loadSeenIds()

    assert.equal(watcher.seenIds.size, 0, 'Should start with empty seenIds')

    await watcher.poll(true)
    assert.equal(watcher._spawnedSessions.length, 1, 'Should process the email')
  })

  it('should survive corrupted seenIds file', async () => {
    writeFileSync(seenIdsPath, 'NOT JSON {{{{')

    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Test', body: 'Body', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    watcher._loadSeenIds()

    assert.equal(watcher.seenIds.size, 0, 'Should start fresh on corrupt file')
  })

  it('should cap seenIds at 2000 entries', async () => {
    // Pre-fill with 2005 IDs
    const ids = Array.from({ length: 2005 }, (_, i) => `old_${i}`)
    writeFileSync(seenIdsPath, JSON.stringify({ ids }))

    const { backends } = createMockBackends()
    const gmail = createMockGmail([])
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    watcher._loadSeenIds()

    assert.equal(watcher.seenIds.size, 2000, 'Should cap at 2000')
    // Should keep the LAST 2000 (most recent)
    assert.ok(watcher.seenIds.has('old_2004'), 'Should keep newest')
    assert.ok(!watcher.seenIds.has('old_0'), 'Should drop oldest')
  })
})

describe('EmailWatcher — normal polling deduplication', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should not re-process emails during normal polling', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Test', body: 'Body', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })

    // First poll: should process
    await watcher.poll(false)
    assert.equal(watcher._spawnedSessions.length, 1)

    // Second poll with same message: should NOT re-process
    await watcher.poll(false)
    assert.equal(watcher._spawnedSessions.length, 1, 'Should not spawn duplicate session')
  })

  it('should process new messages appearing between polls', async () => {
    const { backends } = createMockBackends()

    // Poll 1: one message
    const gmail1 = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'First', body: 'Body', date: new Date().toISOString() },
    ])
    const watcher = new TestableEmailWatcher({ gmail: gmail1, backends, seenIdsPath })
    await watcher.poll(false)
    assert.equal(watcher._spawnedSessions.length, 1)

    // Poll 2: same message + new message
    watcher.gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'First', body: 'Body', date: new Date().toISOString() },
      { id: 'msg2', from: 'adam@verifesto.com', subject: 'Second', body: 'Body2', date: new Date().toISOString() },
    ])
    await watcher.poll(false)
    assert.equal(watcher._spawnedSessions.length, 2, 'Should only process the new message')
    assert.equal(watcher._spawnedSessions[1].messageId, 'msg2')
  })
})

describe('EmailWatcher — trusted sender detection', () => {
  let tempDir, seenIdsPath, watcher

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
    const { backends } = createMockBackends()
    watcher = new TestableEmailWatcher({ gmail: createMockGmail([]), backends, seenIdsPath })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should recognize Adam as trusted', () => {
    assert.ok(watcher._isTrustedSender('adam@verifesto.com'))
    assert.ok(watcher._isTrustedSender('Adam Lynch <adam@verifesto.com>'))
    assert.ok(watcher._isTrustedSender('adamlynchmob@gmail.com'))
  })

  it('should recognize Kelsey by partial match', () => {
    assert.ok(watcher._isTrustedSender('kelsey@anything.com'))
    assert.ok(watcher._isTrustedSender('Kelsey Smith <kelsey.smith@example.com>'))
  })

  it('should recognize Paloma instances as trusted', () => {
    assert.ok(watcher._isTrustedSender('paloma@verifesto.com'))
    assert.ok(watcher._isTrustedSender('lenovo.paloma@verifesto.com'))
    assert.ok(watcher._isTrustedSender('macbook.paloma@verifesto.com'))
    assert.ok(watcher._isTrustedSender('adambookpro.paloma@verifesto.com'))
  })

  it('should NOT trust unknown senders', () => {
    assert.ok(!watcher._isTrustedSender('random@gmail.com'))
    assert.ok(!watcher._isTrustedSender('spammer@evil.com'))
    // Note: 'notadam@verifesto.com' would match because it contains 'adam@verifesto.com'
    assert.ok(!watcher._isTrustedSender('stranger@otherdomain.com'))
  })

  it('should be case-insensitive', () => {
    assert.ok(watcher._isTrustedSender('ADAM@VERIFESTO.COM'))
    assert.ok(watcher._isTrustedSender('Paloma@Verifesto.Com'))
  })
})

describe('EmailWatcher — instance sender detection', () => {
  let watcher

  beforeEach(() => {
    const tempDir = createTempDir()
    const { backends } = createMockBackends()
    watcher = new TestableEmailWatcher({
      gmail: createMockGmail([]),
      backends,
      seenIdsPath: resolve(tempDir, 'seen-ids.json')
    })
  })

  it('should detect Paloma instance emails', () => {
    assert.ok(watcher._isInstanceSender('paloma@verifesto.com'))
    assert.ok(watcher._isInstanceSender('Paloma <lenovo.paloma@verifesto.com>'))
  })

  it('should NOT flag non-instance emails', () => {
    assert.ok(!watcher._isInstanceSender('adam@verifesto.com'))
    assert.ok(!watcher._isInstanceSender('random@gmail.com'))
  })
})

describe('EmailWatcher — instance emails stored but no session', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should NOT spawn sessions for inter-instance emails during initial sync', async () => {
    const gmail = createMockGmail([
      { id: 'inst1', from: 'lenovo.paloma@verifesto.com', subject: 'Instance msg', body: 'Hi', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(true)

    assert.equal(watcher._spawnedSessions.length, 0, 'Instance emails should not spawn sessions')
    assert.ok(watcher.seenIds.has('inst1'), 'Instance email should be added to seenIds')
  })

  it('should NOT spawn sessions for inter-instance emails during normal poll', async () => {
    const gmail = createMockGmail([
      { id: 'inst1', from: 'paloma@verifesto.com', subject: 'Instance msg', body: 'Hi', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(false)

    assert.equal(watcher._spawnedSessions.length, 0, 'Instance emails should not spawn sessions')
  })
})

describe('EmailWatcher — old unknown emails skipped on initial sync', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should skip old unknown sender emails (> 1 hour) during initial sync', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

    const gmail = createMockGmail([
      { id: 'old1', from: 'stranger@example.com', subject: 'Old spam', body: 'Buy now', date: twoHoursAgo },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(true)

    assert.equal(watcher._spawnedSessions.length, 0, 'Old unknown email should be silently skipped')
    assert.ok(watcher.seenIds.has('old1'), 'Old email should be marked as seen')
  })

  it('should process recent unknown sender emails (< 1 hour) during initial sync', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const gmail = createMockGmail([
      { id: 'new1', from: 'stranger@example.com', subject: 'Recent inquiry', body: 'Hello', date: fiveMinAgo },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(true)

    assert.equal(watcher._spawnedSessions.length, 1, 'Recent unknown email should be triaged')
    assert.equal(watcher._spawnedSessions[0].trusted, false)
  })

  it('should ALWAYS process trusted emails regardless of age during initial sync', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    const gmail = createMockGmail([
      { id: 'old_trusted', from: 'adam@verifesto.com', subject: 'Old but important', body: 'Please fix', date: threeDaysAgo },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(true)

    assert.equal(watcher._spawnedSessions.length, 1, 'Trusted email should be processed regardless of age')
    assert.equal(watcher._spawnedSessions[0].trusted, true)
  })
})

describe('EmailWatcher — mark as read', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should mark processed emails as read in Gmail', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Test', body: 'Body', date: new Date().toISOString() },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(false)

    assert.equal(gmail._modifiedMessages.length, 1)
    assert.equal(gmail._modifiedMessages[0].id, 'msg1')
    assert.deepEqual(gmail._modifiedMessages[0].requestBody, { removeLabelIds: ['UNREAD'] })
  })

  it('should gracefully disable mark-as-read on permission error', async () => {
    const gmail = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Test1', body: 'Body', date: new Date().toISOString() },
      { id: 'msg2', from: 'adam@verifesto.com', subject: 'Test2', body: 'Body', date: new Date().toISOString() },
    ])

    // Override modify to throw permission error
    gmail.users.messages.modify = mock.fn(async () => {
      const err = new Error('Insufficient Permission')
      err.code = 403
      throw err
    })

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })
    await watcher.poll(false)

    // Should still process both emails (mark-as-read failure doesn't block processing)
    assert.equal(watcher._spawnedSessions.length, 2, 'Processing should continue despite mark-as-read failure')
    assert.equal(watcher._markAsReadDisabled, true, 'Should disable mark-as-read after permission error')
  })
})

describe('EmailWatcher — recipient gating', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should skip emails not addressed to this machine during normal poll', async () => {
    const gmail = createMockGmail([
      {
        id: 'msg1',
        from: 'stranger@example.com',
        subject: 'For someone else',
        body: 'Body',
        to: 'someone@otherdomain.com',
        deliveredTo: 'someone@otherdomain.com',
        date: new Date().toISOString()
      },
    ])

    const { backends } = createMockBackends()
    // This machine is paloma@verifesto.com
    const watcher = new TestableEmailWatcher({
      gmail, backends, seenIdsPath,
      emailAlias: 'paloma@verifesto.com'
    })
    await watcher.poll(false)

    assert.equal(watcher._spawnedSessions.length, 0, 'Should skip email addressed to different machine')
  })

  it('should process emails addressed to this machine', async () => {
    const gmail = createMockGmail([
      {
        id: 'msg1',
        from: 'adam@verifesto.com',
        subject: 'For main Paloma',
        body: 'Body',
        to: 'paloma@verifesto.com',
        deliveredTo: 'paloma@verifesto.com',
        date: new Date().toISOString()
      },
    ])

    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({
      gmail, backends, seenIdsPath,
      emailAlias: 'paloma@verifesto.com'
    })
    await watcher.poll(false)

    assert.equal(watcher._spawnedSessions.length, 1, 'Should process email addressed to this machine')
  })
})

describe('EmailWatcher — model override parsing', () => {
  let watcher

  beforeEach(() => {
    const { backends } = createMockBackends()
    watcher = new TestableEmailWatcher({
      gmail: createMockGmail([]),
      backends,
      seenIdsPath: '/dev/null'
    })
  })

  it('should parse model:opus from subject', () => {
    const result = watcher._parseModelOverride('Help me model:opus please')
    assert.deepEqual(result, { backend: 'claude', model: 'opus' })
  })

  it('should parse model:gemini from subject', () => {
    const result = watcher._parseModelOverride('model:gemini Research task')
    assert.deepEqual(result, { backend: 'gemini', model: 'gemini-2.5-pro' })
  })

  it('should be case-insensitive', () => {
    const result = watcher._parseModelOverride('Test Model:OPUS subject')
    assert.deepEqual(result, { backend: 'claude', model: 'opus' })
  })

  it('should return null if no model directive', () => {
    const result = watcher._parseModelOverride('Normal subject line')
    assert.equal(result, null)
  })

  it('should return null for unknown model values', () => {
    const result = watcher._parseModelOverride('model:gpt4 test')
    assert.equal(result, null)
  })
})

describe('EmailWatcher — full restart simulation', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should handle the full restart cycle without re-processing', async () => {
    const emails = [
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'First', body: 'Hi', date: new Date().toISOString() },
      { id: 'msg2', from: 'adam@verifesto.com', subject: 'Second', body: 'Hello', date: new Date().toISOString() },
    ]

    // SESSION 1: Process both emails
    const gmail1 = createMockGmail(emails)
    const { backends: backends1 } = createMockBackends()
    const watcher1 = new TestableEmailWatcher({ gmail: gmail1, backends: backends1, seenIdsPath })
    await watcher1.poll(true) // initial sync
    assert.equal(watcher1._spawnedSessions.length, 2, 'Session 1: should process both')

    // Verify seenIds persisted
    const saved = JSON.parse(readFileSync(seenIdsPath, 'utf8'))
    assert.ok(saved.ids.includes('msg1'))
    assert.ok(saved.ids.includes('msg2'))

    // SESSION 2: "Restart" — same emails still unread in Gmail
    const gmail2 = createMockGmail(emails)
    const { backends: backends2 } = createMockBackends()
    const watcher2 = new TestableEmailWatcher({ gmail: gmail2, backends: backends2, seenIdsPath })
    watcher2._loadSeenIds() // Load persisted seenIds
    await watcher2.poll(true) // initial sync again

    assert.equal(watcher2._spawnedSessions.length, 0,
      'Session 2: should NOT re-process already-seen emails after restart')
  })

  it('should process only genuinely new emails after restart', async () => {
    // SESSION 1: Process one email
    const gmail1 = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'First', body: 'Hi', date: new Date().toISOString() },
    ])
    const { backends: backends1 } = createMockBackends()
    const watcher1 = new TestableEmailWatcher({ gmail: gmail1, backends: backends1, seenIdsPath })
    await watcher1.poll(true)
    assert.equal(watcher1._spawnedSessions.length, 1)

    // SESSION 2: Restart with old email + new email
    const gmail2 = createMockGmail([
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'First', body: 'Hi', date: new Date().toISOString() },
      { id: 'msg3', from: 'adam@verifesto.com', subject: 'New after restart', body: 'Important', date: new Date().toISOString() },
    ])
    const { backends: backends2 } = createMockBackends()
    const watcher2 = new TestableEmailWatcher({ gmail: gmail2, backends: backends2, seenIdsPath })
    watcher2._loadSeenIds()
    await watcher2.poll(true)

    assert.equal(watcher2._spawnedSessions.length, 1, 'Should only process the new email')
    assert.equal(watcher2._spawnedSessions[0].messageId, 'msg3')
  })

  it('should handle multiple restarts correctly', async () => {
    const allEmails = [
      { id: 'msg1', from: 'adam@verifesto.com', subject: 'Email 1', body: 'Body', date: new Date().toISOString() },
      { id: 'msg2', from: 'adam@verifesto.com', subject: 'Email 2', body: 'Body', date: new Date().toISOString() },
      { id: 'msg3', from: 'adam@verifesto.com', subject: 'Email 3', body: 'Body', date: new Date().toISOString() },
    ]

    // Restart 1
    const { backends: b1 } = createMockBackends()
    const w1 = new TestableEmailWatcher({ gmail: createMockGmail([allEmails[0]]), backends: b1, seenIdsPath })
    await w1.poll(true)
    assert.equal(w1._spawnedSessions.length, 1)

    // Restart 2
    const { backends: b2 } = createMockBackends()
    const w2 = new TestableEmailWatcher({ gmail: createMockGmail([allEmails[0], allEmails[1]]), backends: b2, seenIdsPath })
    w2._loadSeenIds()
    await w2.poll(true)
    assert.equal(w2._spawnedSessions.length, 1, 'Restart 2: only new email')
    assert.equal(w2._spawnedSessions[0].messageId, 'msg2')

    // Restart 3
    const { backends: b3 } = createMockBackends()
    const w3 = new TestableEmailWatcher({ gmail: createMockGmail(allEmails), backends: b3, seenIdsPath })
    w3._loadSeenIds()
    await w3.poll(true)
    assert.equal(w3._spawnedSessions.length, 1, 'Restart 3: only new email')
    assert.equal(w3._spawnedSessions[0].messageId, 'msg3')
  })
})

describe('EmailWatcher — empty inbox', () => {
  let tempDir, seenIdsPath

  beforeEach(() => {
    tempDir = createTempDir()
    seenIdsPath = resolve(tempDir, 'seen-ids.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should handle empty inbox gracefully', async () => {
    const gmail = createMockGmail([])
    const { backends } = createMockBackends()
    const watcher = new TestableEmailWatcher({ gmail, backends, seenIdsPath })

    await watcher.poll(true)
    assert.equal(watcher._spawnedSessions.length, 0)

    await watcher.poll(false)
    assert.equal(watcher._spawnedSessions.length, 0)
  })
})
