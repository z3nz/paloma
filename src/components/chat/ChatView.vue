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
    />

    <AskUserDialog
      v-if="pendingAskUser"
      :ask-user="pendingAskUser"
      @respond="handleAskUserRespond"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import MessageList from './MessageList.vue'
import PromptBuilder from '../prompt/PromptBuilder.vue'
import DiffPreview from './DiffPreview.vue'
import ToolConfirmation from './ToolConfirmation.vue'
import AskUserDialog from './AskUserDialog.vue'
import { useChat } from '../../composables/useChat.js'
import { useChanges } from '../../composables/useChanges.js'
import { useSettings } from '../../composables/useSettings.js'
import { useProject } from '../../composables/useProject.js'
import { useFileIndex } from '../../composables/useFileIndex.js'
import { useMCP, isMcpTool } from '../../composables/useMCP.js'
import { usePermissions } from '../../composables/usePermissions.js'
import { readFileSafe, requestWritePermission, writeFile, writeMcpConfig } from '../../services/filesystem.js'
import { resolveEdit } from '../../services/editing.js'
import { executeWriteTool } from '../../services/tools.js'

const props = defineProps({
  session: { type: Object, default: null }
})

const emit = defineEmits(['update-session'])

const {
  messages, streaming, streamingContent, toolActivity, error,
  pendingToolConfirmation, contextWarning, loadMessages, sendMessage, stopStreaming,
  resolveToolConfirmation, rejectToolConfirmation
} = useChat()
const { detectChanges, loadSessionChanges } = useChanges()
const { apiKey } = useSettings()
const { dirHandle, projectInstructions, activePlans, mcpConfig, refreshActivePlans } = useProject()
const { search: searchFiles, updatePaths } = useFileIndex()
const { callMcpTool, pendingAskUser, respondToAskUser, pendingCliToolConfirmation, approveCliTool, denyCliTool } = useMCP()
const { isAutoApproved, approveForSession } = usePermissions()

// Unified: show ToolConfirmation for either OpenRouter or CLI tool calls
const activeToolConfirmation = computed(() => {
  if (pendingToolConfirmation.value) return pendingToolConfirmation.value
  if (pendingCliToolConfirmation.value) return pendingCliToolConfirmation.value
  return null
})

// Only show the dialog if the tool isn't auto-approved
const showToolConfirmation = ref(false)

// When a new tool confirmation arrives, check permissions before showing dialog
watch(activeToolConfirmation, (confirmation) => {
  if (!confirmation) {
    showToolConfirmation.value = false
    return
  }
  if (isAutoApproved(confirmation.toolName, mcpConfig.value)) {
    // Auto-approve without showing dialog
    handleToolAllow()
  } else {
    showToolConfirmation.value = true
  }
})

const showDiff = ref(false)
const pendingEdit = ref({ path: '', code: '', originalContent: null })
const editError = ref(null)

watch(
  () => props.session?.id,
  (id) => {
    if (import.meta.hot && id && messages.value.length > 0 && messages.value[0]?.sessionId === id) {
      console.log('[HMR] ChatView — skipping redundant loadMessages')
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
    if (lastMsg?.content && dirHandle.value) {
      detectChanges(lastMsg.content, dirHandle.value)
    }
  }
})

async function handleSend({ content, files }) {
  if (!props.session || !content.trim()) return

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
    mcpConfig.value
  )

  if (title) {
    emit('update-session', props.session.id, { title })
  }
}

function handleUpdateSession(updates) {
  emit('update-session', props.session.id, updates)
}

async function handleApplyCode({ path, code }) {
  editError.value = null
  const originalContent = dirHandle.value
    ? await readFileSafe(dirHandle.value, path)
    : null
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
  if (!dirHandle.value) {
    editError.value = 'No project directory open.'
    return
  }
  try {
    const granted = await requestWritePermission(dirHandle.value)
    if (!granted) {
      editError.value = 'Write permission denied. Please grant access and try again.'
      return
    }
    await writeFile(dirHandle.value, pendingEdit.value.path, pendingEdit.value.code)
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

function getPathUpdatesForTool(toolName, args) {
  switch (toolName) {
    case 'createFile': return [{ action: 'add', path: args.path }]
    case 'deleteFile': return [{ action: 'remove', path: args.path }]
    case 'moveFile': return [{ action: 'move', fromPath: args.fromPath, toPath: args.toPath }]
    default: return args.path ? [{ action: 'update', path: args.path }] : []
  }
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

  if (isMcpTool(toolName)) {
    try {
      const result = await callMcpTool(toolName, args)
      resolveToolConfirmation(result)
    } catch (err) {
      resolveToolConfirmation(JSON.stringify({ error: err.message }))
    }
    return
  }

  if (!dirHandle.value) return
  try {
    const result = await executeWriteTool(toolName, args, dirHandle.value)
    resolveToolConfirmation(result)
    // Incrementally update file index after write operations
    const pathUpdates = getPathUpdatesForTool(toolName, args)
    if (pathUpdates.length > 0) {
      await updatePaths(dirHandle.value, pathUpdates)
    }
    // Refresh active plans if a plan file was touched
    const affectedPath = args.path || args.fromPath || args.toPath || ''
    if (affectedPath.startsWith('.paloma/plans/')) {
      await refreshActivePlans()
    }
  } catch (err) {
    resolveToolConfirmation(JSON.stringify({ error: err.message }))
  }
}

function handleToolDeny() {
  showToolConfirmation.value = false
  if (pendingCliToolConfirmation.value) {
    denyCliTool('User denied')
    return
  }
  rejectToolConfirmation('User denied')
}

function handleToolAllowSession(serverName) {
  approveForSession(serverName)
  handleToolAllow()
}

async function handleToolAllowAlways(serverName) {
  // Add to session approvals for immediate effect
  approveForSession(serverName)

  // Persist to project config
  if (dirHandle.value && mcpConfig.value) {
    const autoExecute = mcpConfig.value.autoExecute || []
    if (!autoExecute.includes(serverName)) {
      mcpConfig.value = {
        ...mcpConfig.value,
        autoExecute: [...autoExecute, serverName]
      }
      try {
        await writeMcpConfig(dirHandle.value, mcpConfig.value)
      } catch (err) {
        console.warn('[Permissions] Failed to persist autoExecute:', err)
      }
    }
  }

  handleToolAllow()
}

function handleAskUserRespond(answer) {
  respondToAskUser(answer)
}
</script>
