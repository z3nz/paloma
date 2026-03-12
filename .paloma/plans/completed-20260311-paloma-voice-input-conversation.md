# Voice Input & Conversation Loop

**Status:** completed  
**Created:** 2026-03-11  
**Scope:** paloma  
**Goal:** Enable true voice conversations with Paloma — Adam speaks, Paloma listens, transcribes, responds in text + JARVIS voice, creating a seamless back-and-forth loop.

## Context

TTS (Paloma → Adam) is fully shipped via Kokoro/JARVIS. The missing half is STT (Adam → Paloma) — voice input that captures speech, transcribes it, and feeds it into the chat pipeline.

## Requirements

- Adam can speak to Paloma through the browser UI
- Speech is transcribed in real-time (live preview in input)
- Messages auto-send after a natural pause
- Full conversation loop: speak → transcribe → process → respond + speak → listen again
- Built properly from the ground up — no duct tape
- Works with existing WebSocket bridge and chat pipeline

## Pipeline

- [x] **Scout** — Research complete. Findings: `.paloma/docs/scout-voice-input-conversation-20260311.md`
- [x] **Chart** — Design complete (below)
- [x] **Forge** — Build complete
- [x] **Polish** — Review, test, refine
- [x] **Ship** — Commit, document, archive

## Scout Findings Summary

**Recommended approach:** Web Speech API (browser-native, Chrome on Windows)
- Zero dependencies, zero API keys, zero bridge changes
- Works on localhost without HTTPS
- `continuous = false` + auto-restart on `onend` (avoids network error gotcha)
- Interim results for live transcript preview
- Chrome's built-in VAD handles pause detection (~1-2s silence)
- TTS is synchronous — when `streaming` goes false, audio is done
- Upgrade path: Deepgram if Web Speech API proves insufficient

## Chart Design

### Design Decisions

#### 1. Auto-send: Send on `onend` (trust the VAD)

**Decision:** Send immediately when `onend` fires with accumulated transcript. No additional timer.

**Reasoning:** Chrome's server-side VAD fires `onend` after ~1-2 seconds of genuine silence. This is Google's production-grade speech detection — battle-tested at scale. Adding our own timer on top creates a double-delay that makes the conversation feel sluggish. The JARVIS experience should feel like talking to a person: you stop talking, they respond.

If the user wants to add more after a pause, their next utterance starts a new message. This matches natural conversation — short turns, back-and-forth exchanges. JARVIS isn't a lecture hall; it's a dialogue.

**Edge case — mid-thought pause:** With `continuous = false`, a 2-second pause between sentences triggers `onend`. This could split a long thought across two messages. Acceptable for v1 because: (a) conversational voice is naturally short-turn, (b) the user can always type for longer inputs, (c) the AI handles multi-message context well. If this proves annoying, v2 can add an optional accumulation buffer.

#### 2. Interim transcript: Direct in textarea (replace mode)

**Decision:** Show interim text directly in the textarea via `input.value`. Replace mode — when listening, voice controls the textarea entirely.

**Reasoning:** This is the simplest approach and feels most natural. The user sees what they're saying in the exact place where text goes. No separate overlay element, no ghost text, no complex DOM management.

**Why replace, not append:** Voice mode is a distinct input mode. When you're speaking, the mic owns the textarea. If you want to type, toggle voice off first. Trying to mix typed and spoken text creates ambiguity about what gets sent and confusing cursor behavior.

**Draft persistence:** The existing 500ms debounce on draft saves naturally handles this — interim text changes too rapidly for saves to fire during active speech, and the final transcript triggers send (which clears input) before any draft save fires.

#### 3. Voice mode scope: Global singleton, no special session handling

**Decision:** `voiceMode` is a global singleton ref (like all Paloma composable state). No reset on session switch.

**Reasoning:** The `streaming` ref that drives the conversation loop is already scoped to the active session via `useSessionState`. When `streaming` transitions false→true→false, ChatView's watcher fires — but only for the currently viewed session. So the conversation loop restart naturally scopes to whichever session Adam is looking at.

If Adam toggles voice mode on and switches sessions, the mic simply idles (no streaming to trigger restart). When he switches back or when the current session's response finishes, voice mode is still on and the loop continues. This is the behavior you'd want — voice mode is a user preference, not a session property.

#### 4. Mic button: Inside textarea area, left of send/stop

