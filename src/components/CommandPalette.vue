<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div ref="paletteRef" role="dialog" aria-label="Command palette" class="relative w-full max-w-lg bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden">
      <!-- Search input -->
      <div class="flex items-center border-b border-border px-4 py-3">
        <!-- Back arrow for sub-view -->
        <button v-if="subView" @click="exitSubView" class="shrink-0 text-text-muted hover:text-text-secondary mr-1 text-sm">
          ←
        </button>
        <!-- Sub-view breadcrumb -->
        <span v-if="subView" class="shrink-0 text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded mr-2">
          {{ subView.plan.slug.replace(/-/g, ' ') }}
        </span>
        <svg v-if="!subView" class="w-4 h-4 text-text-muted mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :placeholder="placeholder"
          class="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder-text-muted"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          :aria-expanded="flatItems.length > 0"
          :aria-activedescendant="flatItems[selectedIndex]?.id ? `cmd-item-${flatItems[selectedIndex].id}` : undefined"
          aria-controls="cmd-palette-list"
          @keydown="handleKeydown"
        />
        <kbd class="ml-2 text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border">esc</kbd>
      </div>

      <!-- Results -->
      <div id="cmd-palette-list" role="listbox" aria-label="Commands" class="max-h-72 overflow-y-auto py-1">
        <template v-for="category in visibleCategories" :key="category.id">
          <div class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            {{ category.label }}
          </div>
          <button
            v-for="item in category.items"
            :key="item.id"
            :id="`cmd-item-${item.id}`"
            role="option"
            :aria-selected="flatItems[selectedIndex]?.id === item.id"
            :data-selected="flatItems[selectedIndex]?.id === item.id"
            :class="[
              'w-full flex items-center px-4 py-2 text-sm text-left transition-colors group',
              flatItems[selectedIndex]?.id === item.id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-primary'
            ]"
            @click="executeItem(item)"
            @mouseenter="selectedIndex = flatItems.indexOf(item)"
          >
            <!-- Icon -->
            <span class="w-5 h-5 mr-3 flex items-center justify-center text-xs shrink-0"
                  :class="item.badgeColor || 'text-text-muted'">
              {{ item.icon }}
            </span>
            <!-- Label + Description -->
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ item.label }}</div>
              <div v-if="item.description" class="text-[11px] text-text-muted truncate">{{ item.description }}</div>
            </div>
            <!-- Badge -->
            <span v-if="item.badge" class="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-border shrink-0"
                  :class="item.badgeColor || 'text-text-muted'">
              {{ item.badge }}
            </span>
            <!-- Shortcut -->
            <kbd v-if="item.shortcut" class="ml-2 text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border shrink-0">
              {{ item.shortcut }}
            </kbd>
          </button>
        </template>

        <!-- Plan error -->
        <div v-if="planError" class="px-4 py-2 text-xs text-red-400">{{ planError }}</div>

        <!-- Empty state -->
        <div v-if="flatItems.length === 0 && !planError" class="px-4 py-8 text-center text-text-muted text-sm">
          {{ emptyMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useSessions } from '../composables/useSessions.js'
import { useMCP } from '../composables/useMCP.js'
import { useProject } from '../composables/useProject.js'

const emit = defineEmits(['close', 'select-session', 'new-chat', 'open-settings', 'spawn-pillar', 'inject-message', 'toggle-sidebar'])

const inputRef = ref(null)
const paletteRef = ref(null)
const query = ref('')
const selectedIndex = ref(0)
const subView = ref(null)      // null = top-level, { type: 'plan-actions', plan } = drill-down
const allPlans = ref([])
const planError = ref(null)

const { sessions } = useSessions()
const { callMcpTool } = useMCP()
const { projectRoot, refreshActivePlans } = useProject()

// --- Constants ---

const SELF_IMPROVE_PROMPT = `I want you to enter SELF-IMPROVE mode. Analyze Paloma's codebase, identify improvements worth making, and execute them autonomously. Spawn pillars as needed — Scout to find opportunities, Chart to plan them, Forge to build them. Keep going until you run out of context. Prioritize: code quality, UX polish, performance, and developer experience. Be bold. Be thorough. Make Paloma better.`

const PLAN_STATUS = {
  active:    { icon: '●', color: 'text-green-400' },
  paused:    { icon: '⏸', color: 'text-yellow-400' },
  draft:     { icon: '○', color: 'text-text-muted' },
  completed: { icon: '✓', color: 'text-blue-400' },
  archived:  { icon: '▪', color: 'text-text-muted' }
}

const STATUS_VERBS = {
  active: 'Activate',
  paused: 'Pause',
  draft: 'Move to Draft',
  completed: 'Complete',
  archived: 'Archive'
}

const STATUS_ORDER = ['active', 'paused', 'draft', 'completed', 'archived']

// --- Static commands ---

const staticCommands = [
  // Navigation
  { id: 'nav:new-chat', category: 'navigation', label: 'New Chat', icon: '+', shortcut: 'Ctrl+N', execute: () => { emit('new-chat'); emit('close') } },
  { id: 'nav:settings', category: 'navigation', label: 'Settings', icon: '⚙', execute: () => { emit('open-settings'); emit('close') } },
  { id: 'nav:toggle-sidebar', category: 'navigation', label: 'Toggle Sidebar', icon: '◧', shortcut: 'Ctrl+/', execute: () => { emit('toggle-sidebar'); emit('close') } },
  // Pillars
  { id: 'pillar:scout', category: 'pillars', label: 'Spawn Scout', description: 'Research and investigate', icon: '◈', badgeColor: 'text-green-400', execute: () => { emit('spawn-pillar', 'scout'); emit('close') } },
  { id: 'pillar:chart', category: 'pillars', label: 'Spawn Chart', description: 'Design and plan', icon: '▣', badgeColor: 'text-yellow-400', execute: () => { emit('spawn-pillar', 'chart'); emit('close') } },
  { id: 'pillar:forge', category: 'pillars', label: 'Spawn Forge', description: 'Build and implement', icon: '✦', badgeColor: 'text-orange-400', execute: () => { emit('spawn-pillar', 'forge'); emit('close') } },
  { id: 'pillar:polish', category: 'pillars', label: 'Spawn Polish', description: 'Review and test', icon: '◇', badgeColor: 'text-purple-400', execute: () => { emit('spawn-pillar', 'polish'); emit('close') } },
  { id: 'pillar:ship', category: 'pillars', label: 'Spawn Ship', description: 'Commit and deliver', icon: '⚐', badgeColor: 'text-cyan-400', execute: () => { emit('spawn-pillar', 'ship'); emit('close') } },
  // Power
  { id: 'power:self-improve', category: 'power', label: 'Self-Improve', description: 'Autonomous codebase improvement', icon: '⚡', badgeColor: 'text-yellow-400', execute: () => { emit('inject-message', SELF_IMPROVE_PROMPT); emit('close') } },
  { id: 'power:refresh-plans', category: 'power', label: 'Refresh Plans', description: 'Reload active plans from disk', icon: '↻', execute: async () => { await refreshActivePlans(callMcpTool); await loadPlans(); } },
]

// --- Plan parsing ---

function parsePlanFilename(filename) {
  const match = filename.match(/^(active|paused|draft|completed|archived)-(\d{8})-(.+)\.md$/)
  if (!match) return null
  const [, status, date, rest] = match
  const firstDash = rest.indexOf('-')
  return {
    filename,
    status,
    date,
    scope: firstDash > -1 ? rest.slice(0, firstDash) : rest,
    slug: firstDash > -1 ? rest.slice(firstDash + 1) : '',
    body: `${date}-${rest}` // invariant across renames
  }
}

async function loadPlans() {
  if (!projectRoot.value) return
  planError.value = null
  try {
    const result = await callMcpTool('mcp__filesystem__list_directory', {
      path: `${projectRoot.value}/.paloma/plans`
    })
    const files = result.split('\n')
      .map(line => line.match(/^\[FILE\]\s+(.+)/)?.[1])
      .filter(Boolean)
    allPlans.value = files.map(parsePlanFilename).filter(Boolean)
  } catch (e) {
    planError.value = `Failed to load plans: ${e.message}`
  }
}

// --- Plan sub-view actions ---

function getStatusActions(plan) {
  return STATUS_ORDER
    .filter(s => s !== plan.status)
    .map(newStatus => ({
      id: `plan-action:${plan.filename}:${newStatus}`,
      category: 'plan-actions',
      label: STATUS_VERBS[newStatus],
      description: `${plan.status} → ${newStatus}`,
      icon: PLAN_STATUS[newStatus].icon,
      badge: newStatus,
      badgeColor: PLAN_STATUS[newStatus].color,
      execute: () => changePlanStatus(plan, newStatus)
    }))
}

async function changePlanStatus(plan, newStatus) {
  const basePath = `${projectRoot.value}/.paloma/plans`
  const newFilename = `${newStatus}-${plan.body}.md`
  planError.value = null
  try {
    await callMcpTool('mcp__filesystem__move_file', {
      source: `${basePath}/${plan.filename}`,
      destination: `${basePath}/${newFilename}`
    })
    await refreshActivePlans(callMcpTool)
    await loadPlans()
    subView.value = null
  } catch (e) {
    planError.value = `Rename failed: ${e.message}`
  }
}

function enterPlanSubView(plan) {
  subView.value = { type: 'plan-actions', plan }
  query.value = ''
  selectedIndex.value = 0
}

function exitSubView() {
  subView.value = null
  query.value = ''
  selectedIndex.value = 0
}

// --- Query parsing with prefix filters ---

const parsedQuery = computed(() => {
  const raw = query.value
  if (raw.startsWith('>'))       return { filter: 'commands', text: raw.slice(1).trim() }
  if (raw.startsWith('plan:'))   return { filter: 'plans', text: raw.slice(5).trim() }
  if (raw.startsWith('pillar:')) return { filter: 'pillars', text: raw.slice(7).trim() }
  return { filter: 'all', text: raw }
})

const placeholder = computed(() => {
  if (subView.value) return 'Choose an action...'
  const { filter } = parsedQuery.value
  if (filter === 'commands') return 'Type a command...'
  if (filter === 'plans') return 'Search plans...'
  if (filter === 'pillars') return 'Choose a pillar...'
  return 'Search sessions, commands...'
})

const emptyMessage = computed(() => {
  if (subView.value) return 'No actions available'
  const { filter, text } = parsedQuery.value
  if (filter === 'commands') return text ? `No matching commands` : 'No commands'
  if (filter === 'plans') return text ? `No matching plans` : 'No plans found'
  if (filter === 'pillars') return text ? `No matching pillars` : 'No pillars'
  return text ? `No results for "${text}"` : 'No items'
})

// --- Filtered & categorized items ---

function matchText(item, text) {
  if (!text) return true
  const q = text.toLowerCase()
  return (item.label || '').toLowerCase().includes(q) ||
    (item.description || '').toLowerCase().includes(q) ||
    (item.badge || '').toLowerCase().includes(q)
}

// Plan items — generated from allPlans
const planItems = computed(() => {
  const sorted = [...allPlans.value].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status)
    const bi = STATUS_ORDER.indexOf(b.status)
    if (ai !== bi) return ai - bi
    return b.date.localeCompare(a.date) // newest first within status
  })
  return sorted.map(plan => ({
    id: `plan:${plan.filename}`,
    category: 'plans',
    label: plan.slug.replace(/-/g, ' '),
    description: `${plan.scope} · ${plan.date}`,
    icon: PLAN_STATUS[plan.status].icon,
    badge: plan.status,
    badgeColor: PLAN_STATUS[plan.status].color,
    execute: () => enterPlanSubView(plan)
  }))
})

