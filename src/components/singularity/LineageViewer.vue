<template>
  <!-- Quinn generational evolution timeline — newest generation at the top -->
  <div class="lineage-viewer flex flex-col gap-0 select-none">
    <!-- Empty state -->
    <div
      v-if="!lineage.length"
      class="flex items-center justify-center py-12 text-sm italic"
      style="color: var(--color-text-muted);"
    >
      No generations recorded yet.
    </div>

    <!-- Timeline list — newest first -->
    <div
      v-for="(entry, idx) in sortedLineage"
      :key="entry.generation"
      class="lineage-entry relative"
    >
      <!-- Vertical connector line (not shown for the last item) -->
      <div
        v-if="idx < sortedLineage.length - 1"
        class="absolute left-5 top-10 bottom-0 w-px"
        style="background: var(--color-border);"
      ></div>

      <!-- Card row -->
      <div
        class="flex items-start gap-3 px-4 py-3 cursor-pointer rounded-lg mx-2 my-0.5 transition-colors"
        :class="{ 'ring-1': selectedGeneration === entry.generation }"
        :style="{
          background: isSelected(entry) ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
          '--tw-ring-color': 'var(--color-accent)'
        }"
        @click="handleSelect(entry)"
      >
        <!-- Generation badge (color-coded by status) -->
        <div
          class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold font-mono z-10"
          :style="generationBadgeStyle(entry)"
        >
          {{ entry.generation }}
        </div>

        <!-- Card content -->
        <div class="flex-1 min-w-0">
          <!-- Top row: timestamp + expand chevron -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs" style="color: var(--color-text-muted);">
              {{ formatTimestamp(entry.born) }}
            </span>
            <div class="flex items-center gap-2 shrink-0">
              <!-- Status chip -->
              <span
                class="text-xs px-1.5 py-0.5 rounded font-mono"
                :style="statusChipStyle(entry)"
              >
                {{ entry.status || 'unknown' }}
              </span>
              <!-- Expand/collapse chevron (only shown when selected) -->
              <svg
                v-if="isSelected(entry)"
                class="w-3.5 h-3.5 transition-transform"
                :class="{ 'rotate-180': expandedGeneration === entry.generation }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                style="color: var(--color-text-muted);"
              >
                <polyline points="6 9 12 15 18 9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>

          <!-- Summary preview (2 lines, truncated) -->
          <p
            class="text-sm mt-1 line-clamp-2"
            style="color: var(--color-text-secondary);"
          >
            {{ entry.summary || entry.promptHash || 'No summary available' }}
          </p>

          <!-- Prompt hash (muted monospace) -->
          <p
            v-if="entry.promptHash"
            class="text-xs font-mono mt-0.5 truncate"
            style="color: var(--color-text-muted);"
          >
            {{ entry.promptHash }}
          </p>
        </div>
      </div>

      <!-- Expanded manifest content -->
      <div
        v-if="expandedGeneration === entry.generation"
        class="mx-4 mb-2 rounded-lg overflow-hidden border"
        style="border-color: var(--color-border); background: var(--color-bg-primary);"
      >
        <div class="flex items-center justify-between px-3 py-2 border-b" style="border-color: var(--color-border);">
          <span class="text-xs font-mono font-semibold" style="color: var(--color-text-primary);">
            Generation {{ entry.generation }} — Manifest
          </span>
          <button
            class="text-xs px-2 py-0.5 rounded transition-colors"
            style="color: var(--color-text-muted); background: var(--color-bg-secondary);"
            @click.stop="copyManifest(entry)"
          >
            {{ copyLabel === entry.generation ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <pre
          class="p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
          style="color: var(--color-text-secondary); max-height: 320px; overflow-y: auto;"
        >{{ entry.manifest || formatManifestPreview(entry) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// ── Props ───────────────────────────────────────────────────────────────────

const props = defineProps({
  /**
   * Array of generation entries.
   * Each: { generation: number, born: string (ISO), promptHash: string, summary: string, status: string, manifest?: string }
   */
  lineage: { type: Array, default: () => [] },
  /** The currently selected generation number (null = none selected) */
  selectedGeneration: { type: Number, default: null }
})

// ── Emits ───────────────────────────────────────────────────────────────────

const emit = defineEmits(['select-generation'])

// ── Local state ─────────────────────────────────────────────────────────────

const expandedGeneration = ref(null) // Which generation's manifest is fully expanded
const copyLabel = ref(null)          // generation number being copied, or null

// ── Sorted lineage — newest generation first ─────────────────────────────────

const sortedLineage = computed(() =>
  [...props.lineage].sort((a, b) => b.generation - a.generation)
)

// ── Selection helpers ────────────────────────────────────────────────────────

function isSelected(entry) {
  return props.selectedGeneration === entry.generation
}

function handleSelect(entry) {
  emit('select-generation', entry.generation)
  // Toggle expand/collapse when clicking a selected entry
  if (expandedGeneration.value === entry.generation) {
    expandedGeneration.value = null
  } else {
    expandedGeneration.value = entry.generation
  }
}

// ── Badge / chip styles ──────────────────────────────────────────────────────

function generationBadgeStyle(entry) {
  const status = entry.status || 'unknown'
  const colors = {
    successful: 'background: color-mix(in srgb, #22c55e 20%, transparent); color: #22c55e;',
    complete:   'background: color-mix(in srgb, #22c55e 20%, transparent); color: #22c55e;',
    error:      'background: color-mix(in srgb, #ef4444 20%, transparent); color: #ef4444;',
    failed:     'background: color-mix(in srgb, #ef4444 20%, transparent); color: #ef4444;',
    archived:   'background: color-mix(in srgb, #6b7280 20%, transparent); color: #9ca3af;',
    running:    'background: color-mix(in srgb, #3b82f6 20%, transparent); color: #60a5fa;',
  }
  return colors[status] ?? 'background: color-mix(in srgb, #6b7280 15%, transparent); color: #9ca3af;'
}

function statusChipStyle(entry) {
  const status = entry.status || 'unknown'
  const styles = {
    successful: 'background: color-mix(in srgb, #22c55e 15%, transparent); color: #22c55e;',
    complete:   'background: color-mix(in srgb, #22c55e 15%, transparent); color: #22c55e;',
    error:      'background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444;',
    failed:     'background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444;',
    archived:   'background: color-mix(in srgb, #6b7280 12%, transparent); color: #9ca3af;',
    running:    'background: color-mix(in srgb, #3b82f6 15%, transparent); color: #60a5fa;',
  }
  return styles[status] ?? 'background: color-mix(in srgb, #6b7280 12%, transparent); color: #9ca3af;'
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatTimestamp(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return iso
  }
}

/** Build a readable preview from entry fields when no full manifest is available */
function formatManifestPreview(entry) {
  const lines = [
    `Generation: ${entry.generation}`,
    `Born: ${entry.born || '—'}`,
    `Status: ${entry.status || 'unknown'}`,
    `Prompt Hash: ${entry.promptHash || '—'}`,
    '',
    'Summary:',
    entry.summary || '(no summary)'
  ]
  return lines.join('\n')
}

async function copyManifest(entry) {
  const text = entry.manifest || formatManifestPreview(entry)
  try {
    await navigator.clipboard.writeText(text)
    copyLabel.value = entry.generation
    setTimeout(() => { copyLabel.value = null }, 1500)
  } catch {
    // Clipboard API unavailable — silently ignore
  }
}
</script>

<style scoped>
/* line-clamp utility — Tailwind v4 may not include this, add via inline fallback */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