**Decision:** Add a mic toggle button inside the textarea wrapper, positioned to the left of the existing send/stop button. Both buttons coexist.

**Layout:**
```
[textarea .................................. [🎤] [➤]]
```

**Visual states:**
| State | Mic Button Appearance |
|-------|----------------------|
| Voice off | Muted icon (`text-text-muted`), subtle hover |
| Voice on, not listening | Accent-highlighted (`bg-accent/20 text-accent`) |
| Voice on, listening | Solid accent with pulse ring animation (`bg-accent text-white` + CSS pulse) |

**Why here, not in controls row:** The mic button is a primary input action, not a setting. It belongs where input actions live — next to the send button. Users look at the textarea when composing; the mic should be right there.

**Positioning:** Mic at `right-10 bottom-3` (absolute), send/stop stays at `right-3 bottom-3`. Textarea `pr-12` padding increases to `pr-20` when voice is supported, to avoid text overlapping both buttons.

#### 5. Error handling: Inline message, auto-clear, graceful degradation

**Decision:** Errors show as a small inline message in the controls row below the textarea. Auto-dismiss after 5 seconds. Critical errors (permission denied, no mic) automatically disable voice mode.

**Error mapping:**
| Error Code | Message | Action |
|-----------|---------|--------|
| `not-allowed` | "Microphone access needed — check browser permissions" | Disable voiceMode |
| `audio-capture` | "No microphone detected" | Disable voiceMode |
| `network` | "Voice recognition unavailable — network issue" | Restart if voiceMode; disable after 3 consecutive |
| `no-speech` | *(no message shown)* | Silently restart if voiceMode |
| `aborted` | *(no message shown)* | Normal — happens on manual stop |

---

### Composable API: `useVoiceInput.js`

```
File: src/composables/useVoiceInput.js (CREATE)
Pattern: HMR-safe singleton (window.__PALOMA_VOICE__)
```

#### Exposed State

| Ref | Type | Description |
|-----|------|-------------|
| `supported` | `ComputedRef<boolean>` | `true` if `SpeechRecognition` or `webkitSpeechRecognition` exists |
| `voiceMode` | `Ref<boolean>` | Voice conversation mode toggle. When on, conversation loops. |
| `isListening` | `Ref<boolean>` | Mic is currently active and capturing. |
| `interimTranscript` | `Ref<string>` | Live preview text — updates rapidly during speech. Cleared on end. |
| `pendingSend` | `Ref<string\|null>` | Set when speech ends naturally with content. Consumer reads, sends, and clears. |
| `error` | `Ref<string\|null>` | Error code: `'mic-permission'`, `'network'`, `'no-mic'`, or `null`. |

#### Exposed Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `toggleVoiceMode` | `() => void` | Toggle `voiceMode`. If turning ON, starts listening. If turning OFF, stops listening. |
| `startListening` | `() => void` | Begin a speech recognition session. Sets `isListening = true`. No-op if already listening or not supported. |
| `stopListening` | `() => void` | Manually stop recognition. Sets `isListening = false`. Does NOT trigger `pendingSend`. |
| `clearError` | `() => void` | Reset `error` to `null`. |

#### Internal State (not exposed)

| Variable | Type | Description |
|----------|------|-------------|
| `recognition` | `SpeechRecognition\|null` | Browser singleton instance. Created lazily. |
| `accumulatedFinal` | `string` | Accumulated final transcript fragments within one recognition session. |
| `manualStop` | `boolean` | Flag to distinguish manual stop from natural `onend`. |
| `consecutiveNetworkErrors` | `number` | Counter for network errors. Resets on successful recognition. Disables voice after 3. |

#### Internal Flow

