<template>
  <div class="border-t border-border bg-bg-secondary px-4 py-3 relative">
    <!-- File search dropdown -->
    <FileSearch
      ref="fileSearchRef"
      :visible="showFileSearch"
      :results="fileSearchResults"
      :query="fileSearchQuery"
      @select="onFileSelect"
      @close="closeFileSearch"
    />

    <!-- Slash command menu (first level: type / to see commands) -->
    <SlashCommandMenu
      ref="slashMenuRef"
      :visible="showSlashMenu"
      :commands="slashCommands"
      :query="slashMenuQuery"
      @select="onSlashCommandSelect"
      @close="closeSlashMenu"
    />

    <!-- Plan search dropdown (second level: after selecting /plan) -->
    <PlanSearch
      ref="planSearchRef"
      :visible="showPlanSearch"
      :items="planItems"
      :query="planSearchQuery"
      :loading="plansLoading"
      :mode="planMode"
      @select="onPlanSelect"
      @close="closePlanSearch"
    />

    <!-- Project search dropdown (second level: after selecting /project) -->
    <ProjectSearch
      ref="projectSearchRef"
      :visible="showProjectSearch"
      :projects="projectList"
      :query="projectSearchQuery"
      :loading="projectsLoading"
      :current-project="currentProject"
      @select="onProjectSelect"
      @close="closeProjectSearch"
    />

    <!-- Attached files -->
    <div v-if="attachedFiles.length > 0" class="flex flex-wrap gap-1.5 mb-2">
      <FileChip
        v-for="(file, i) in attachedFiles"
        :key="file.path"
        :file="file"
        @remove="attachedFiles.splice(i, 1)"
      />
    </div>

    <!-- Textarea -->
    <div class="relative">
      <textarea
        ref="textareaRef"
        v-model="input"
        @input="onInput"
        @keydown="onKeydown"
        placeholder="Message Paloma... (@ attach files, / commands, Ctrl+Enter send)"
        class="prompt-textarea w-full bg-bg-primary border border-border rounded-lg px-4 py-3 pr-12 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
        rows="1"
      />
      <!-- Send / Stop button -->
      <button
        v-if="streaming"
        @click="$emit('stop')"
        class="absolute right-3 bottom-3 p-1.5 bg-danger/20 text-danger rounded-md hover:bg-danger/30 transition-colors"
        title="Stop"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1"/>
        </svg>
      </button>
      <button
        v-else
        @click="send"
        :disabled="!canSend"
        class="absolute right-3 bottom-3 p-1.5 rounded-md transition-colors"
        :class="canSend
          ? 'bg-accent text-white hover:bg-accent-hover'
          : 'bg-bg-tertiary text-text-muted cursor-not-allowed'"
        title="Send (Ctrl+Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <!-- Controls row -->
    <div class="flex items-center justify-between mt-2">
      <div class="flex items-center gap-3">
        <ModelSelector
          :model-value="currentModel"
          :models="models"
          @update:model-value="onModelChange"
        />
        <PhaseSelector
          :model-value="currentPhase"
          @update:model-value="onPhaseChange"
        />
      </div>
      <div class="text-xs text-text-muted">
        <span v-if="modelsError" class="text-warning" title="Using cached/fallback model list">Models: offline</span>
        <span v-else-if="indexing">Indexing files...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import FileSearch from './FileSearch.vue'
import FileChip from './FileChip.vue'
import PlanSearch from './PlanSearch.vue'
import ProjectSearch from './ProjectSearch.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import ModelSelector from './ModelSelector.vue'
import PhaseSelector from './PhaseSelector.vue'
import { useFileIndex } from '../../composables/useFileIndex.js'
import { useOpenRouter } from '../../composables/useOpenRouter.js'
import { useProject } from '../../composables/useProject.js'
import { useMCP } from '../../composables/useMCP.js'
import db from '../../services/db.js'

const props = defineProps({
  session: { type: Object, default: null },
  streaming: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'stop', 'update-session', 'transition-phase'])

const { search, indexing } = useFileIndex()
const { models, modelsError } = useOpenRouter()
const { switchProject, listProjects, projectName: currentProject, projectRoot: currentProjectRoot } = useProject()
const { callMcpTool, resolveProjectPath, connected: mcpConnected } = useMCP()

const input = ref('')
const attachedFiles = ref([])
const textareaRef = ref(null)
const fileSearchRef = ref(null)
const projectSearchRef = ref(null)
const slashMenuRef = ref(null)

const showFileSearch = ref(false)
const fileSearchQuery = ref('')
const fileSearchResults = ref([])  

