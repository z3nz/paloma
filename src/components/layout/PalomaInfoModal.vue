<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="$emit('close')">
    <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
    <div class="relative bg-bg-secondary border border-border rounded-lg w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div class="flex items-center gap-3">
          <img src="/Paloma-logo.png" alt="Paloma" class="h-8 w-auto object-contain" />
          <div>
            <h2 class="text-lg font-semibold text-text-primary">About Paloma</h2>
            <p class="text-sm text-text-muted">System overview, architecture, memory, and capabilities</p>
          </div>
        </div>
        <button
          @click="$emit('close')"
          class="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="px-6 py-5 space-y-5 overflow-y-auto">
        <section class="bg-bg-primary border border-border rounded-md p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-2">Stack</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-text-muted">Frontend</div>
              <div class="text-text-primary">Vue 3, Vite 5, Tailwind CSS v4</div>
            </div>
            <div>
              <div class="text-text-muted">Bridge</div>
              <div class="text-text-primary">Node.js WebSocket server + MCP proxy</div>
            </div>
            <div>
              <div class="text-text-muted">AI Backends</div>
              <div class="text-text-primary">OpenRouter, Claude CLI, Codex CLI, Ollama</div>
            </div>
            <div>
              <div class="text-text-muted">Persistence</div>
              <div class="text-text-primary">IndexedDB via Dexie + SQLite semantic memory</div>
            </div>
          </div>
        </section>

        <section class="bg-bg-primary border border-border rounded-md p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-2">Build Out</h3>
          <div class="space-y-2 text-sm text-text-secondary leading-6">
            <p>The browser runs the chat UI, session state, tool approval dialogs, and IndexedDB transcript persistence.</p>
            <p>The bridge on ports 19191 and 19192 manages Claude, Codex, and Ollama sessions, routes MCP tools, handles pillar orchestration, and coordinates callbacks back into Flow.</p>
            <p>Paloma uses a six-pillar workflow: Flow, Scout, Chart, Forge, Polish, and Ship, with Flow acting as the persistent head mind.</p>
          </div>
        </section>

        <section class="bg-bg-primary border border-border rounded-md p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-2">Memory System</h3>
          <div class="space-y-2 text-sm text-text-secondary leading-6">
            <p>Chat transcripts are persisted locally in IndexedDB for session continuity and draft recovery.</p>
            <p>Long-term semantic memory lives in <span class="text-text-primary">mcp-servers/memory.js</span> using Ollama <span class="text-text-primary">nomic-embed-text</span> embeddings.</p>
            <p>The preferred local backend is <span class="text-text-primary">~/.paloma/memory/memory.sqlite</span>, with legacy JSON memories automatically imported and archived on first access.</p>
            <p>If <span class="text-text-primary">node:sqlite</span> is unavailable, the memory server falls back to the legacy local JSON backend instead of failing startup.</p>
          </div>
        </section>

        <section class="bg-bg-primary border border-border rounded-md p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-2">Functionalities</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-text-secondary">
            <div>Pillar-based orchestration and callbacks</div>
            <div>MCP tool approval and execution</div>
            <div>Project-aware prompts and plan loading</div>
            <div>Multi-session chat persistence</div>
            <div>Claude, Codex, and Ollama model paths</div>
            <div>Voice synthesis through Kokoro TTS</div>
            <div>Changes panel and diff preview flows</div>
            <div>Cost tracking and context usage display</div>
          </div>
        </section>

        <section class="bg-accent/10 border border-accent/20 rounded-md p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-2">Credits</h3>
          <p class="text-sm text-text-secondary leading-6">
            This system was built by <span class="text-text-primary">Adam Lynch</span>, modified by <span class="text-text-primary">Michai Morin</span>, and architected by <span class="text-text-primary">PALOMA</span>.
          </p>
        </section>
      </div>

      <div class="flex justify-end px-6 py-4 border-t border-border shrink-0">
        <button
          @click="$emit('close')"
          class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineEmits(['close'])
</script>