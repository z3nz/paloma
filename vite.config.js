import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Custom plugin: prevent Vite from ever doing a full-page reload.
// HMR updates apply normally, but if a module can't be hot-replaced,
// we skip the reload instead of nuking the page mid-stream.
function noFullReload() {
  return {
    name: 'no-full-reload',
    handleHotUpdate({ modules }) {
      // If any module is not HMR-compatible, return empty array to suppress reload
      const nonHmr = modules.filter(m => !m.isSelfAccepting)
      if (nonHmr.length > 0) {
        console.log('[HMR] Skipping full reload for:', nonHmr.map(m => m.file).join(', '))
        return []
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), noFullReload()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: true
    },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/bridge/**',
        '**/.claude/**',
        '**/.paloma/**',
        '**/chats/**',
        '**/projects/**'
      ]
    }
  }
})
