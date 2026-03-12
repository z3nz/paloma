import { ref, watch } from 'vue'

// Singleton state preserved across HMR
const _saved = import.meta.hot ? window.__PALOMA_KEYBOARD__ : undefined
const sidebarCollapsed = _saved?.sidebarCollapsed ?? ref(localStorage.getItem('paloma:sidebarCollapsed') === 'true')

if (import.meta.hot) {
  window.__PALOMA_KEYBOARD__ = { sidebarCollapsed }
}

watch(sidebarCollapsed, (v) => {
  localStorage.setItem('paloma:sidebarCollapsed', String(v))
})

export function useKeyboardShortcuts() {
  return { sidebarCollapsed }
}

/**
 * Register global keyboard shortcuts. Call once from App.vue setup.
 * Returns a cleanup function to remove the listener.
 *
 * Shortcuts:
 *   Ctrl+/  — toggle sidebar
 *   Ctrl+N  — new chat
 *   Escape  — close modals, then stop streaming
 */
export function registerKeyboardShortcuts({ onNewChat, onStopStreaming, onCloseModals, onToggleVoice }) {
  function handleKeyDown(e) {
    // Escape — always available, even in inputs
    if (e.key === 'Escape') {
      // Try closing modals first; if nothing was open, stop streaming
      if (onCloseModals?.()) return
      onStopStreaming?.()
      return
    }

    // Ctrl/Cmd shortcuts work everywhere (including textareas)
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '/') {
        e.preventDefault()
        sidebarCollapsed.value = !sidebarCollapsed.value
        return
      }

      if (e.key === 'n') {
        e.preventDefault()
        onNewChat?.()
        return
      }

      if (e.key === 'm') {
        e.preventDefault()
        onToggleVoice?.()
        return
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}