// Session items
const sessionItems = computed(() => {
  const sorted = [...sessions.value].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  return sorted.slice(0, 15).map(session => ({
    id: `session:${session.id}`,
    category: 'sessions',
    label: session.title || 'Untitled',
    description: timeAgo(session.updatedAt || session.createdAt),
    icon: phaseIcon(session.phase),
    badgeColor: phaseColor(session.phase),
    execute: () => { emit('select-session', session.id); emit('close') }
  }))
})

// Category filter visibility
const CATEGORY_VISIBILITY = {
  all:      { navigation: true, plans: true, pillars: true, power: true, sessions: true, 'plan-actions': true },
  commands: { navigation: true, plans: false, pillars: true, power: true, sessions: false, 'plan-actions': false },
  plans:    { navigation: false, plans: true, pillars: false, power: false, sessions: false, 'plan-actions': false },
  pillars:  { navigation: false, plans: false, pillars: true, power: false, sessions: false, 'plan-actions': false },
}

const CATEGORY_LABELS = {
  navigation: 'Navigation',
  plans: 'Plans',
  pillars: 'Pillars',
  power: 'Power',
  sessions: 'Sessions',
  'plan-actions': 'Actions',
}

const CATEGORY_ORDER = ['navigation', 'plans', 'pillars', 'power', 'sessions', 'plan-actions']