const showSlashMenu = ref(false)
const slashMenuQuery = ref('')

const showProjectSearch = ref(false)
const projectSearchQuery = ref('')
const projectList = ref([])
const projectsLoading = ref(false)

const showPlanSearch = ref(false)
const planSearchQuery = ref('')
const planItems = ref([])
const plansLoading = ref(false)
const planMode = ref('list') // 'list' | 'activate' | 'pause' | 'complete' | 'archive'
const planSearchRef = ref(null)
let planAction = null // tracks what action to take on selection

// Available slash commands
const slashCommands = [
  { name: 'plan', description: 'List and manage plans' },
  { name: 'project', description: 'Switch project context' },
  { name: 'model', description: 'Switch AI model' },
  { name: 'clear', description: 'Clear current chat' },
  { name: 'help', description: 'Show commands and shortcuts' }
]

// Track trigger positions for replacement
let atStartIndex = -1
let slashStartIndex = -1

const currentModel = computed(() => props.session?.model || '')
const currentPhase = computed(() => props.session?.phase || 'research')
const canSend = computed(() => input.value.trim().length > 0 && !props.streaming)

// --- Draft persistence ---
let saveTimeout = null
let suppressSave = false

async function saveDraftNow(sessionId) {
  if (!sessionId) return
  try {
    const existing = await db.drafts.get(sessionId)
    await db.drafts.put({
      sessionId,
      ...existing,
      content: input.value,
      files: attachedFiles.value.map(f => ({ path: f.path, name: f.name })),
      updatedAt: Date.now()
    })
  } catch {
    // Best-effort persistence — UI continues working without storage
  }
}

function scheduleDraftSave() {
  if (suppressSave) return
  clearTimeout(saveTimeout)
  const sessionId = props.session?.id
  if (!sessionId) return
  saveTimeout = setTimeout(() => saveDraftNow(sessionId), 500)
}

watch([input, attachedFiles], scheduleDraftSave, { deep: true })

// Load draft on session switch, save outgoing draft first
watch(
  () => props.session?.id,
  async (sessionId, oldSessionId) => {
    // Save draft for outgoing session
    if (oldSessionId) {
      clearTimeout(saveTimeout)
      await saveDraftNow(oldSessionId)
    }

    // Load draft for incoming session
    suppressSave = true
    if (!sessionId) {
      input.value = ''
      attachedFiles.value = []
    } else {
      const draft = await db.drafts.get(sessionId)
      input.value = draft?.content || ''
      attachedFiles.value = draft?.files || []
    }
    await nextTick()
    suppressSave = false
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearTimeout(saveTimeout)
  // Flush on unmount
  const sessionId = props.session?.id
  if (sessionId) saveDraftNow(sessionId)
})

// Auto-grow textarea
watch(input, () => {
  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 192) + 'px'
    }
  })
})

function onInput() {
  const el = textareaRef.value
  if (!el) return

  const cursorPos = el.selectionStart
  const textBeforeCursor = input.value.slice(0, cursorPos)

  // Check for /plan<space> trigger (second level — user selected /plan command)
  // Matches: /plan <query>, /plan activate <query>, /plan pause <query>, etc.
  const planActionMatch = textBeforeCursor.match(/(^|\s)(\/plan\s+(?:activate|pause|complete|archive)\s+)(\S*)$/i)
  const planListMatch = !planActionMatch && textBeforeCursor.match(/(^|\s)(\/plan\s+)(\S*)$/i)
  if (planActionMatch) {
    slashStartIndex = cursorPos - planActionMatch[2].length - planActionMatch[3].length
    const action = planActionMatch[2].trim().split(/\s+/)[1] // 'activate', 'pause', etc.
    planSearchQuery.value = planActionMatch[3]
    planMode.value = action
    planAction = action
    const wasVisible = showPlanSearch.value
    showPlanSearch.value = true
    showSlashMenu.value = false
    showFileSearch.value = false
    showProjectSearch.value = false
    if (!wasVisible && !plansLoading.value) {
      loadPlanList(action)
    }
    return
  } else if (planListMatch) {
    slashStartIndex = cursorPos - planListMatch[2].length - planListMatch[3].length
    planSearchQuery.value = planListMatch[3]
    planMode.value = 'list'
    planAction = null
    const wasVisible = showPlanSearch.value
    showPlanSearch.value = true
    showSlashMenu.value = false
    showFileSearch.value = false
    showProjectSearch.value = false
    if (!wasVisible && !plansLoading.value) {
      loadPlanList('list')
    }
    return
  } else {
    showPlanSearch.value = false
    planSearchQuery.value = ''
  }

  // Check for /project<space> trigger (second level — user selected /project command)
  const projectMatch = textBeforeCursor.match(/(^|\s)(\/project\s+)(\S*)$/i)
  if (projectMatch) {
    slashStartIndex = cursorPos - projectMatch[2].length - projectMatch[3].length
    projectSearchQuery.value = projectMatch[3]
    const wasVisible = showProjectSearch.value
    showProjectSearch.value = true
    showSlashMenu.value = false
    showFileSearch.value = false
    if (!wasVisible && !projectsLoading.value) {
      loadProjectList()
    }
    return
  } else {
    showProjectSearch.value = false
    projectSearchQuery.value = ''
  }

  // Check for / trigger (first level — command menu)
  const slashMatch = textBeforeCursor.match(/(^|\s)(\/\S*)$/)
  if (slashMatch) {
    slashStartIndex = cursorPos - slashMatch[2].length
    // Strip the leading / to get the query
    slashMenuQuery.value = slashMatch[2].slice(1)
    showSlashMenu.value = true
    showFileSearch.value = false
    return
  } else {
    showSlashMenu.value = false
    slashMenuQuery.value = ''
    slashStartIndex = -1
  }

  // Check for @ trigger
  const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)
  if (atMatch) {
    atStartIndex = cursorPos - atMatch[0].length
    fileSearchQuery.value = atMatch[1]
    fileSearchResults.value = search(atMatch[1])
    showFileSearch.value = true
  } else {
    showFileSearch.value = false
    fileSearchQuery.value = ''
    atStartIndex = -1
  }
}

