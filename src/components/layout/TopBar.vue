<template>
  <div class="h-12 bg-bg-secondary border-b border-border flex items-center justify-between px-4">
    <div class="flex items-center gap-2">
      <span class="text-accent font-semibold text-sm tracking-wide">PALOMA</span>
      <span v-if="projectName" class="text-text-muted text-sm">/</span>
      <span v-if="projectName" class="text-text-secondary text-sm">{{ projectName }}</span>
    </div>
    <div class="flex items-center gap-2">
      <button
        @click="$emit('open-project')"
        class="text-text-secondary hover:text-text-primary text-sm px-2 py-1 rounded hover:bg-bg-hover transition-colors"
      >
        Open Project
      </button>
      <button
        @click="$emit('open-settings')"
        class="text-text-secondary hover:text-text-primary p-1.5 rounded hover:bg-bg-hover transition-colors"
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  projectName: { type: String, default: '' }
})
defineEmits(['open-settings', 'open-project'])
</script>
