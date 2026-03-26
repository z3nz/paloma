<template>
  <section class="overflow-hidden rounded-xl border border-border bg-bg-secondary">
    <!-- The header frames the lineage as a navigable timeline instead of a raw JSON dump. -->
    <header class="border-b border-border px-5 py-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-sm font-semibold text-text-primary">Quinn Lineage</h2>
          <p class="mt-1 text-sm text-text-muted">
            {{ orderedLineage.length }}
            {{ orderedLineage.length === 1 ? 'generation' : 'generations' }}
            recorded
          </p>
        </div>
        <span class="rounded-full border border-border bg-bg-primary/70 px-2.5 py-1 text-[11px] font-mono text-text-muted">
          newest first
        </span>
      </div>
    </header>

    <div v-if="!orderedLineage.length" class="px-5 py-8 text-sm text-text-muted">
      No generations recorded yet.
    </div>

    <div v-else class="relative">
      <!-- The vertical rail anchors the cards into a single evolutionary thread. -->
      <div class="absolute bottom-0 left-6 top-0 w-px bg-border"></div>

      <article
        v-for="entry in orderedLineage"
        :key="entry.generation"
        class="relative pl-12 pr-4"
      >
        <span
          class="absolute left-[19px] top-6 h-3 w-3 rounded-full border-2 border-bg-secondary"
          :class="statusTone(entry.status).dot"
        ></span>

        <div class="border-b border-border/70 py-3 last:border-b-0">
          <button
            type="button"
            class="w-full rounded-xl border px-4 py-4 text-left transition-colors"
            :class="isSelected(entry) ? `${statusTone(entry.status).card} bg-bg-primary/70` : 'border-border bg-bg-primary/40 hover:bg-bg-hover/70'"
            @click="toggleGeneration(entry.generation)"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-text-primary">Generation {{ entry.generation }}</span>
                  <span
                    class="rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.2em]"
                    :class="statusTone(entry.status).badge"
                  >
                    {{ formatStatus(entry.status) }}
                  </span>
                  <span
                    v-if="entry.promptHash"
                    class="rounded-full border border-border bg-bg-secondary px-2 py-0.5 text-[10px] font-mono text-text-muted"
                  >
                    {{ entry.promptHash }}
                  </span>
                </div>

                <p class="mt-2 line-clamp-2 text-sm leading-6 text-text-secondary">
                  {{ summaryText(entry) }}
                </p>
                <p class="mt-2 line-clamp-2 font-mono text-xs leading-5 text-text-muted">
                  {{ promptPreview(entry) }}
                </p>
              </div>

              <div class="shrink-0 text-right">
                <div class="text-xs text-text-muted">{{ formatTimestamp(entry.born) }}</div>
                <svg
                  class="ml-auto mt-3 h-4 w-4 text-text-muted transition-transform"
                  :class="{ 'rotate-90': isSelected(entry) }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>

          <!-- Expanding a generation reveals the adjacent diff and the full manifest payload. -->
          <div v-if="isSelected(entry)" class="space-y-4 px-4 pb-2 pt-4">
            <section>
              <div class="mb-2 text-[10px] uppercase tracking-[0.2em] text-text-muted">Prompt Preview</div>
              <div class="rounded-lg border border-border bg-bg-primary/60 px-3 py-3 font-mono text-xs leading-6 text-text-secondary">
                {{ promptPreview(entry) || 'No prompt preview recorded.' }}
              </div>
            </section>

            <section>
              <div class="mb-2 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                Delta From Generation {{ Number(entry.generation) - 1 }}
              </div>

              <div v-if="getPreviousEntry(entry)" class="space-y-2">
                <div
                  v-for="(block, index) in diffBlocks(entry)"
                  :key="`${entry.generation}-${index}`"
                  class="rounded-lg border border-border bg-bg-primary/60 px-3 py-3"
                >
                  <div
                    class="mb-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.2em]"
                    :class="block.type === 'added' ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'"
                  >
                    {{ block.type === 'added' ? 'Added' : 'Removed' }}
                  </div>
                  <pre class="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-text-secondary">{{ block.preview }}</pre>
                </div>

                <div
                  v-if="!diffBlocks(entry).length"
                  class="rounded-lg border border-border bg-bg-primary/40 px-3 py-3 text-sm text-text-muted"
                >
                  No textual delta available yet. Pass prompt or manifest content to render richer comparisons.
                </div>
              </div>

              <div
                v-else
                class="rounded-lg border border-border bg-bg-primary/40 px-3 py-3 text-sm text-text-muted"
              >
                Generation {{ entry.generation }} has no predecessor to compare against.
              </div>
            </section>

            <section>
              <div class="mb-2 text-[10px] uppercase tracking-[0.2em] text-text-muted">Manifest</div>
              <pre class="max-h-72 overflow-auto rounded-lg border border-border bg-bg-primary/70 px-3 py-3 font-mono text-xs leading-6 text-text-secondary">{{ manifestText(entry) }}</pre>
            </section>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { diffLines } from 'diff'