async function loadProjectList() {
  if (!mcpConnected.value) return
  projectsLoading.value = true
  try {
    const root = currentProjectRoot.value
      ? currentProjectRoot.value.replace(/\/projects\/[^/]+$/, '')
      : '/home/adam/paloma'
    projectList.value = await listProjects(callMcpTool, root)
  } catch (e) {
    console.warn('[PromptBuilder] Failed to load projects:', e)
    projectList.value = ['paloma']
  } finally {
    projectsLoading.value = false
  }
}

const STATUS_ICONS = { active: '🟢', paused: '⏸️', draft: '📝', completed: '✅', archived: '📦' }

async function loadPlanList(mode) {
  if (!mcpConnected.value || !currentProjectRoot.value) {
    planItems.value = []
    return
  }
  plansLoading.value = true
  try {
    const plansDir = `${currentProjectRoot.value}/.paloma/plans`
    const result = await callMcpTool('mcp__filesystem__list_directory', { path: plansDir })
    const entries = []
    if (typeof result === 'string') {
      for (const line of result.split('\n')) {
        const fileMatch = line.match(/^\[FILE\]\s+(.+)/)
        if (fileMatch) entries.push(fileMatch[1].trim())
      }
    }

    // Parse plan filenames
    const plans = []
    for (const filename of entries) {
      const match = filename.match(/^(active|paused|draft|completed|archived)-(\d{8})-([^-]+)-(.+)\.md$/)
      if (match) {
        plans.push({
          status: match[1],
          date: match[2],
          scope: match[3],
          slug: match[4],
          filename,
          id: `${match[3]}-${match[4]}`,
          label: match[4].replace(/-/g, ' '),
          icon: STATUS_ICONS[match[1]] || '📄'
        })
      }
    }

    // Filter by mode — show plans that can receive this action
    let filtered
    switch (mode) {
      case 'activate':
        filtered = plans.filter(p => p.status !== 'active')
        break
      case 'pause':
        filtered = plans.filter(p => p.status === 'active')
        break
      case 'complete':
        filtered = plans.filter(p => p.status !== 'completed')
        break
      case 'archive':
        filtered = plans.filter(p => p.status !== 'archived')
        break
      default:
        filtered = plans
    }

    // Sort: active first, then paused, draft, completed, archived
    const order = { active: 0, paused: 1, draft: 2, completed: 3, archived: 4 }
    filtered.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))

    planItems.value = filtered
  } catch (e) {
    console.warn('[PromptBuilder] Failed to load plans:', e)
    planItems.value = []
  } finally {
    plansLoading.value = false
  }
}

