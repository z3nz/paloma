import { createApp } from 'vue'
import './styles/main.css'
import App from './App.vue'

const app = createApp(App)

// Global error handler — catch unhandled errors in Vue components
app.config.errorHandler = (err, instance, info) => {
  console.error(`[Vue Error] ${info}:`, err)
  // Prevent the error from crashing the entire app
}

// Catch unhandled promise rejections from composables and async event handlers
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]:', event.reason)
})

app.mount('#app')
