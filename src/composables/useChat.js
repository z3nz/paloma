import { ref, watch } from 'vue'
import db from '../services/db.js'
import { streamChat } from '../services/openrouter.js'
import { readFile } from '../services/filesystem.js'

const messages = ref([])
const streaming = ref(false)
const streamingContent = ref('')
const error = ref(null)
let abortController = null

export function useChat() {
  async function loadMessages(sessionId) {
    if (!sessionId) {
      messages.value = []
      return
    }
    const result = await db.messages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp')
    messages.value = result
  }

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase) {
    error.value = null

    // Build file contents for attached files
    const fileContents = []
    if (dirHandle && attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const text = await readFile(dirHandle, file.path)
          fileContents.push({ path: file.path, content: text })
        } catch (e) {
          fileContents.push({ path: file.path, content: `[Error reading file: ${e.message}]` })
        }
      }
    }

    // Build user message content with file contents
    let fullContent = ''
    if (fileContents.length > 0) {
      fullContent += fileContents.map(f =>
        `<file path="${f.path}">\n${f.content}\n</file>`
      ).join('\n\n')
      fullContent += '\n\n'
    }
    fullContent += content

    // Save user message
    const userMsg = {
      sessionId,
      role: 'user',
      content: fullContent,
      files: attachedFiles.map(f => ({ path: f.path, name: f.name })),
      timestamp: Date.now()
    }
    const userMsgId = await db.messages.add(userMsg)
    userMsg.id = userMsgId
    messages.value.push(userMsg)

    // Build messages array for API
    const apiMessages = []

    // System prompt based on phase
    const phasePrompts = {
      research: 'You are a helpful AI assistant. The user is in the research phase - help them explore, understand, and investigate.',
      plan: 'You are a helpful AI assistant. The user is in the planning phase - help them design solutions, create plans, and think through architecture.',
      implement: 'You are a helpful AI assistant. The user is in the implementation phase - help them write code, implement features, and build solutions.',
      review: 'You are a helpful AI assistant. The user is in the review phase - help them review code, find issues, and suggest improvements.',
      commit: 'You are a helpful AI assistant. The user is in the commit phase - help them write commit messages, changelogs, and documentation.'
    }

    apiMessages.push({
      role: 'system',
      content: phasePrompts[phase] || phasePrompts.research
    })

    // Add conversation history
    for (const msg of messages.value) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        apiMessages.push({ role: msg.role, content: msg.content })
      }
    }

    // Stream response
    streaming.value = true
    streamingContent.value = ''
    abortController = new AbortController()

    try {
      for await (const chunk of streamChat(apiKey, model, apiMessages)) {
        streamingContent.value += chunk
      }

      // Save assistant message
      const assistantMsg = {
        sessionId,
        role: 'assistant',
        content: streamingContent.value,
        files: [],
        timestamp: Date.now()
      }
      const assistantMsgId = await db.messages.add(assistantMsg)
      assistantMsg.id = assistantMsgId
      messages.value.push(assistantMsg)

      // Auto-generate title from first exchange
      if (messages.value.filter(m => m.role === 'user').length === 1) {
        return generateTitle(content)
      }
    } catch (e) {
      error.value = e.message
    } finally {
      streaming.value = false
      streamingContent.value = ''
      abortController = null
    }

    return null
  }

  function generateTitle(firstMessage) {
    // Simple title from first message
    const title = firstMessage.slice(0, 50).trim()
    return title + (firstMessage.length > 50 ? '...' : '')
  }

  function stopStreaming() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    streaming.value = false
  }

  function clearChat() {
    messages.value = []
    streamingContent.value = ''
    error.value = null
  }

  return {
    messages,
    streaming,
    streamingContent,
    error,
    loadMessages,
    sendMessage,
    stopStreaming,
    clearChat
  }
}
