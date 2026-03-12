<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="'0 0 ' + viewBox + ' ' + viewBox"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="pillar-loader"
    :class="[
      'pillar-loader--' + normalizedPillar,
      { 'pillar-loader--active': active }
    ]"
  >
    <!-- Flow: Water Ripples — 3 concentric circles pulsing outward -->
    <template v-if="normalizedPillar === 'flow'">
      <circle cx="12" cy="12" r="3" :stroke="colors.flow" stroke-width="1.5" class="flow-ripple flow-ripple--1" />
      <circle cx="12" cy="12" r="6" :stroke="colors.flow" stroke-width="1" class="flow-ripple flow-ripple--2" />
      <circle cx="12" cy="12" r="9" :stroke="colors.flow" stroke-width="0.75" class="flow-ripple flow-ripple--3" />
    </template>

    <!-- Scout: Scanning Eye — magnifying glass with sweep line -->
    <template v-else-if="normalizedPillar === 'scout'">
      <circle cx="10" cy="10" r="5.5" :stroke="colors.scout" stroke-width="1.5" fill="none" />
      <line x1="14" y1="14" x2="19" y2="19" :stroke="colors.scout" stroke-width="2" stroke-linecap="round" />
      <line x1="6" y1="10" x2="14" y2="10" :stroke="colors.scout" stroke-width="1" stroke-linecap="round" class="scout-scan" opacity="0.7" />
    </template>

    <!-- Chart: Compass Rose — rotating star with stroke drawing -->
    <template v-else-if="normalizedPillar === 'chart'">
      <path
        d="M12 2 L14 9 L21 9 L15.5 13.5 L17.5 21 L12 16.5 L6.5 21 L8.5 13.5 L3 9 L10 9 Z"
        :stroke="colors.chart"
        stroke-width="1.2"
        fill="none"
        stroke-linejoin="round"
        class="chart-star"
      />
    </template>

    <!-- Forge: Hammer Strike with Sparks — head at bottom strikes anvil -->
    <template v-else-if="normalizedPillar === 'forge'">
      <!-- Anvil base -->
      <line x1="5" y1="19" x2="19" y2="19" :stroke="colors.forge" stroke-width="1.5" stroke-linecap="round" />
      <!-- Hammer (handle on top, heavy head at bottom — head strikes the anvil) -->
      <g class="forge-hammer">
        <line x1="12" y1="3" x2="12" y2="12" :stroke="colors.forge" stroke-width="1.5" stroke-linecap="round" />
        <rect x="9" y="12" width="6" height="4" rx="1" :fill="colors.forge" />
      </g>
      <!-- Sparks (fly from impact zone near anvil) -->
      <circle cx="7" cy="18" r="1" :fill="colors.forge" class="forge-spark forge-spark--1" />
      <circle cx="17" cy="18" r="1" :fill="colors.forge" class="forge-spark forge-spark--2" />
      <circle cx="5" cy="16" r="0.7" :fill="colors.forge" class="forge-spark forge-spark--3" />
      <circle cx="19" cy="16" r="0.7" :fill="colors.forge" class="forge-spark forge-spark--4" />
    </template>

    <!-- Polish: Sparkle Burst — gem with radiating sparkle lines -->
    <template v-else-if="normalizedPillar === 'polish'">
      <!-- Diamond/gem shape -->
      <path d="M12 4 L17 10 L12 20 L7 10 Z" :stroke="colors.polish" stroke-width="1.2" fill="none" stroke-linejoin="round" />
      <!-- Sparkle lines -->
      <line x1="12" y1="1" x2="12" y2="3" :stroke="colors.polish" stroke-width="1" stroke-linecap="round" class="polish-sparkle polish-sparkle--1" />
      <line x1="20" y1="7" x2="22" y2="6" :stroke="colors.polish" stroke-width="1" stroke-linecap="round" class="polish-sparkle polish-sparkle--2" />
      <line x1="20" y1="14" x2="22" y2="15" :stroke="colors.polish" stroke-width="1" stroke-linecap="round" class="polish-sparkle polish-sparkle--3" />
      <line x1="4" y1="7" x2="2" y2="6" :stroke="colors.polish" stroke-width="1" stroke-linecap="round" class="polish-sparkle polish-sparkle--4" />
      <line x1="4" y1="14" x2="2" y2="15" :stroke="colors.polish" stroke-width="1" stroke-linecap="round" class="polish-sparkle polish-sparkle--5" />
    </template>

    <!-- Ship: Rocket Launch — rocket with exhaust particles -->
    <template v-else-if="normalizedPillar === 'ship'">
      <g class="ship-rocket">
        <!-- Rocket body -->
        <path d="M12 3 L14.5 10 L14 15 L10 15 L9.5 10 Z" :fill="colors.ship" opacity="0.9" />
        <!-- Nose cone -->
        <path d="M12 3 L13.5 7 L10.5 7 Z" :fill="colors.ship" />
        <!-- Fins -->
        <path d="M10 13 L7 17 L10 15 Z" :fill="colors.ship" opacity="0.7" />
        <path d="M14 13 L17 17 L14 15 Z" :fill="colors.ship" opacity="0.7" />
      </g>
      <!-- Exhaust particles -->
      <circle cx="11" cy="17" r="1" :fill="colors.ship" class="ship-exhaust ship-exhaust--1" />
      <circle cx="13" cy="18" r="0.8" :fill="colors.ship" class="ship-exhaust ship-exhaust--2" />
      <circle cx="12" cy="19.5" r="1.2" :fill="colors.ship" class="ship-exhaust ship-exhaust--3" />
      <circle cx="10.5" cy="20" r="0.6" :fill="colors.ship" class="ship-exhaust ship-exhaust--4" />
      <circle cx="13.5" cy="21" r="0.7" :fill="colors.ship" class="ship-exhaust ship-exhaust--5" />
    </template>

    <!-- Fallback: generic pulse -->
    <template v-else>
      <circle cx="12" cy="12" r="4" fill="currentColor" class="fallback-pulse" opacity="0.5" />
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  pillar: { type: String, default: 'flow' },
  active: { type: Boolean, default: true },
  size: { type: Number, default: 20 }
})

