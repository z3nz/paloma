<template>
  <div v-if="activities.length" class="px-6 py-2">
    <div class="max-w-3xl mx-auto space-y-1">
      <div
        v-for="(activity, i) in activities"
        :key="i"
        class="flex items-center gap-2 text-xs text-text-muted"
      >
        <span
          class="w-3 h-3 rounded-full shrink-0"
          :class="activity.status === 'running'
            ? 'bg-accent animate-pulse'
            : 'bg-success'"
        />
        <span class="font-mono">{{ formatActivity(activity) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activities: { type: Array, default: () => [] }
})

function formatActivity(activity) {
  const args = activity.args || {}
  switch (activity.name) {
    case 'readFile':
      return `Reading ${args.path || 'file'}`
    case 'listDirectory':
      return `Listing ${args.path || 'root directory'}`
    case 'searchFiles':
      return `Searching for "${args.query || ''}"`
    case 'fileExists':
      return `Checking ${args.path || 'file'}`
    case 'createFile':
      return `Creating ${args.path || 'file'}`
    case 'deleteFile':
      return `Deleting ${args.path || 'file'}`
    case 'moveFile':
      return `Moving ${args.fromPath || 'file'} → ${args.toPath || 'destination'}`
    default:
      return `${activity.name}(${JSON.stringify(args)})`
  }
}
</script>
