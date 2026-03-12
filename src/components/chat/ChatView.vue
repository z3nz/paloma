<template>
  <div class="flex flex-col h-full">
    <MessageList
      :messages="messages"
      :streaming="streaming"
      :streaming-content="streamingContent"
      :tool-activity="toolActivity"
      :error="error"
      @apply-code="handleApplyCode"
    />
    <div v-if="contextWarning" class="px-4 py-2 bg-warning/10 border-t border-warning/30 text-sm text-warning text-center">
      {{ contextWarning }}
    </div>
    <PromptBuilder
      :session="session"
      :streaming="streaming"
      @send="handleSend"
      @stop="stopStreaming"
      @update-session="handleUpdateSession"
      @transition-phase="handleTransitionPhase"
    />

    <DiffPreview
      v-if="showDiff"
      :file-path="pendingEdit.path"
      :original-content="pendingEdit.originalContent"
      :new-content="pendingEdit.code"
      :error="editError"
      @apply="handleConfirmEdit"
      @cancel="handleCancelEdit"
    />

    <ToolConfirmation
      v-if="showToolConfirmation"
      :confirmation="activeToolConfirmation"
      @allow="handleToolAllow"
      @deny="handleToolDeny"
      @allow-session="handleToolAllowSession"
      @allow-always="handleToolAllowAlways"
      @allow-tool-session="handleToolAllowToolSession"
      @allow-tool-always="handleToolAllowToolAlways"
    />

    <AskUserDialog
      v-if="pendingAskUser"
      :ask-user="pendingAskUser"
      @respond="handleAskUserRespond"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MessageList from './MessageList.vue'
import PromptBuilder from '../prompt/PromptBuilder.vue'
import DiffPreview from './DiffPreview.vue'
import ToolConfirmation from './ToolConfirmation.vue'
import AskUserDialog from './AskUserDialog.vue'
import { useChat } from '../../composables/useChat.js'
import { useChanges } from '../../composables/useChanges.js'
import { useVoiceInput } from '../../composables/useVoiceInput.js'
import { useSettings } from '../../composables/useSettings.js'
import { useProject } from '../../composables/useProject.js'
import { useFileIndex } from '../../composables/useFileIndex.js'
import { useMCP, isMcpTool } from '../../composables/useMCP.js'
import { usePermissions } from '../../composables/usePermissions.js'
import { resolveEdit } from '../../services/editing.js'
import { handleSlashCommand } from '../../services/slashCommands.js'
import db from '../../services/db.js'

const props = defineProps({
  session: { type: Object, default: null }
})

const emit = defineEmits(['update-session', 'transition-phase'])

const {
  messages, streaming, streamingContent, toolActivity, error,
  pendingToolConfirmation, contextWarning, loadMessages, sendMessage, stopStreaming,
  resolveToolConfirmation, rejectToolConfirmation, clearChat
} = useChat()
const { detectChanges, loadSessionChanges } = useChanges()
const { voiceMode, isListening, startListening } = useVoiceInput()
const { apiKey } = useSettings()
const { dirHandle, projectRoot, projectInstructions, activePlans, roots, mcpConfig, refreshActivePlans } = useProject()
const { search: searchFiles } = useFileIndex()
const { callMcpTool, pendingAskUser, respondToAskUser, pendingCliToolConfirmation, approveCliTool, denyCliTool } = useMCP()
const { isAutoApproved, approveForSession, approveToolForSession } = usePermissions()

// Unified: show ToolConfirmation for either OpenRouter or CLI tool calls
const activeToolConfirmation = computed(() => {
  if (pendingToolConfirmation.value) return pendingToolConfirmation.value
  if (pendingCliToolConfirmation.value) return pendingCliToolConfirmation.value
  return null
})

const showToolConfirmation = ref(false)

watch(activeToolConfirmation, (confirmation) => {
  if (!confirmation) {
    showToolConfirmation.value = false
    return
  }
  if (isAutoApproved(confirmation.toolName, mcpConfig.value)) {
    handleToolAllow()
  } else {
    showToolConfirmation.value = true
  }
})

// Global ESC handler — stops streaming when no modal is open
function handleGlobalKeydown(e) {
  if (e.key === 'Escape' && streaming.value) {
    // Don't stop if a modal/dialog is open — let ESC close that instead
    if (showToolConfirmation.value || showDiff.value || pendingAskUser.value) return
    e.preventDefault()
    stopStreaming()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})

const showDiff = ref(false)
const pendingEdit = ref({ path: '', code: '', originalContent: null })
const editError = ref(null)

watch(
  () => props.session?.id,
  (id) => {
    if (import.meta.hot && id && messages.value.length > 0 && messages.value[0]?.sessionId === id) {
      // HMR — skip redundant loadMessages
    } else {
      loadMessages(id)
    }
    loadSessionChanges(id)
  },
  { immediate: true }
)

