import { ref, watch, watchEffect } from 'vue'

// --- Singleton state (HMR-safe) ---
const theme = window.__PALOMA_THEME__?.theme || ref(localStorage.getItem('paloma:theme') || 'dark')

window.__PALOMA_THEME__ = { theme }

// Persist to localStorage
watch(theme, (val) => {
  localStorage.setItem('paloma:theme', val)
})

// Apply theme class to document element
watchEffect(() => {
  if (theme.value === 'light') {
    document.documentElement.classList.add('paloma-light')
  } else {
    document.documentElement.classList.remove('paloma-light')
  }
})

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return {
    theme,
    toggleTheme
  }
}
