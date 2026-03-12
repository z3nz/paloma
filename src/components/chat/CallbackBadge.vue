<template>
  <div class="flex items-center gap-2 mb-2 pl-2 border-l-2" :class="borderColor">
    <span class="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" :class="badgeColor">
      {{ icon }} {{ badgeText }}
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: { type: Object, required: true }
})

const pillarColors = {
  scout: { badge: 'bg-cyan-500/15 text-cyan-400', border: 'border-cyan-500/40' },
  chart: { badge: 'bg-yellow-500/15 text-yellow-400', border: 'border-yellow-500/40' },
  forge: { badge: 'bg-orange-500/15 text-orange-400', border: 'border-orange-500/40' },
  polish: { badge: 'bg-pink-500/15 text-pink-400', border: 'border-pink-500/40' },
  ship: { badge: 'bg-green-500/15 text-green-400', border: 'border-green-500/40' }
}

const fallbackColors = { badge: 'bg-blue-500/15 text-blue-400', border: 'border-blue-500/40' }

const colors = computed(() => {
  const pillar = props.message.callbackPillar
  return pillarColors[pillar] || fallbackColors
})

const badgeColor = computed(() => colors.value.badge)
const borderColor = computed(() => colors.value.border)

const icon = computed(() => {
  const type = props.message.callbackType
  if (type === 'adam_cc') return '\uD83D\uDCAC'
  if (type === 'batched') return '\uD83D\uDCE1'
  return '\u26A1'
})

const badgeText = computed(() => {
  const type = props.message.callbackType
  const pillar = props.message.callbackPillar

  if (type === 'adam_cc' && pillar) {
    return `Adam CC'd Flow about ${capitalize(pillar)}`
  }
  if (type === 'completion' && pillar) {
    return `${capitalize(pillar)} completed`
  }
  if (type === 'batched') {
    return 'Batched callbacks'
  }
  // Fallback
  return 'Callback response'
})

function capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}
</script>