watch(streaming, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    const lastMsg = messages.value.findLast(m => m.role === 'assistant' && m.content)
    if (lastMsg?.content) {
      // detectChanges needs the project root to read original files via MCP
      detectChanges(lastMsg.content, dirHandle.value)
    }

    // Safety net — if recognition died while AI was responding, restart it
    if (voiceMode.value && !isListening.value) {
      setTimeout(() => startListening(), 300)
    }
  }
})

async function handleSend({ content, files }) {
  if (!props.session || !content.trim()) return

  // Check for slash commands — execute locally without API call
  const trimmedContent = content.trim()
  try {
    const cmd = await handleSlashCommand(trimmedContent, callMcpTool, projectRoot.value)
    if (cmd.handled) {
      // Handle special actions
      if (cmd.action === 'clear') {
        clearChat()
        await db.messages.where('sessionId').equals(props.session.id).delete()
        return
      }

      if (cmd.action === 'switch-model' && cmd.model) {
        emit('update-session', props.session.id, { model: cmd.model })
      }

      // Save user message
      const userMsg = {
        sessionId: props.session.id,
        role: 'user',
        content: trimmedContent,
        files: [],
        timestamp: Date.now()
      }
      const userMsgId = await db.messages.add(userMsg)
      userMsg.id = userMsgId
      messages.value.push(userMsg)

      // Inject response as assistant message
      const assistantMsg = {
        sessionId: props.session.id,
        role: 'assistant',
        content: cmd.response,
        files: [],
        timestamp: Date.now()
      }
      const assistantMsgId = await db.messages.add(assistantMsg)
      assistantMsg.id = assistantMsgId
      messages.value.push(assistantMsg)

      // Refresh active plans in case a transition happened
      await refreshActivePlans(callMcpTool)
      return
    }
  } catch (e) {
    // If it looks like a slash command but execution failed, still handle it locally
    if (trimmedContent.startsWith('/')) {
      const userMsg = {
        sessionId: props.session.id,
        role: 'user',
        content: trimmedContent,
        files: [],
        timestamp: Date.now()
      }
      const userMsgId = await db.messages.add(userMsg)
      userMsg.id = userMsgId
      messages.value.push(userMsg)

      const errorMsg = {
        sessionId: props.session.id,
        role: 'assistant',
        content: `Failed to execute command: ${e.message}`,
        files: [],
        timestamp: Date.now()
      }
      const errorMsgId = await db.messages.add(errorMsg)
      errorMsg.id = errorMsgId
      messages.value.push(errorMsg)
      return
    }
    console.error('[ChatView] Slash command error:', e)
  }

  const title = await sendMessage(
    props.session.id,
    content,
    files,
    apiKey.value,
    props.session.model,
    dirHandle.value,
    props.session.phase,
    projectInstructions.value,
    activePlans.value,
    searchFiles,
    mcpConfig.value,
    roots.value
  )

  if (title) {
    emit('update-session', props.session.id, { title })
  }
}

function handleUpdateSession(updates) {
  emit('update-session', props.session.id, updates)
}

function handleTransitionPhase({ phase, fromPhase }) {
  emit('transition-phase', { phase, fromPhase, sessionId: props.session?.id })
}

/** Read a file via MCP, returns content string or null */
async function mcpReadFile(filePath) {
  if (!projectRoot.value) return null
  try {
    const fullPath = `${projectRoot.value}/${filePath}`
    const result = await callMcpTool('mcp__filesystem__read_text_file', { path: fullPath })
    if (typeof result === 'string' && result.startsWith('{')) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.error) return null
      } catch { /* not JSON */ }
    }
    return result
  } catch {
    return null
  }
}

/** Write a file via MCP */
async function mcpWriteFile(filePath, content) {
  if (!projectRoot.value) throw new Error('No project root')
  const fullPath = `${projectRoot.value}/${filePath}`
  await callMcpTool('mcp__filesystem__write_file', { path: fullPath, content })
}

async function handleApplyCode({ path, code }) {
  editError.value = null
  // Try MCP first, fall back to dirHandle
  let originalContent = await mcpReadFile(path)
  if (originalContent === null && dirHandle.value) {
    try {
      const { readFileSafe } = await import('../../services/filesystem.js')
      originalContent = await readFileSafe(dirHandle.value, path)
    } catch { /* ignore */ }
  }
  try {
    const { newContent } = resolveEdit(code, originalContent)
    pendingEdit.value = { path, code: newContent, originalContent }
    showDiff.value = true
  } catch (err) {
    editError.value = err.message
    pendingEdit.value = { path, code: '', originalContent }
    showDiff.value = true
  }
}