const props = defineProps({
  lineage: { type: Array, default: () => [] },
  selectedGeneration: { type: Number, default: null }
})

const emit = defineEmits(['select-generation'])

const orderedLineage = computed(() => {
  return [...props.lineage].sort((left, right) => Number(right.generation || 0) - Number(left.generation || 0))
})

const lineageByGeneration = computed(() => {
  return new Map(orderedLineage.value.map(entry => [Number(entry.generation), entry]))
})

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

function formatTimestamp(value) {
  if (!value) return 'Unknown time'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function formatStatus(status) {
  const value = String(status || 'successful').toLowerCase()
  if (value.includes('error') || value.includes('fail')) return 'error'
  if (value.includes('archiv')) return 'archived'
  return 'successful'
}

function statusTone(status) {
  const tone = formatStatus(status)

  if (tone === 'error') {
    return {
      dot: 'bg-danger',
      badge: 'border-danger/30 bg-danger/10 text-danger',
      card: 'border-danger/25'
    }
  }

  if (tone === 'archived') {
    return {
      dot: 'bg-text-muted',
      badge: 'border-border bg-bg-secondary text-text-muted',
      card: 'border-border'
    }
  }

  return {
    dot: 'bg-success',
    badge: 'border-success/30 bg-success/10 text-success',
    card: 'border-success/20'
  }
}

function summaryText(entry) {
  return normalizeText(entry.summary || entry.summaryPreview || entry.taskForNext || 'No summary recorded yet.')
}

function promptPreview(entry) {
  const source = normalizeText(
    entry.promptPreview
    || entry.prompt
    || entry.manifestContent
    || entry.manifest
    || entry.summary
    || entry.summaryPreview
    || ''
  )

  if (!source) return 'No prompt preview recorded.'
  return source.length > 200 ? `${source.slice(0, 200)}...` : source
}

function manifestText(entry) {
  const providedManifest = normalizeText(entry.manifestContent || entry.manifest || '')
  if (providedManifest) return providedManifest

  return [
    `# Generation ${entry.generation}`,
    entry.born ? `**Born:** ${entry.born}` : null,
    entry.promptHash ? `**Prompt Hash:** ${entry.promptHash}` : null,
    '',
    '## Summary',
    '',
    summaryText(entry)
  ]
    .filter(Boolean)
    .join('\n')
}

function getPreviousEntry(entry) {
  return lineageByGeneration.value.get(Number(entry.generation) - 1) || null
}

function getDiffSource(entry) {
  return normalizeText(
    entry.prompt
    || entry.promptPreview
    || entry.manifestContent
    || entry.manifest
    || entry.summary
    || entry.summaryPreview
    || ''
  )
}

function diffBlocks(entry) {
  const previousEntry = getPreviousEntry(entry)
  if (!previousEntry) return []

  const previousSource = getDiffSource(previousEntry)
  const currentSource = getDiffSource(entry)
  if (!previousSource || !currentSource) return []

  return diffLines(previousSource, currentSource)
    .filter(part => part.added || part.removed)
    .slice(0, 6)
    .map(part => {
      const lines = part.value
        .split('\n')
        .filter(line => line.trim().length > 0)
        .slice(0, 6)

      return {
        type: part.added ? 'added' : 'removed',
        preview: lines.join('\n')
      }
    })
    .filter(part => part.preview)
}

function isSelected(entry) {
  return props.selectedGeneration != null && Number(props.selectedGeneration) === Number(entry.generation)
}

function toggleGeneration(generation) {
  const nextValue = props.selectedGeneration === generation ? null : generation
  emit('select-generation', nextValue)
}
</script>
