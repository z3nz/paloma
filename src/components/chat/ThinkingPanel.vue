<template>
  <aside
    v-if="visible"
    class="bg-bg-secondary border-l border-border flex flex-col h-full overflow-hidden shrink-0 relative"
    :style="{ width: collapsed ? '48px' : panelWidth + 'px' }"
  >
    <!-- Resize handle (only when expanded) -->
    <div
      v-if="!collapsed"
      class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 z-10 transition-colors"
      @mousedown="startResize"
    ></div>

    <!-- Collapsed bar -->
    <div v-if="collapsed" class="flex flex-col items-center py-3 gap-2 cursor-pointer h-full" @click="collapsed = false">
      <!-- Ready indicator dots -->
      <div class="flex flex-col gap-1.5">
        <div class="w-2.5 h-2.5 rounded-full" :class="thinkerDotClass" :title="thinkerStatus"></div>
      </div>
      <!-- Vertical label -->
      <span class="text-[10px] text-text-muted font-mono tracking-widest" style="writing-mode: vertical-rl; transform: rotate(180deg);">
        THINKER
      </span>
    </div>

    <!-- Expanded panel -->
    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div class="flex items-center gap-2">
          <!-- Agreement dots -->
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full" :class="voiceDotClass" title="Voice"></div>
            <div class="w-2 h-2 rounded-full" :class="thinkerDotClass" title="Thinker"></div>
          </div>
          <h2 class="text-sm font-semibold text-text-primary">Thinker</h2>
          <span v-if="group?.voiceReady && group?.thinkerReady" class="text-xs text-green-400 font-mono">COMPLETE</span>
        </div>
        <button
          @click="collapsed = true"
          class="text-text-muted hover:text-text-primary transition-colors p-1"
          title="Collapse"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <!-- Thinker stream content -->
      <div ref="contentEl" class="flex-1 overflow-y-auto p-4 font-mono text-sm text-text-secondary leading-relaxed">
        <div v-if="thinkerContent" class="whitespace-pre-wrap break-words">{{ thinkerContent }}</div>
        <div v-else class="text-text-muted italic">Waiting for Thinker to begin exploring...</div>
        <!-- Auto-scroll anchor -->
        <div ref="scrollAnchor"></div>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useMCP } from '../../composables/useMCP.js'

const { singularityGroups, singularityThinkerContent } = useMCP()

const props = defineProps({
  groupId: { type: String, default: null }
})

const collapsed = ref(false)
const panelWidth = ref(400)
const contentEl = ref(null)
const scrollAnchor = ref(null)

const visible = computed(() => !!props.groupId)
const group = computed(() => props.groupId ? singularityGroups.get(props.groupId) : null)
const thinkerContent = computed(() => props.groupId ? (singularityThinkerContent.get(props.groupId) || '') : '')

// Agreement indicator dot classes
const voiceDotClass = computed(() => {
  if (!group.value) return 'bg-gray-600'
  if (group.value.voiceReady) return 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
  return 'bg-blue-400 animate-pulse'
})

const thinkerDotClass = computed(() => {
  if (!group.value) return 'bg-gray-600'
  if (group.value.thinkerReady) return 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
  return 'bg-blue-400 animate-pulse'
})

const thinkerStatus = computed(() => {
  if (!group.value) return 'Inactive'
  if (group.value.thinkerReady) return 'Ready'
  return 'Thinking...'
})

// Auto-scroll to bottom when content changes
watch(thinkerContent, async () => {
  await nextTick()
  scrollAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
})

// Resize handling
let resizing = false
function startResize(e) {
  resizing = true
  const startX = e.clientX
  const startWidth = panelWidth.value

  function onMove(e) {
    if (!resizing) return
    const delta = startX - e.clientX
    panelWidth.value = Math.max(250, Math.min(800, startWidth + delta))
  }

  function onUp() {
    resizing = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>
