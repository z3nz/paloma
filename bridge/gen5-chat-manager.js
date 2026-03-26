import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createLogger } from './logger.js'

const log = createLogger('gen5')

/**
 * Quinn Gen5 Chat Document Manager.
 * Owns the lifecycle of chat documents — creation, loading, injection, and compression.
 * Chat docs live at .singularity/chats/{chatId}/chat.md
 */
export class Gen5ChatManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot
    this._pendingUpdates = new Map() // chatId -> Promise
  }

  /** Generate a new chatId (UUID) for a new conversation */
  createChatId() {
    return randomUUID()
  }

  /** Path to chat document for a given chatId */
  _chatDocPath(chatId) {
    return join(this.projectRoot, '.singularity', 'chats', chatId, 'chat.md')
  }

  /**
   * Load the chat document for injection into user message.
   * If a pending update exists for this chatId, awaits it first (blocking).
   * Returns empty string if no document exists yet.
   */
  async loadChatDoc(chatId) {
    const pending = this._pendingUpdates.get(chatId)
    if (pending) {
      try { await pending } catch { /* handled in updateChatDoc */ }
    }

    try {
      return await readFile(this._chatDocPath(chatId), 'utf8')
    } catch {
      return ''
    }
  }

  /**
   * Build the injected user message: <chat_document>...</chat_document> + user message.
   * If chatDoc is empty, returns just the user message (no tags).
   */
  buildInjectedMessage(chatDoc, userMessage) {
    if (!chatDoc) return userMessage
    return '<chat_document>\n' + chatDoc + '\n</chat_document>\n\n---\n\n' + userMessage
  }

  /**
   * Update the chat document after a turn completes.
   * Appends the exchange to Recent Exchanges.
   * If exchange count > 5: compresses oldest exchange into Summary/Project Context.
   * Saves to .singularity/chats/{chatId}/chat.md
   * Returns a Promise tracked internally so loadChatDoc can await it.
   */
  updateChatDoc(chatId, userMessage, quinnResponse) {
    const promise = this._doUpdate(chatId, userMessage, quinnResponse)
    this._pendingUpdates.set(chatId, promise)
    promise.finally(() => {
      if (this._pendingUpdates.get(chatId) === promise) {
        this._pendingUpdates.delete(chatId)
      }
    })
    return promise
  }

  async _doUpdate(chatId, userMessage, quinnResponse) {
    try {
      const docPath = this._chatDocPath(chatId)
      const existing = await readFile(docPath, 'utf8').catch(() => '')

      let doc
      if (!existing) {
        doc = this._createNewDoc(chatId, userMessage, quinnResponse)
      } else {
        doc = await this._appendExchange(existing, userMessage, quinnResponse)
      }

      await mkdir(join(this.projectRoot, '.singularity', 'chats', chatId), { recursive: true })
      await writeFile(docPath, doc, 'utf8')
      log.info('[gen5] Chat doc updated for ' + chatId.slice(0, 8) + ' (' + doc.length + ' chars)')
    } catch (err) {
      log.error('[gen5] Chat doc update failed for ' + chatId.slice(0, 8) + ': ' + err.message)
    }
  }

  /** Create a brand new chat document with the first exchange */
  _createNewDoc(chatId, userMessage, quinnResponse) {
    const now = new Date().toISOString()
    return [
      '# Quinn Chat \u2014 ' + chatId,
      '**Created:** ' + now,
      '**Last updated:** ' + now,
      '**Exchanges:** 1',
      '',
      '## Project Context',
      '',
      '',
      '## Conversation Summary',
      '',
      '',
      '## Recent Exchanges',
      '',
      '### Exchange 1',
      '**Adam:** ' + userMessage,
      '**Quinn:** ' + quinnResponse,
      ''
    ].join('\n')
  }

  /** Parse exchanges from the doc. Returns array of { num, content } */
  _parseExchanges(doc) {
    const exchanges = []
    const regex = /### Exchange (\d+)\n([\s\S]*?)(?=### Exchange \d+|$)/g
    let match
    while ((match = regex.exec(doc)) !== null) {
      exchanges.push({
        num: parseInt(match[1], 10),
        content: match[2].trim()
      })
    }
    return exchanges
  }

  /** Append a new exchange and compress if needed */
  async _appendExchange(doc, userMessage, quinnResponse) {
    const exchanges = this._parseExchanges(doc)
    const newNum = exchanges.length > 0 ? exchanges[exchanges.length - 1].num + 1 : 1
    const newExchange = '### Exchange ' + newNum + '\n**Adam:** ' + userMessage + '\n**Quinn:** ' + quinnResponse

    const now = new Date().toISOString()
    doc = doc.replace(/\*\*Last updated:\*\* .+/, '**Last updated:** ' + now)
    doc = doc.replace(/\*\*Exchanges:\*\* \d+/, '**Exchanges:** ' + newNum)

    doc = doc.trimEnd() + '\n\n' + newExchange + '\n'

    if (newNum > 5) {
      doc = await this._compress(doc)
    }

    return doc
  }

  /** Compress: move oldest exchange into summary via summarizer */
  async _compress(doc) {
    const exchanges = this._parseExchanges(doc)
    if (exchanges.length <= 5) return doc

    const oldest = exchanges[0]

    const adamMatch = oldest.content.match(/\*\*Adam:\*\* ([\s\S]*?)(?=\*\*Quinn:\*\*|$)/)
    const quinnMatch = oldest.content.match(/\*\*Quinn:\*\* ([\s\S]*)/)
    const adamText = adamMatch ? adamMatch[1].trim() : ''
    const quinnText = quinnMatch ? quinnMatch[1].trim() : ''

    const projectContextMatch = doc.match(/## Project Context\n([\s\S]*?)(?=## Conversation Summary)/)
    const summaryMatch = doc.match(/## Conversation Summary\n([\s\S]*?)(?=## Recent Exchanges)/)
    const existingProjectContext = projectContextMatch ? projectContextMatch[1].trim() : ''
    const existingSummary = summaryMatch ? summaryMatch[1].trim() : ''

    let updatedProjectContext = existingProjectContext
    let updatedSummary = existingSummary
    try {
      const result = await this._callSummarizer(existingProjectContext, existingSummary, adamText, quinnText)
      updatedProjectContext = result.projectContext
      updatedSummary = result.summary
    } catch (err) {
      log.warn('[gen5] Compression failed, keeping exchange verbatim: ' + err.message)
      return doc
    }

    const oldestHeader = '### Exchange ' + oldest.num
    const nextHeader = exchanges.length > 1 ? '### Exchange ' + exchanges[1].num : null
    if (nextHeader) {
      const start = doc.indexOf(oldestHeader)
      const end = doc.indexOf(nextHeader)
      if (start !== -1 && end !== -1) {
        doc = doc.slice(0, start) + doc.slice(end)
      }
    }

    doc = doc.replace(
      /## Project Context\n[\s\S]*?(?=## Conversation Summary)/,
      '## Project Context\n' + updatedProjectContext + '\n\n'
    )

    doc = doc.replace(
      /## Conversation Summary\n[\s\S]*?(?=## Recent Exchanges)/,
      '## Conversation Summary\n' + updatedSummary + '\n\n'
    )

    return doc
  }

  /** Call qwen2.5-coder:7b to compress an exchange into summary */
  async _callSummarizer(existingProjectContext, existingSummary, adamMessage, quinnResponse) {
    const prompt = [
      'You are compressing a conversation exchange into a running summary. Be brief and precise.',
      '',
      '### Current Project Context',
      existingProjectContext || '(none yet)',
      '',
      '### Current Conversation Summary',
      existingSummary || '(none yet)',
      '',
      '### Exchange to compress',
      'Adam: ' + adamMessage,
      'Quinn: ' + quinnResponse,
      '',
      '### Instructions',
      '1. Update the "Project Context" section: extract any file paths, architecture facts, technology choices, or key decisions Quinn mentioned. Merge with existing context. Keep it factual and concise (300 words max).',
      '2. Update the "Conversation Summary": integrate this exchange key events into the narrative arc. What was asked, what was found, what was decided. Keep it flowing prose (500 words max).',
      '',
      'Output in this exact format:',
      'PROJECT_CONTEXT:',
      '{updated project context text}',
      '',
      'CONVERSATION_SUMMARY:',
      '{updated conversation summary text}'
    ].join('\n')

    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:7b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { num_ctx: 8192 }
      })
    })

    if (!response.ok) {
      throw new Error('Summarizer HTTP ' + response.status + ': ' + await response.text())
    }

    const data = await response.json()
    const output = data.message?.content || ''

    const pcSplit = output.split('PROJECT_CONTEXT:')
    if (pcSplit.length < 2) {
      throw new Error('Summarizer output missing PROJECT_CONTEXT marker')
    }
    const afterPC = pcSplit[1]
    const csSplit = afterPC.split('CONVERSATION_SUMMARY:')
    if (csSplit.length < 2) {
      throw new Error('Summarizer output missing CONVERSATION_SUMMARY marker')
    }

    return {
      projectContext: csSplit[0].trim(),
      summary: csSplit[1].trim()
    }
  }
}
