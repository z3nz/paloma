<template>
  <div class="h-full flex flex-col">
    <TopBar
      :project-name="projectName"
      :active-model="activeModel"
      @open-settings="$emit('open-settings')"
      @open-project="$emit('open-project')"
    />
    <div class="flex flex-1 overflow-hidden">
      <Sidebar
        :sessions="sessions"
        :active-session-id="activeSessionId"
        :project-path="projectName"
        @new-chat="$emit('new-chat')"
        @select-session="id => $emit('select-session', id)"
        @delete-session="id => $emit('delete-session', id)"
      />
      <main class="flex-1 overflow-hidden">
        <slot />
      </main>
      <slot name="right-sidebar" />
    </div>
  </div>
</template>

<script setup>
import TopBar from './TopBar.vue'
import Sidebar from './Sidebar.vue'

defineProps({
  projectName: { type: String, default: '' },
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: Number, default: null },
  activeModel: { type: String, default: '' }
})

defineEmits(['open-settings', 'open-project', 'new-chat', 'select-session', 'delete-session'])
</script>
