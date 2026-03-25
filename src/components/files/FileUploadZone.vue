<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="dragging"
        class="upload-overlay"
        @drop.prevent="onDrop"
        @dragover.prevent
        @dragleave.prevent="onDragLeave"
      >
        <div class="upload-overlay-inner">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p class="upload-overlay-text">Drop file to upload</p>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['upload'])

const dragging = ref(false)
let dragCounter = 0

function onDragEnter(e) {
  e.preventDefault()
  dragCounter++
  if (e.dataTransfer?.types?.includes('Files')) {
    dragging.value = true
  }
}

function onDragLeave(e) {
  e.preventDefault()
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragging.value = false
  }
}

function onDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  dragCounter = 0
  dragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length > 0) {
    emit('upload', files[0])
  }
}

function onDragOver(e) {
  e.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onUnmounted(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})
</script>

<style scoped>
.upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.upload-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px;
  border-radius: 16px;
  border: 2px dashed var(--color-accent);
  background: var(--color-bg-secondary);
  color: var(--color-accent);
}

.upload-overlay-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