```
toggleVoiceMode()
  → voiceMode = !voiceMode
  → if ON:  startListening()
  → if OFF: stopListening()

startListening()
  → guard: if !supported || isListening → return
  → manualStop = false
  → accumulatedFinal = ''
  → interimTranscript = ''
  → error = null
  → recognition.start()
  → isListening = true

stopListening()
  → manualStop = true
  → recognition.stop()    // triggers onend
  → isListening = false
  → interimTranscript = ''

recognition.onresult = (event) =>
  → iterate event.results from event.resultIndex
  → isFinal fragments → append to accumulatedFinal
  → non-final fragments → build interim string
  → interimTranscript = accumulatedFinal + interim

recognition.onend = () =>
  → isListening = false
  → interimTranscript = ''
  → if manualStop → return (don't send)
  → if accumulatedFinal.trim():
      → pendingSend = accumulatedFinal.trim()
      → accumulatedFinal = ''
      → consecutiveNetworkErrors = 0
  → else if voiceMode:
      → auto-restart (no-speech timeout, keep listening)

recognition.onerror = (event) =>
  → map event.error to error ref:
      'not-allowed' → error = 'mic-permission', voiceMode = false
      'audio-capture' → error = 'no-mic', voiceMode = false
      'network' → consecutiveNetworkErrors++
                → if >= 3: error = 'network', voiceMode = false
                → else: (silent, onend will auto-restart)
      'no-speech' → (silent, onend will auto-restart)
      'aborted' → (silent, expected on manual stop)
```

#### HMR Preservation

```js
const _saved = import.meta.hot ? window.__PALOMA_VOICE__ : undefined
const voiceMode = _saved?.voiceMode ?? ref(false)
const isListening = _saved?.isListening ?? ref(false)
const interimTranscript = _saved?.interimTranscript ?? ref('')
const pendingSend = _saved?.pendingSend ?? ref(null)
const error = _saved?.error ?? ref(null)
if (import.meta.hot) {
  window.__PALOMA_VOICE__ = { voiceMode, isListening, interimTranscript, pendingSend, error }
}
```

Note: The `SpeechRecognition` instance itself is NOT preserved across HMR — it's recreated lazily. `isListening` may be stale after HMR reload, but that's acceptable (worst case: icon shows listening state but recognition died — next user interaction resets it).

---

### Component Changes

#### PromptBuilder.vue (MODIFY)

**Script changes:**
1. Import `useVoiceInput`
2. Wire `interimTranscript` → textarea live preview
3. Wire `pendingSend` → inject text and trigger `send()`
4. Add computed for mic button classes and error message
5. Adjust `canSend` — allow send even in voice mode (manual send still works)

```js
// New imports
import { useVoiceInput } from '../../composables/useVoiceInput.js'

// In setup:
const {
  supported: voiceSupported,
  voiceMode, isListening, interimTranscript, pendingSend,
  error: voiceError,
  toggleVoiceMode, stopListening, clearError
} = useVoiceInput()

// Live preview: voice controls textarea while listening
watch(interimTranscript, (text) => {
  if (isListening.value) {
    input.value = text
  }
})

// Send trigger: composable signals "done speaking, send this"
watch(pendingSend, (text) => {
  if (text) {
    input.value = text
    pendingSend.value = null
    nextTick(() => send())
  }
})

// Mic button computed classes
const micButtonClasses = computed(() => {
  if (!voiceMode.value) return 'text-text-muted hover:text-text-primary'
  if (isListening.value) return 'bg-accent text-white voice-pulse'
  return 'bg-accent/20 text-accent'
})

// Error message
const voiceErrorMessage = computed(() => {
  switch (voiceError.value) {
    case 'mic-permission': return 'Microphone access needed — check browser permissions'
    case 'network': return 'Voice recognition unavailable — network issue'
    case 'no-mic': return 'No microphone detected'
    default: return ''
  }
})

// Auto-clear error after 5 seconds
watch(voiceError, (err) => {
  if (err) setTimeout(() => clearError(), 5000)
})
```

**Template changes:**

1. Textarea padding: `pr-12` → dynamic based on `voiceSupported`

```html
<textarea
  ...
  :class="['prompt-textarea w-full ...', voiceSupported ? 'pr-20' : 'pr-12']"
/>
```

2. Add mic button before send/stop button:

```html
<!-- Mic toggle (only when Web Speech API is available) -->
<button
  v-if="voiceSupported"
  @click="toggleVoiceMode"
  class="absolute right-10 bottom-3 p-1.5 rounded-md transition-colors"
  :class="micButtonClasses"
  :title="voiceMode ? (isListening ? 'Listening... (Ctrl+M to stop)' : 'Voice mode on (Ctrl+M)') : 'Voice mode (Ctrl+M)'"
>
  <!-- Mic SVG icon -->
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
</button>
```

3. Voice error message in controls row:

