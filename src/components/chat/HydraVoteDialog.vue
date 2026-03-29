<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" @click.self="() => {}">
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="relative bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg w-full max-w-4xl mx-4 shadow-2xl flex flex-col max-h-[90vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
        <div class="flex items-center gap-3">
          <span class="text-lg">🐉</span>
          <h2 class="text-sm font-medium text-[var(--color-text-primary)]">The Hydra needs your vote</h2>
          <span class="text-xs text-[var(--color-text-muted)]">{{ vote.plans.length }} plans ready</span>
        </div>
      </div>

      <!-- Task -->
      <div class="px-6 py-3 border-b border-[var(--color-border)] shrink-0">
        <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Task</div>
        <p class="text-sm text-[var(--color-text-primary)]">{{ vote.task }}</p>
      </div>

      <!-- Plans -->
      <div class="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        <div
          v-for="plan in vote.plans"
          :key="plan.headNumber"
          @click="selectedHead = plan.headNumber"
          class="border rounded-lg p-4 cursor-pointer transition-all"
          :class="selectedHead === plan.headNumber
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
            : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <input
                type="radio"
                :value="plan.headNumber"
                v-model="selectedHead"
                class="accent-[var(--color-accent)]"
              />
              <span class="text-sm font-medium text-[var(--color-text-primary)]">Head {{ plan.headNumber }}</span>
            </div>
            <button
              @click.stop="toggleExpand(plan.headNumber)"
              class="text-xs text-[var(--color-accent)] hover:underline"
            >
              {{ expandedHeads.has(plan.headNumber) ? 'Collapse' : 'View Full Plan' }}
            </button>
          </div>
          <div
            class="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap"
            :class="expandedHeads.has(plan.headNumber) ? 'max-h-[60vh] overflow-y-auto' : 'max-h-32 overflow-hidden'"
          >{{ plan.plan }}</div>
          <div v-if="!expandedHeads.has(plan.headNumber) && plan.plan.length > 500" class="text-xs text-[var(--color-text-muted)] mt-1">
            ... {{ Math.round(plan.plan.length / 4) }} words total
          </div>
        </div>
      </div>

      <!-- Reasoning + Submit -->
      <div class="px-6 py-4 border-t border-[var(--color-border)] shrink-0 space-y-3">
        <div>
          <label class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)] block mb-1">
            Why did you choose this plan?
          </label>
          <textarea
            v-model="reasoning"
            placeholder="What makes this plan better than the others? This will be captured for future modeling..."
            rows="2"
            class="w-full px-3 py-2 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
          ></textarea>
        </div>
        <div class="flex items-center justify-between">
          <span v-if="selectedHead" class="text-sm text-[var(--color-text-muted)]">
            Selected: Head {{ selectedHead }}
          </span>
          <span v-else class="text-sm text-[var(--color-text-muted)]">Select a plan above (or press 1/2/3)</span>
          <button
            @click="submit"
            :disabled="!selectedHead"
            class="px-6 py-2 text-sm bg-[var(--color-accent)]/90 hover:bg-[var(--color-accent)] text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Submit Vote
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  vote: { type: Object, required: true }
})

const emit = defineEmits(['submit'])

const selectedHead = ref(null)
const reasoning = ref('')
const expandedHeads = ref(new Set())

function toggleExpand(headNum) {
  const next = new Set(expandedHeads.value)
  if (next.has(headNum)) next.delete(headNum)
  else next.add(headNum)
  expandedHeads.value = next
}

function submit() {
  if (selectedHead.value) {
    emit('submit', {
      hydraId: props.vote.hydraId,
      chosenHead: selectedHead.value,
      reasoning: reasoning.value.trim()
    })
  }
}

function handleKeyDown(e) {
  // 1-9 select plans
  const num = parseInt(e.key, 10)
  if (num >= 1 && num <= props.vote.plans.length) {
    e.preventDefault()
    selectedHead.value = props.vote.plans[num - 1].headNumber
  }
  // Enter submits if a plan is selected
  if (e.key === 'Enter' && !e.shiftKey && selectedHead.value && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault()
    submit()
  }
}

onMounted(() => document.addEventListener('keydown', handleKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeyDown))
</script>
