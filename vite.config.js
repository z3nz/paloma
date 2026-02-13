import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Custom plugin: prevent Vite from ever doing a full-page reload.
// Intercepts the HMR WebSocket to block 'full-reload' messages entirely.
// Vue component HMR updates still work normally.
function noFullReload() {
  return {
    name: 'no-full-reload',
    configureServer(server) {
      server.ws.on('connection', (socket) => {
        const originalSend = socket.send.bind(socket)
        socket.send = (data) => {
          try {
            const msg = JSON.parse(data)
            if (msg.type === 'full-reload') {
              console.log('[HMR] Blocked full-reload:', msg.path || '(no path)')
              return // swallow it
            }
          } catch {}
          originalSend(data)
        }
      })
    },
    handleHotUpdate({ modules }) {
      const nonHmr = modules.filter(m => !m.isSelfAccepting)
      if (nonHmr.length > 0) {
        console.log('[HMR] Skipping non-HMR modules:', nonHmr.map(m => m.file).join(', '))
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
