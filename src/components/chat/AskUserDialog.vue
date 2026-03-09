<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="dismiss">
    <div class="absolute inset-0 bg-black/60" @click="dismiss"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-lg mx-4 shadow-2xl flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div class="flex items-center gap-3">
          <span class="text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-accent-muted text-accent-hover">
            Question
          </span>
          <h2 class="text-sm font-medium text-text-primary">Agent needs your input</h2>
        </div>
        <button
          @click="dismiss"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-5">
        <p class="text-sm text-text-primary whitespace-pre-wrap">{{ askUser.question }}</p>

        <!-- Options buttons -->
        <div v-if="askUser.options?.length" class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="(option, idx) in askUser.options"
            :key="option"
            @click="$emit('respond', option)"
            class="px-4 py-2 text-sm bg-accent/90 hover:bg-accent text-white rounded-md transition-colors flex items-center gap-2"
          >
            <kbd class="inline-flex items-center justify-center w-5 h-5 text-[10px] font-mono bg-white/20 rounded">{{ idx + 1 }}</kbd>
            {{ option }}
          </button>
        </div>

        <!-- Free text input -->
        <div v-else class="mt-4 flex gap-2">
          <input
            v-model="freeText"
            @keydown.enter="submitFreeText"
            type="text"
            placeholder="Type your response..."
            class="flex-1 px-3 py-2 text-sm bg-bg-primary border border-border rounded-md text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
            ref="inputRef"
          />
          <button
            @click="submitFreeText"
            :disabled="!freeText.trim()"
            class="px-4 py-2 text-sm bg-accent/90 hover:bg-accent text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  askUser: { type: Object, required: true }
})

const emit = defineEmits(['respond'])

const freeText = ref('')
const inputRef = ref(null)

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    dismiss()
    return
  }
  // Number keys 1-9 select options
  if (props.askUser.options?.length) {
    const num = parseInt(e.key, 10)
    if (num >= 1 && num <= props.askUser.options.length) {
      e.preventDefault()
      emit('respond', props.askUser.options[num - 1])
    }
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeyDown)
  if (!props.askUser.options?.length) {
    await nextTick()
    inputRef.value?.focus()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown)
})

function submitFreeText() {
  if (freeText.value.trim()) {
    emit('respond', freeText.value.trim())
    freeText.value = ''
  }
}

function dismiss() {
  emit('respond', 'Dismissed by user')
}
</script>