```html
<div class="flex items-center justify-between mt-2">
  <div class="flex items-center gap-3">
    <ModelSelector ... />
    <PhaseSelector ... />
  </div>
  <div class="text-xs text-text-muted">
    <span v-if="voiceErrorMessage" class="text-warning">{{ voiceErrorMessage }}</span>
    <span v-else-if="modelsError" class="text-warning" ...>Models: offline</span>
    <span v-else-if="indexing">Indexing files...</span>
  </div>
</div>
```

**Style changes:**

Add pulse animation (scoped CSS or inline in template):

```css
.voice-pulse {
  animation: voice-pulse 1.5s ease-in-out infinite;
}
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); }
}
```

Note: Use the project's accent color CSS variable if available. If Tailwind handles accent as a variable, extract its RGB value. Otherwise, hardcode a reasonable indigo/blue that matches the existing accent.

---

#### ChatView.vue (MODIFY)

**Script changes:**

1. Import `useVoiceInput`
2. Add conversation loop restart in the existing `streaming` watcher

```js
import { useVoiceInput } from '../../composables/useVoiceInput.js'

// In setup:
const { voiceMode, startListening } = useVoiceInput()

// Modify existing streaming watcher:
watch(streaming, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // Existing: detect code changes
    const lastMsg = messages.value.findLast(m => m.role === 'assistant' && m.content)
    if (lastMsg?.content) {
      detectChanges(lastMsg.content, dirHandle.value)
    }

    // NEW: Conversation loop — restart listening after response completes
    if (voiceMode.value) {
      setTimeout(() => startListening(), 500)
    }
  }
})
```

