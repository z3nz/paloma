import { createApp } from 'vue'
import './styles/main.css'
import App from './App.vue'

createApp(App).mount('#app')

// HMR diagnostics — detect full page reload vs hot update
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.warn('[HMR] vite:beforeFullReload — full page reload triggered. import.meta.hot.data will be lost.')
  })
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    console.log('[HMR] vite:beforeUpdate — hot update (no full reload)', payload)
  })
  import.meta.hot.on('vite:error', (err) => {
    console.error('[HMR] vite:error', err)
  })
  console.log('[HMR] main.js: listeners registered')
}