const visibleCategories = computed(() => {
  const { filter, text } = parsedQuery.value

  // Sub-view mode: only show plan actions
  if (subView.value) {
    const actions = getStatusActions(subView.value.plan).filter(item => matchText(item, text))
    if (actions.length === 0) return []
    return [{ id: 'plan-actions', label: CATEGORY_LABELS['plan-actions'], items: actions }]
  }

  const visibility = CATEGORY_VISIBILITY[filter] || CATEGORY_VISIBILITY.all

  // Build all items per category
  const categoryItems = {
    navigation: staticCommands.filter(c => c.category === 'navigation'),
    plans: planItems.value,
    pillars: staticCommands.filter(c => c.category === 'pillars'),
    power: staticCommands.filter(c => c.category === 'power'),
    sessions: sessionItems.value,
  }

  const result = []
  for (const cat of CATEGORY_ORDER) {
    if (cat === 'plan-actions') continue // only in sub-view
    if (!visibility[cat]) continue
    const items = (categoryItems[cat] || []).filter(item => matchText(item, text))
    if (items.length === 0) continue
    result.push({ id: cat, label: CATEGORY_LABELS[cat], items })
  }
  return result
})

// Flat list of all visible items for keyboard navigation
const flatItems = computed(() => {
  return visibleCategories.value.flatMap(cat => cat.items)
})

