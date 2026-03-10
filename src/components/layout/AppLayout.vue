<template>
  <div class="h-full flex flex-col">
    <TopBar
      :project-name="projectName"
      :active-model="activeModel"
      @open-settings="$emit('open-settings')"
      @open-project="$emit('open-project')"
    />
    <div class="flex flex-1 overflow-hidden">
      <!-- Collapsed sidebar: thin expand strip -->
      <button
        v-if="sidebarCollapsed"
        @click="$emit('toggle-sidebar')"
        class="w-8 bg-bg-secondary border-r border-border flex flex-col items-center justify-center hover:bg-bg-hover transition-colors shrink-0 group"
        title="Expand sidebar (Ctrl+/)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="text-text-muted group-hover:text-text-primary transition-colors">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <!-- Expanded sidebar -->
      <template v-else>
        <Sidebar
          :sessions="sessions"
          :active-session-id="activeSessionId"
          :project-path="projectName"
          :width="sidebarWidth"
          @new-chat="$emit('new-chat')"
          @select-session="id => $emit('select-session', id)"
          @delete-session="id => $emit('delete-session', id)"
        />
        <div
          class="w-1 cursor-col-resize bg-border hover:bg-accent/50 active:bg-accent transition-colors shrink-0"
          @mousedown="startResize"
        />
      </template>

      <main class="flex-1 overflow-hidden">
        <slot />
      </main>
      <slot name="right-sidebar" />
    </div>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import TopBar from './TopBar.vue'
import Sidebar from './Sidebar.vue'

defineProps({
  projectName: { type: String, default: '' },
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: Number, default: null },
  activeModel: { type: String, default: '' },
  sidebarCollapsed: { type: Boolean, default: false }
})

defineEmits(['open-settings', 'open-project', 'new-chat', 'select-session', 'delete-session', 'toggle-sidebar'])

const MIN_WIDTH = 200
const MAX_WIDTH = 500

const sidebarWidth = ref(Number(localStorage.getItem('paloma:sidebarWidth')) || 280)

// Track active drag listeners for cleanup on unmount
let _dragCleanup = null

function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  function onMouseMove(e) {
    const delta = e.clientX - startX
    sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('paloma:sidebarWidth', String(sidebarWidth.value))
    _dragCleanup = null
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  _dragCleanup = onMouseUp
}

onBeforeUnmount(() => { if (_dragCleanup) _dragCleanup() })
</script>
