<template>
  <div class="files-list">
    <div v-if="files.length === 0" class="files-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <p>No files yet. Drag and drop to upload.</p>
    </div>

    <table v-else class="files-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Date</th>
          <th>Size</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in files" :key="file.filename" class="files-row">
          <td class="file-name">{{ file.filename }}</td>
          <td class="file-date">{{ formatDate(file.uploadedAt) }}</td>
          <td class="file-size">{{ formatSize(file.size) }}</td>
          <td class="file-actions">
            <a
              :href="`${bridgeUrl}/api/files/${slug}/${encodeURIComponent(file.filename)}`"
              download
              class="action-btn"
              title="Download"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
            <button
              @click="$emit('delete', file.filename)"
              class="action-btn action-btn-danger"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  files: { type: Array, default: () => [] },
  slug: { type: String, default: '' },
  bridgeUrl: { type: String, default: '' }
})

defineEmits(['delete'])

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>

<style scoped>
.files-list {
  flex: 1;
  overflow-y: auto;
}

.files-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--color-text-muted);
  padding: 48px;
  text-align: center;
}

.files-empty svg {
  opacity: 0.2;
}

.files-empty p {
  font-size: 14px;
}

.files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.files-table thead th {
  text-align: left;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: var(--color-bg-primary);
  z-index: 1;
}

.files-row {
  border-bottom: 1px solid var(--color-border);
  transition: background 0.1s ease;
}

.files-row:hover {
  background: var(--color-bg-hover, var(--color-bg-secondary));
}

.files-row td {
  padding: 10px 12px;
  vertical-align: middle;
}

.file-name {
  font-weight: 500;
  color: var(--color-text-primary);
  word-break: break-all;
}

.file-date,
.file-size {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.file-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.action-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.action-btn-danger:hover {
  color: var(--color-danger, #ef4444);
}
</style>