// --- Keyboard navigation ---

watch(query, () => { selectedIndex.value = 0 })

function handleKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flatItems.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % flatItems.value.length
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flatItems.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + flatItems.value.length) % flatItems.value.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = flatItems.value[selectedIndex.value]
    if (item) executeItem(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    if (subView.value) {
      exitSubView()
    } else {
      emit('close')
    }
  } else if (e.key === 'Backspace' && query.value === '' && subView.value) {
    e.preventDefault()
    exitSubView()
  } else if (e.key === 'Tab') {
    e.preventDefault() // prevent focus leaving input
  }
}

function executeItem(item) {
  if (item.execute) item.execute()
}

// Scroll selected item into view
watch(selectedIndex, () => {
  nextTick(() => {
    const el = paletteRef.value?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
})

// --- Helpers ---

function phaseIcon(phase) {
  const icons = { flow: '◎', scout: '◈', chart: '▣', forge: '✦', polish: '◇', ship: '⚐' }
  return icons[phase] || '○'
}

function phaseColor(phase) {
  const colors = {
    flow: 'text-blue-400', scout: 'text-green-400', chart: 'text-yellow-400',
    forge: 'text-orange-400', polish: 'text-purple-400', ship: 'text-cyan-400'
  }
  return colors[phase] || 'text-text-muted'
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

// --- Lifecycle ---

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
  loadPlans()
})
</script>