async function onPlanSelect(item) {
  // Handle action items — fill in the action and show filtered plans
  if (item.type === 'action') {
    // Replace current input with /plan <action> and re-trigger
    const startPos = slashStartIndex >= 0 ? slashStartIndex : 0
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    const before = input.value.slice(0, startPos)
    const after = input.value.slice(cursorPos)
    input.value = before + '/plan ' + item.action + ' ' + after

    showPlanSearch.value = false

    nextTick(() => {
      const newPos = startPos + '/plan '.length + item.action.length + 1
      textareaRef.value?.setSelectionRange(newPos, newPos)
      onInput()
    })
    return
  }

  // Capture action before closePlanSearch() clears it
  const action = planAction

  // Clear the input
  if (slashStartIndex >= 0) {
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    input.value = input.value.slice(0, slashStartIndex) + input.value.slice(cursorPos)
  }

  closePlanSearch()

  // If no action (list mode, user selected a plan), send /plan to list all
  if (!action) {
    emit('send', { content: `/plan`, files: [] })
    textareaRef.value?.focus()
    return
  }

  // Execute the transition: /plan <action> <id>
  emit('send', { content: `/plan ${action} ${item.id}`, files: [] })
  textareaRef.value?.focus()
}

function closePlanSearch() {
  showPlanSearch.value = false
  planSearchQuery.value = ''
  planMode.value = 'list'
  planAction = null
  slashStartIndex = -1
}

function onKeydown(e) {
  // Let file search handle keys first
  if (showFileSearch.value && fileSearchRef.value?.handleKeydown(e)) {
    return
  }

  // Let slash command menu handle keys
  if (showSlashMenu.value && slashMenuRef.value?.handleKeydown(e)) {
    return
  }

  // Let plan search handle keys
  if (showPlanSearch.value && planSearchRef.value?.handleKeydown(e)) {
    return
  }

  // Let project search handle keys
  if (showProjectSearch.value && projectSearchRef.value?.handleKeydown(e)) {
    return
  }

  // Safety net: if any dropdown is open but its handler didn't catch Enter,
  // prevent Enter from inserting a newline or doing anything unexpected
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    if (showPlanSearch.value || showProjectSearch.value || showSlashMenu.value || showFileSearch.value) {
      e.preventDefault()
      return
    }
  }

  // Ctrl+Enter to send
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    send()
  }
}

function onFileSelect(file) {
  // Avoid duplicates
  if (!attachedFiles.value.find(f => f.path === file.path)) {
    attachedFiles.value.push({ path: file.path, name: file.name })
  }

  // Remove @query from input
  if (atStartIndex >= 0) {
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    input.value = input.value.slice(0, atStartIndex) + input.value.slice(cursorPos)
  }

  closeFileSearch()
  textareaRef.value?.focus()
}

function closeFileSearch() {
  showFileSearch.value = false
  fileSearchQuery.value = ''
  fileSearchResults.value = []
  atStartIndex = -1
}

function onSlashCommandSelect(cmd) {
  // Replace the partial /text with the full command + space
  if (slashStartIndex >= 0) {
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    const before = input.value.slice(0, slashStartIndex)
    const after = input.value.slice(cursorPos)
    input.value = before + '/' + cmd.name + ' ' + after

    // Position cursor right after the command + space
    nextTick(() => {
      const newPos = slashStartIndex + cmd.name.length + 2 // / + name + space
      textareaRef.value?.setSelectionRange(newPos, newPos)
      // Trigger onInput to transition into the command's sub-menu
      onInput()
    })
  }

  closeSlashMenu()
}

function closeSlashMenu() {
  showSlashMenu.value = false
  slashMenuQuery.value = ''
}

async function onProjectSelect(projectName) {
  // Remove /project text from input
  if (slashStartIndex >= 0) {
    const cursorPos = textareaRef.value?.selectionStart || input.value.length
    input.value = input.value.slice(0, slashStartIndex) + input.value.slice(cursorPos)
  }

  closeProjectSearch()

  // Switch project
  try {
    await switchProject(projectName, callMcpTool, resolveProjectPath)
    // Emit session update so App.vue can reload sessions for the new project
    emit('update-session', { projectSwitch: projectName })
  } catch (e) {
    console.error('[PromptBuilder] Project switch failed:', e)
  }

  textareaRef.value?.focus()
}

function closeProjectSearch() {
  showProjectSearch.value = false
  projectSearchQuery.value = ''
  slashStartIndex = -1
}

async function send() {
  if (!canSend.value) return

  const text = input.value.trim()

  emit('send', {
    content: text,
    files: [...attachedFiles.value]
  })

  input.value = ''
  attachedFiles.value = []

  // Clear draft immediately (no debounce)
  clearTimeout(saveTimeout)
  const sessionId = props.session?.id
  if (sessionId) saveDraftNow(sessionId)

  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
      el.focus()
    }
  })
}

function onModelChange(model) {
  emit('update-session', { model })
}

function onPhaseChange(phase) {
  emit('transition-phase', { phase, fromPhase: currentPhase.value })
}
</script>