async function handleConfirmEdit() {
  try {
    // Try MCP write first
    if (projectRoot.value) {
      await mcpWriteFile(pendingEdit.value.path, pendingEdit.value.code)
    } else if (dirHandle.value) {
      // Legacy fallback
      const { requestWritePermission, writeFile } = await import('../../services/filesystem.js')
      const granted = await requestWritePermission(dirHandle.value)
      if (!granted) {
        editError.value = 'Write permission denied.'
        return
      }
      await writeFile(dirHandle.value, pendingEdit.value.path, pendingEdit.value.code)
    } else {
      editError.value = 'No project context available to write files.'
      return
    }
    showDiff.value = false
    pendingEdit.value = { path: '', code: '', originalContent: null }
    editError.value = null
  } catch (err) {
    editError.value = `Failed to write file: ${err.message}`
  }
}

function handleCancelEdit() {
  showDiff.value = false
  pendingEdit.value = { path: '', code: '', originalContent: null }
  editError.value = null
}

async function handleToolAllow() {
  showToolConfirmation.value = false

  // CLI tool confirmation: proxy executes the tool server-side
  if (pendingCliToolConfirmation.value) {
    approveCliTool()
    return
  }

  // OpenRouter tool confirmation: browser executes the tool
  if (!pendingToolConfirmation.value) return
  const { toolName, args } = pendingToolConfirmation.value

  // All tools route through MCP now
  if (isMcpTool(toolName)) {
    try {
      const result = await callMcpTool(toolName, args)
      resolveToolConfirmation(result)
    } catch (err) {
      resolveToolConfirmation(JSON.stringify({ error: err.message }))
    }
    return
  }

  // Legacy browser-side write tools — fall back to dirHandle if available
  if (dirHandle.value) {
    try {
      const { executeWriteTool } = await import('../../services/tools.js')
      const result = await executeWriteTool(toolName, args, dirHandle.value)
      resolveToolConfirmation(result)
    } catch (err) {
      resolveToolConfirmation(JSON.stringify({ error: err.message }))
    }
  } else {
    resolveToolConfirmation(JSON.stringify({ error: `Tool "${toolName}" requires a project directory (use /project to load one)` }))
  }

  // Refresh active plans if a plan file was touched
  const affectedPath = args.path || args.fromPath || args.toPath || ''
  if (affectedPath.startsWith('.paloma/plans/')) {
    await refreshActivePlans(callMcpTool)
  }
}

function handleToolDeny() {
  showToolConfirmation.value = false
  if (pendingCliToolConfirmation.value) {
    denyCliTool('User denied')
  } else {
    rejectToolConfirmation('User denied')
  }
  // Deny kills the entire stream — save partial content and stop
  stopStreaming()
}

function handleToolAllowSession(serverName) {
  approveForSession(serverName)
  handleToolAllow()
}

async function handleToolAllowAlways(serverName) {
  approveForSession(serverName)

  // Persist to project config via MCP
  if (projectRoot.value && mcpConfig.value) {
    const autoExecute = mcpConfig.value.autoExecute || []
    if (!autoExecute.includes(serverName)) {
      mcpConfig.value = {
        ...mcpConfig.value,
        autoExecute: [...autoExecute, serverName]
      }
      try {
        const configPath = `${projectRoot.value}/.paloma/mcp.json`
        await callMcpTool('mcp__filesystem__write_file', {
          path: configPath,
          content: JSON.stringify(mcpConfig.value, null, 2) + '\n'
        })
      } catch (err) {
        console.warn('[Permissions] Failed to persist autoExecute:', err)
      }
    }
  }

  handleToolAllow()
}

function handleToolAllowToolSession({ server, tool }) {
  approveToolForSession(server, tool)
  handleToolAllow()
}

async function handleToolAllowToolAlways({ server, tool }) {
  approveToolForSession(server, tool)

  // Persist per-tool approval to mcp.json
  if (projectRoot.value && mcpConfig.value) {
    const autoExec = [...(mcpConfig.value.autoExecute || [])]
    const idx = autoExec.findIndex(e =>
      (typeof e === 'string' && e === server) || (e?.server === server)
    )

    if (idx === -1) {
      // No entry for this server — create allowlist
      autoExec.push({ server, tools: [tool] })
    } else if (typeof autoExec[idx] === 'string') {
      // Server already fully approved — tool is already covered
    } else {
      const entry = { ...autoExec[idx] }
      if (entry.tools && !entry.tools.includes(tool)) {
        entry.tools = [...entry.tools, tool]
        autoExec[idx] = entry
      } else if (entry.except) {
        entry.except = entry.except.filter(t => t !== tool)
        if (entry.except.length === 0) autoExec[idx] = server
        else autoExec[idx] = { ...entry }
      }
    }

    mcpConfig.value = { ...mcpConfig.value, autoExecute: autoExec }
    try {
      await callMcpTool('mcp__filesystem__write_file', {
        path: `${projectRoot.value}/.paloma/mcp.json`,
        content: JSON.stringify(mcpConfig.value, null, 2) + '\n'
      })
    } catch (err) {
      console.warn('[Permissions] Failed to persist per-tool autoExecute:', err)
    }
  }

  handleToolAllow()
}

function handleAskUserRespond(answer) {
  respondToAskUser(answer)
}
</script>
