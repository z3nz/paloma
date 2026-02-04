import { ref, watch } from 'vue'
import db from '../services/db.js'
import { streamChat } from '../services/openrouter.js'
import { readFile } from '../services/filesystem.js'
import { BASE_INSTRUCTIONS } from '../prompts/base.js'
import { PHASE_INSTRUCTIONS } from '../prompts/phases.js'

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

  async function sendMessage(sessionId, content, attachedFiles, apiKey, model, dirHandle, phase, projectInstructions) {
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

    // Layered system prompt: base + project + phase
    apiMessages.push({
      role: 'system',
      content: buildSystemPrompt(phase, projectInstructions)
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

  function buildSystemPrompt(phase, projectInstructions) {
    let prompt = BASE_INSTRUCTIONS

    if (projectInstructions) {
      prompt += '\n\n## Project Instructions\n\n' + projectInstructions
    }

    const activePhase = phase || 'research'
    prompt += '\n\n## Current Phase: ' + activePhase.charAt(0).toUpperCase() + activePhase.slice(1) + '\n\n'
    prompt += PHASE_INSTRUCTIONS[activePhase] || PHASE_INSTRUCTIONS.research

    return prompt
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