const viewBox = 24

const normalizedPillar = computed(() => {
  const p = (props.pillar || '').toLowerCase()
  return ['flow', 'scout', 'chart', 'forge', 'polish', 'ship'].includes(p) ? p : 'unknown'
})

const colors = {
  flow: '#22d3ee',
  scout: '#22d3ee',
  chart: '#facc15',
  forge: '#fb923c',
  polish: '#f472b6',
  ship: '#4ade80'
}
</script>

<style scoped>
/* ============================================
   Flow — Water Ripples
   ============================================ */
.pillar-loader--active .flow-ripple {
  animation: flow-ripple 2s ease-in-out infinite;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
}
.pillar-loader--active .flow-ripple--1 { animation-delay: 0s; }
.pillar-loader--active .flow-ripple--2 { animation-delay: 0.4s; }
.pillar-loader--active .flow-ripple--3 { animation-delay: 0.8s; }

@keyframes flow-ripple {
  0% { opacity: 0.8; transform: scale(0.7); }
  50% { opacity: 0.4; }
  100% { opacity: 0; transform: scale(1.2); }
}

/* ============================================
   Scout — Scanning Eye
   ============================================ */
.pillar-loader--active .scout-scan {
  animation: scout-sweep 2.5s ease-in-out infinite;
}

@keyframes scout-sweep {
  0%, 100% { transform: translateY(-3px); opacity: 0.3; }
  50% { transform: translateY(3px); opacity: 0.9; }
}

/* ============================================
   Chart — Compass Rose
   ============================================ */
.pillar-loader--active .chart-star {
  stroke-dasharray: 80;
  stroke-dashoffset: 80;
  animation: chart-draw 3s linear infinite;
  transform-box: fill-box;
  transform-origin: center;
}

@keyframes chart-draw {
  0% { stroke-dashoffset: 80; transform: rotate(0deg); }
  50% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: 80; transform: rotate(360deg); }
}

/* ============================================
   Forge — Hammer Strike with Sparks
   Pivot at top of handle, head swings down to anvil
   ============================================ */
