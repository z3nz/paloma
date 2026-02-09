import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      // Prevent full-page reloads — only apply HMR updates or do nothing
      overlay: true
    },
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/bridge/**', '**/.claude/**']
    }
  }
})
