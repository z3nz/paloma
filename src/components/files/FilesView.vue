<template>
  <div class="files-view">
    <!-- No project loaded -->
    <div v-if="!projectSlug" class="files-empty-state">
      <div class="files-empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h2 class="files-empty-title">Open a project to see its files</h2>
      <p class="files-empty-sub">Type /project in the prompt to switch projects.</p>
    </div>

    <!-- Project loaded -->
    <template v-else>
      <FileUploadZone @upload="onFileDrop" />

      <!-- Header -->
      <div class="files-header">
        <h1 class="files-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="files-title-icon">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Files
          <span class="files-project-badge">{{ projectSlug }}</span>
        </h1>
        <button class="upload-btn" @click="triggerFilePicker">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Upload
        </button>
        <input
          ref="fileInput"
          type="file"
          class="sr-only"
          @change="onFileInputChange"
        />
      </div>

      <!-- Upload form (shown when a file is staged) -->
      <div v-if="stagedFile" class="upload-form">
        <div class="upload-form-row">
          <label class="upload-label">Filename</label>
          <input
            v-model="stagedName"
            class="upload-input"
            @keydown.enter="confirmUpload"
          />
        </div>
        <p class="upload-hint">Use format: type-description-date.ext (e.g., contract-sow-march2026.pdf)</p>
        <div class="upload-form-actions">
          <button class="upload-cancel-btn" @click="cancelUpload">Cancel</button>
          <button class="upload-confirm-btn" :disabled="uploading" @click="confirmUpload">
            {{ uploading ? 'Uploading...' : 'Upload' }}
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="files-error">
        <span>{{ error }}</span>
        <button @click="error = null" class="files-error-dismiss">&times;</button>
      </div>

      <!-- File list -->
      <FilesList :files="files" :slug="projectSlug" :bridge-url="getBridgeUrl()" @delete="handleDelete" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useProject } from '../../composables/useProject.js'
import FileUploadZone from './FileUploadZone.vue'
import FilesList from './FilesList.vue'

const { projectRoot, projectName } = useProject()

const files = ref([])
const uploading = ref(false)
const error = ref(null)
const stagedFile = ref(null)
const stagedName = ref('')
const fileInput = ref(null)

const projectSlug = computed(() => {
  if (!projectRoot.value) return projectName.value || null
  return projectRoot.value.split('/').pop()
})

function getBridgeUrl() {
  const wsUrl = localStorage.getItem('paloma:mcpBridgeUrl') || 'ws://localhost:19191'
  return wsUrl.replace('ws://', 'http://').replace('wss://', 'https://')
}

async function loadFiles() {
  if (!projectSlug.value) return
  try {
    const res = await fetch(`${getBridgeUrl()}/api/files/${projectSlug.value}`)
    if (!res.ok) throw new Error(`Failed to load files: ${res.status}`)
    const data = await res.json()
    files.value = data.files || []
  } catch (e) {
    console.error('[FilesView] loadFiles:', e)
    // Don't show error for 404 — just means no files yet
    if (!e.message.includes('404')) {
      error.value = e.message
    }
    files.value = []
  }
}

function triggerFilePicker() {
  fileInput.value?.click()
}

function onFileInputChange(e) {
  const file = e.target.files?.[0]
  if (file) stageFile(file)
  // Reset so the same file can be re-selected
  if (fileInput.value) fileInput.value.value = ''
}

function onFileDrop(file) {
  stageFile(file)
}

function stageFile(file) {
  stagedFile.value = file
  stagedName.value = file.name.replace(/\s+/g, '-').toLowerCase()
}

function cancelUpload() {
  stagedFile.value = null
  stagedName.value = ''
}

async function confirmUpload() {
  if (!stagedFile.value || !projectSlug.value || uploading.value) return

  uploading.value = true
  error.value = null

  try {
    const file = stagedFile.value
    const base64 = await fileToBase64(file)

    const res = await fetch(`${getBridgeUrl()}/api/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: projectSlug.value,
        filename: stagedName.value,
        data: base64,
        mimeType: file.type || 'application/octet-stream'
      })
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Upload failed: ${res.status}`)
    }

    stagedFile.value = null
    stagedName.value = ''
    await loadFiles()
  } catch (e) {
    console.error('[FilesView] upload:', e)
    error.value = e.message
  } finally {
    uploading.value = false
  }
}

async function handleDelete(filename) {
  if (!projectSlug.value) return
  try {
    const res = await fetch(`${getBridgeUrl()}/api/files/${projectSlug.value}/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Delete failed: ${res.status}`)
    }
    await loadFiles()
  } catch (e) {
    console.error('[FilesView] delete:', e)
    error.value = e.message
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // Strip the data URL prefix (e.g., "data:application/pdf;base64,")
      const result = reader.result
      const base64 = result.substring(result.indexOf(',') + 1)
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

onMounted(() => {
  if (projectSlug.value) loadFiles()
})

watch(projectSlug, (slug) => {
  if (slug) loadFiles()
  else files.value = []
})
</script>

<style scoped>
.files-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  overflow: hidden;
}

.files-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  text-align: center;
}

.files-empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  color: var(--color-text-muted);
}

.files-empty-title {
  font-size: 20px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.files-empty-sub {
  font-size: 14px;
  color: var(--color-text-muted);
}

.files-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.files-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  flex: 1;
}

.files-title-icon {
  color: var(--color-accent);
}

.files-project-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.upload-btn:hover {
  filter: brightness(1.1);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Upload form */
.upload-form {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}

.upload-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.upload-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.upload-input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.upload-input:focus {
  border-color: var(--color-accent);
}

.upload-hint {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.upload-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.upload-cancel-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.upload-cancel-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-text-muted);
}

.upload-confirm-btn {
  padding: 5px 14px;
  border-radius: 6px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.upload-confirm-btn:hover {
  filter: brightness(1.1);
}

.upload-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Error bar */
.files-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--color-danger, #ef4444);
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}

.files-error-dismiss {
  background: none;
  border: none;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.7;
}

.files-error-dismiss:hover {
  opacity: 1;
}
</style>