The 500ms delay ensures: (a) TTS audio has fully completed (it's synchronous but the MCP tool return might race slightly), and (b) a brief natural pause between Paloma finishing and listening restarting — feels conversational, not robotic.

---

#### useKeyboardShortcuts.js (MODIFY)

**Changes:**

1. Add `onToggleVoice` callback parameter to `registerKeyboardShortcuts`
2. Add `Ctrl+M` handler

```js
export function registerKeyboardShortcuts({ onNewChat, onStopStreaming, onCloseModals, onToggleVoice }) {
  function handleKeyDown(e) {
    // ... existing Escape handler ...

    if (e.ctrlKey || e.metaKey) {
      // ... existing Ctrl+/ and Ctrl+N ...

      if (e.key === 'm') {
        e.preventDefault()
        onToggleVoice?.()
        return
      }
    }
  }
  // ...
}
```

#### App.vue (MODIFY)

**Changes:**

1. Import `useVoiceInput`
2. Pass `onToggleVoice` callback to `registerKeyboardShortcuts`

```js
import { useVoiceInput } from './composables/useVoiceInput.js'

const { toggleVoiceMode } = useVoiceInput()

const cleanupShortcuts = registerKeyboardShortcuts({
  onNewChat: () => { if (bridgeConnected.value) handleNewChat() },
  onStopStreaming: () => { if (streaming.value) stopStreaming() },
  onCloseModals: () => { /* ... existing ... */ },
  onToggleVoice: () => toggleVoiceMode()
})
```

---

### Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  User speaks into mic                                         │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Web Speech API (Chrome → Google Cloud STT)                   │
│  recognition.onresult → interim + final fragments             │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  useVoiceInput.js                                             │
│  interimTranscript (live) ──→ PromptBuilder textarea preview  │
│  onend → pendingSend ────────→ PromptBuilder send trigger     │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  PromptBuilder.vue                                            │
│  input.value = pendingSend → nextTick → send()                │
│  emit('send', { content, files })                             │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ChatView.vue → sendMessage() → useChat.js → bridge           │
│  streaming: false → true                                      │
│  (AI processes, JARVIS speaks via tool call)                  │
│  streaming: true → false                                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ChatView.vue streaming watcher                               │
│  if voiceMode → setTimeout(500ms) → startListening()          │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
           [Loop back to top — conversation continues]
```

### Files Summary

| File | Action | Scope |
|------|--------|-------|
| `src/composables/useVoiceInput.js` | **Create** | Core composable — SpeechRecognition wrapper, all voice state |
| `src/components/prompt/PromptBuilder.vue` | **Modify** | Mic button, interim preview, send trigger, error display, pulse CSS |
| `src/components/chat/ChatView.vue` | **Modify** | Conversation loop restart (3 lines in streaming watcher) |
| `src/composables/useKeyboardShortcuts.js` | **Modify** | Add `Ctrl+M` handler and `onToggleVoice` callback |
| `src/App.vue` | **Modify** | Wire `onToggleVoice` to `registerKeyboardShortcuts` |

**Not touched:** Bridge, MCP servers, Python, DNA files (base.js, phases.js). This is pure browser-side work.

### Edge Cases & Notes

1. **HMR resilience:** SpeechRecognition instance dies on HMR but refs persist. If `isListening` is stale after HMR, next `toggleVoiceMode` or `startListening` call creates a fresh instance and corrects state.

2. **Multiple rapid toggles:** `toggleVoiceMode` should be idempotent. If called while recognition is starting, the `manualStop` flag ensures clean teardown.

3. **Tab visibility:** Chrome may stop recognition when tab loses focus. Acceptable — the user isn't speaking to a background tab. When they return and the conversation loop triggers, it restarts.

4. **No speech detected:** Chrome fires `onerror` with `'no-speech'` then `onend`. In voice mode, we silently restart. No error shown — the user just wasn't talking.

5. **Escape key interaction:** Existing Escape handler in ChatView stops streaming. Should it also stop listening? **Yes** — add to the `onCloseModals` flow: if listening, stop listening and return true (consumed the keypress). This gives Escape a natural priority: close modals → stop listening → stop streaming.

6. **Textarea placeholder in voice mode:** Could optionally change to "Listening..." when `isListening` is true. Nice touch but not required for v1.

## Work Units

_(see below — added by pillar_decompose)_

#### WU-1: Create useVoiceInput
- **Feature:** Voice Input Core
- **Status:** done
- **Files:** src/composables/useVoiceInput.js
- **Scope:** Create useVoiceInput.js composable — the core Web Speech API wrapper with HMR singleton pattern, SpeechRecognition lifecycle, all exposed state (voiceMode, isListening, interimTranscript, pendingSend, error, supported) and methods (toggleVoiceMode, startListening, stopListening, clearError). Implements onresult/onend/onerror handlers per the Chart spec.
- **Acceptance:** Composable exports all specified refs and methods. SpeechRecognition is lazily created. HMR state is preserved. Manual stop vs natural end are distinguished via manualStop flag. pendingSend is set only on natural end with content.

#### WU-2: Modify PromptBuilder
- **Feature:** Voice Input UI
- **Status:** done
- **Depends on:** WU-1
- **Files:** src/components/prompt/PromptBuilder.vue
- **Scope:** Modify PromptBuilder.vue to integrate voice input — add mic toggle button (absolute positioned left of send/stop), wire interimTranscript to textarea live preview, wire pendingSend to auto-send trigger, add voice error message in controls row, add voice-pulse CSS animation, adjust textarea right padding when voice is supported.
- **Acceptance:** Mic button visible when Web Speech API is supported. Clicking toggles voiceMode. Interim text appears in textarea while listening. Mic button pulses during active listening. Auto-send fires when speech ends naturally. Voice errors display inline and auto-clear after 5s.

#### WU-3: Modify ChatView
- **Feature:** Conversation Loop
- **Status:** done
- **Depends on:** WU-1
- **Files:** src/components/chat/ChatView.vue
- **Scope:** Modify ChatView.vue to add conversation loop — when streaming transitions true→false and voiceMode is active, setTimeout(500ms) then startListening(). Only 3 new lines in the existing streaming watcher plus the import.
- **Acceptance:** After AI response completes (streaming false) with voiceMode on, mic automatically restarts after 500ms delay. Loop continues until voiceMode is toggled off.

#### WU-4: Add Ctrl+M keyboard shortcut — modify useKeyboardShortcuts
- **Feature:** Keyboard Shortcut
- **Status:** done
- **Depends on:** WU-1
- **Files:** src/composables/useKeyboardShortcuts.js, src/App.vue
- **Scope:** Add Ctrl+M keyboard shortcut — modify useKeyboardShortcuts.js to add onToggleVoice callback and Ctrl+M handler, modify App.vue to import useVoiceInput and wire toggleVoiceMode to the shortcut registration.
- **Acceptance:** Ctrl+M toggles voice mode from anywhere in the app. Shortcut works in textarea (Ctrl combo). App.vue passes toggleVoiceMode callback to registerKeyboardShortcuts.