.pillar-loader--active .forge-hammer {
  animation: forge-strike 1.2s linear infinite;
  transform-origin: 12px 3px;
}

@keyframes forge-strike {
  0% { transform: rotate(-25deg); }
  50% { transform: rotate(-20deg); }
  68% { transform: rotate(3deg) translateY(2px); }
  76% { transform: rotate(3deg) translateY(2px); }
  86% { transform: rotate(-12deg); }
  100% { transform: rotate(-25deg); }
}

.pillar-loader--active .forge-spark {
  opacity: 0;
  animation: forge-spark 1.2s ease-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
.pillar-loader--active .forge-spark--1 { animation-delay: 0.80s; }
.pillar-loader--active .forge-spark--2 { animation-delay: 0.82s; }
.pillar-loader--active .forge-spark--3 { animation-delay: 0.84s; }
.pillar-loader--active .forge-spark--4 { animation-delay: 0.86s; }

@keyframes forge-spark {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  15% { opacity: 1; transform: translate(0, 0) scale(1); }
  60% { opacity: 0.3; transform: translate(0, -3px) scale(0.5); }
  100% { opacity: 0; transform: translate(0, -5px) scale(0); }
}

/* ============================================
   Polish — Sparkle Burst
   ============================================ */
.pillar-loader--active .polish-sparkle {
  animation: polish-burst 2s ease-in-out infinite;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
}
.pillar-loader--active .polish-sparkle--1 { animation-delay: 0s; }
.pillar-loader--active .polish-sparkle--2 { animation-delay: 0.3s; }
.pillar-loader--active .polish-sparkle--3 { animation-delay: 0.6s; }
.pillar-loader--active .polish-sparkle--4 { animation-delay: 0.9s; }
.pillar-loader--active .polish-sparkle--5 { animation-delay: 1.2s; }

@keyframes polish-burst {
  0% { opacity: 0; transform: scale(0.5); }
  20% { opacity: 1; transform: scale(1.3); }
  50% { opacity: 0.8; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.5); }
}

/* ============================================
   Ship — Rocket Launch
   ============================================ */
.pillar-loader--active .ship-rocket {
  animation: ship-hover 1.5s ease-in-out infinite;
}

@keyframes ship-hover {
  0%, 100% { transform: translateY(1px); }
  50% { transform: translateY(-1px); }
}

.pillar-loader--active .ship-exhaust {
  opacity: 0;
  animation: ship-exhaust-fade 1.5s ease-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
.pillar-loader--active .ship-exhaust--1 { animation-delay: 0s; }
.pillar-loader--active .ship-exhaust--2 { animation-delay: 0.2s; }
.pillar-loader--active .ship-exhaust--3 { animation-delay: 0.1s; }
.pillar-loader--active .ship-exhaust--4 { animation-delay: 0.35s; }
.pillar-loader--active .ship-exhaust--5 { animation-delay: 0.25s; }

@keyframes ship-exhaust-fade {
  0% { opacity: 0.8; transform: translateY(0) scale(1); }
  50% { opacity: 0.4; transform: translateY(3px) scale(0.7); }
  100% { opacity: 0; transform: translateY(6px) scale(0.3); }
}

/* ============================================
   Fallback — Generic Pulse
   ============================================ */
.pillar-loader--active .fallback-pulse {
  animation: fallback-pulse 1.5s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

@keyframes fallback-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

/* ============================================
   Static state — no animation when inactive
   ============================================ */
.pillar-loader:not(.pillar-loader--active) .flow-ripple { opacity: 0.5; }
.pillar-loader:not(.pillar-loader--active) .scout-scan { opacity: 0.5; }
.pillar-loader:not(.pillar-loader--active) .chart-star { stroke-dasharray: none; opacity: 0.5; }
.pillar-loader:not(.pillar-loader--active) .forge-spark { opacity: 0; }
.pillar-loader:not(.pillar-loader--active) .polish-sparkle { opacity: 0.5; }
.pillar-loader:not(.pillar-loader--active) .ship-exhaust { opacity: 0; }
.pillar-loader:not(.pillar-loader--active) .fallback-pulse { opacity: 0.4; }
</style>
