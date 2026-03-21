<template>
  <div class="tool-call-item" :class="{ 'tool-call-item--running': isRunning }">
    <!-- Main row -->
    <button
      class="tool-call-item__row"
      @click="toggleExpanded"
      :disabled="!hasResult"
    >
      <!-- Status indicator -->
      <span class="tool-call-item__status">
        <span v-if="isRunning" class="tool-call-item__spinner" />
        <svg v-else-if="isError" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-danger">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-success">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>

      <!-- Server badge -->
      <span
        class="tool-call-item__badge"
        :style="{ background: serverColor.bg, color: serverColor.text, borderColor: serverColor.border }"
      >
        {{ serverName }}
      </span>

      <!-- Tool name -->
      <span class="tool-call-item__name">{{ toolShortName }}</span>

      <!-- Smart summary -->
      <span class="tool-call-item__summary">{{ summary }}</span>

      <!-- Duration -->
      <span v-if="duration" class="tool-call-item__duration">{{ formatDuration(duration) }}</span>

      <!-- Result size -->
      <span v-if="resultSize && !expanded" class="tool-call-item__size">{{ resultSize }}</span>

      <!-- Expand chevron -->
      <svg
        v-if="hasResult"
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" class="tool-call-item__chevron"
        :class="{ 'tool-call-item__chevron--open': expanded }"
      >
        <polyline points="9 6 15 12 9 18"/>
      </svg>
    </button>

    <!-- Expanded result -->
    <div v-if="expanded && hasResult" class="tool-call-item__result">
      <!-- Copy button -->
      <button class="tool-call-item__copy" @click.stop="copyResult" :title="copyLabel">
        {{ copyLabel }}
      </button>
      <ToolResult
        :content="resultContent"
        :result-type="effectiveResultType"
        :tool-name="activity.name"
        :tool-args="activity.args"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import ToolResult from './ToolResult.vue'
import { parseToolName, getServerColor, getToolSummary, classifyResult, getResultSize, formatDuration } from '../../utils/toolClassifier.js'

const props = defineProps({
  activity: { type: Object, required: true },
  toolMessage: { type: Object, default: null },  // The corresponding role:'tool' message (if available)
  live: { type: Boolean, default: false }          // true only during active streaming
})

const expanded = ref(false)
const copyLabel = ref('Copy')
let _copyTimer = null
onBeforeUnmount(() => { if (_copyTimer) clearTimeout(_copyTimer) })

const parsed = computed(() => parseToolName(props.activity.name))
const serverName = computed(() => parsed.value.server || 'built-in')
const toolShortName = computed(() => parsed.value.tool)
const serverColor = computed(() => getServerColor(parsed.value.server))
const summary = computed(() => getToolSummary(props.activity.name, props.activity.args))
const duration = computed(() => props.activity.duration || null)
// Only show spinner during live streaming — persisted messages are always complete
const isRunning = computed(() => props.live && props.activity.status === 'running')

const hasResult = computed(() => !!(props.toolMessage?.content || props.activity.result))
const resultContent = computed(() => props.toolMessage?.content || props.activity.result || '')

const effectiveResultType = computed(() => {
  // Prefer stored resultType, fall back to classification
  if (props.toolMessage?.resultType) return props.toolMessage.resultType
  if (props.activity.resultType) return props.activity.resultType
  if (hasResult.value) return classifyResult(props.activity.name, resultContent.value)
  return 'plain-text'
})

const isError = computed(() => effectiveResultType.value === 'error')

const resultSize = computed(() => {
  if (!hasResult.value) return null
  return getResultSize(resultContent.value)
})

function toggleExpanded() {
  if (hasResult.value) expanded.value = !expanded.value
}

async function copyResult() {
  if (_copyTimer) clearTimeout(_copyTimer)
  try {
    await navigator.clipboard.writeText(resultContent.value)
    copyLabel.value = 'Copied!'
  } catch {
    copyLabel.value = 'Failed'
  }
  _copyTimer = setTimeout(() => { copyLabel.value = 'Copy'; _copyTimer = null }, 1500)
}
</script>
