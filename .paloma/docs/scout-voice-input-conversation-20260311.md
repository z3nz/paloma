# Scout: Voice Input & Conversation Loop

**Date:** 2026-03-11  
**Plan:** active-20260311-paloma-voice-input-conversation.md  
**Scout:** Full research pass — Web Speech API, STT alternatives, architecture, UX patterns

---

## Executive Summary

The Web Speech API in Windows Chrome is the right choice. Zero dependencies, zero cost, zero new MCP servers. It works reliably in Adam's environment (Windows Chrome hitting WSL2 localhost:5173), supports live interim results, and has a well-understood workaround for the auto-stop issue. The primary composable is ~120 lines of code.

The conversation loop connects naturally to the existing `streaming` ref in `useSessionState.js` — when `streaming` goes false and voice mode is active, restart listening after a short delay.

---

## 1. Browser Speech APIs — Web Speech API Deep Dive

### Browser Support
| Browser | Support | Notes |
|---------|---------|-------|
| **Chrome on Windows** | ✅ Full | Google cloud STT backend. Excellent accuracy. |
| Edge on Windows v134- | ✅ Full | Microsoft broke it in v134 (March 2025). Use Chrome. |
| Firefox | ❌ None | Not implemented as of 2026 |
| Safari (macOS/iOS) | ⚠️ Partial | Works but different behavior |
| Chromium on Linux | ❌ Broken | Mic permissions fail in Chromium Linux builds |

**Critical WSL2 Environment Note:** Adam's browser is Windows Chrome accessing `localhost:5173`. The Web Speech API runs in the Windows browser context — NOT inside WSL2's Linux. Windows Chrome has full microphone access via the Windows audio stack, and routes speech recognition through Google's cloud STT service. This works reliably. The Linux Chromium problem doesn't apply here.

### localhost / HTTPS
Web Speech API works on `localhost` without HTTPS. Stack Overflow confirms: "on local must be localhost, not https://+localhost". The Vite dev server on `localhost:5173` is fully compatible.

### Continuous Mode — The Gotcha
Setting `continuous = true` is **unreliable**. Microsoft's own forum confirms it "constantly throws 'network' errors when no speech is coming in." The correct pattern for persistent listening is:

```js
recognition.continuous = false   // NOT true
recognition.interimResults = true
recognition.onend = () => {
  if (voiceMode.value) recognition.start()  // Auto-restart
}
```

Chrome auto-stops after ~5–8 seconds of silence with `continuous=false`. This is actually desirable — the silence detection is Google's server-side VAD and it's good.

### Interim Results
`interimResults = true` fires `onresult` events as the user speaks, before the final transcript is confirmed. This enables live preview in the textarea while the user is mid-sentence. Essential for good UX.

```js
recognition.onresult = (event) => {
  let final = '', interim = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const r = event.results[i]
    if (r.isFinal) final += r[0].transcript
    else interim += r[0].transcript
  }
  // final goes into accumulated transcript
  // interim shows as live ghost text
}
```

### Auto-Stop and Silence Detection
Chrome's built-in end-of-speech detection is solid. It fires `onend` on genuine pauses (1–2s of silence). Brief breath pauses (< 0.5s) don't trigger it. This means:
- We don't need custom VAD for basic use
- `onend` with final results = user finished speaking
- Pattern: accumulate finals, send when `onend` fires with content

### Punctuation & Language
Chrome's speech recognition on Windows includes automatic punctuation in English. `recognition.lang = 'en-US'` is the right setting.

### Known Gotchas
1. **Edge v134+** broke Web Speech API (March 2025 regression). Chrome is the reliable choice.
2. **Microphone permission** must be granted. First use prompts the browser permission dialog. After that, `https://localhost` is trusted.
3. **Beep sound on start** — Chrome plays a click/beep when recognition starts. No way to suppress it. Acceptable for push-to-talk or toggle mode; jarring for auto-restart. **Workaround:** restart recognition immediately after `onend` — Chrome suppresses the beep on rapid restarts.
4. **Tab visibility** — Speech recognition may stop if the tab loses focus. Acceptable for this use case.
5. **Network required** — Chrome's speech recognition is cloud-based. No network = no STT. Acceptable for Paloma's use case.

---

## 2. Alternative STT Approaches

### Whisper WASM (Browser-Side)
**Verdict: Not for real-time use. Phase 2 offline option.**

- `whisper.cpp` compiles to WASM and runs in-browser
- Models: tiny.en (75MB), base.en (~145MB)
- Performance: 2–3x real-time on modern CPU (10s audio → 3–5s processing)
- Not suitable for streaming — batch only, processes after recording ends
- No server needed, fully offline
- GitHub: `ggml-org/whisper.cpp` — has a live stream WASM demo but latency is high

Conclusion: Excellent accuracy but unusable for live conversation. Could be a fallback if Google's cloud STT is unavailable.

### Local Whisper in WSL2
**Verdict: Best accuracy, medium complexity. Phase 2 upgrade path.**

- `faster-whisper` achieves 2–3s latency with streaming
- Fully offline, excellent accuracy
- Could live in a new MCP server or a new bridge WebSocket endpoint
- Would require capturing raw audio in the browser and sending to WSL2
- `kokoro_env` Python already exists — adding `faster-whisper` there is feasible
- GitHub: `ufal/whisper_streaming` — proven implementation for real-time STT

Complexity: Moderate. Audio capture → WebSocket to bridge → Python Whisper → text back to browser. Doable but not zero-setup.

### Deepgram (Cloud)
**Verdict: Best production option if Web Speech API disappoints.**

- Nova-3: <300ms streaming latency, excellent accuracy
- WebSocket-based streaming — built for this
- Pricing: ~$0.46/hr for streaming (Nova-3), ~$0.37/hr for AssemblyAI
- Requires API key + cost tracking
- Browser can connect directly to Deepgram WebSocket — no bridge changes needed
- Docs: highly developer-friendly

Cost estimate: Paloma voice sessions ~10 min/day → ~$0.08/day → ~$2.50/month. Very affordable if needed.

### Recommendation: Start with Web Speech API, upgrade path to Deepgram
Web Speech API works in Adam's environment with zero setup. If accuracy proves insufficient or reliability is an issue, Deepgram is the cleanest upgrade — same browser-based approach, just with a WebSocket to Deepgram's servers instead of Google's cloud.

---

## 3. Existing Architecture — Integration Points

### How Messages Are Sent
The send path is:
```
PromptBuilder.vue::send()
  → emit('send', { content, files })
ChatView.vue::handleSend({ content, files })
  → sendMessage(sessionId, content, files, ...)   [useChat.js]
    → runCliChat() or runOpenRouterLoop()
```

Voice input must integrate at **PromptBuilder level**. The `input` ref is the textarea value. The `send()` function in PromptBuilder checks `canSend` (non-empty + not streaming) and emits.

### The HMR Singleton Pattern
Every composable in this codebase uses the same pattern:
```js
const _saved = import.meta.hot ? window.__PALOMA_VOICE__ : undefined
const isListening = _saved?.isListening ?? ref(false)
if (import.meta.hot) window.__PALOMA_VOICE__ = { isListening, ... }
```
`useVoiceInput.js` must follow this pattern — SpeechRecognition is a singleton anyway.

### The `streaming` Ref
`useChat.js` exposes `streaming` from `useSessionState`. In `ChatView.vue`:
```js
const { messages, streaming, streamingContent, ... } = useChat()
```
`streaming.value` is the key: when it transitions `true → false`, Paloma's response is complete. This is where we trigger auto-restart of listening in voice mode.

### TTS Timing (Important)
The JARVIS TTS (Kokoro) is called as a **tool call during streaming** — the AI calls `speak()` before it finishes its response. By the time `streaming.value` goes false, the TTS tool call has already returned. However, `sounddevice.play()` in `voice-speak.py` is synchronous — it blocks until audio finishes. So when the speak MCP tool returns, audio is done.

This means: **when `streaming.value` goes false, TTS has completed**. A 500ms safety buffer is enough for conversation loop restart.

### Keyboard Shortcuts
`useKeyboardShortcuts.js` currently has: `Ctrl+/` (sidebar), `Ctrl+N` (new chat), `Escape` (stop/close).  
**Recommended addition:** `Ctrl+M` (toggle voice mode). Clean, unused, mnemonic (M = mic).

---

## 4. UX Patterns for Voice Input

### Activation Modes
| Mode | Description | Verdict |
|------|-------------|---------|
| **Toggle / Voice Mode** | Click mic to enter voice mode; Paloma auto-listens after each response | ✅ Best for conversation |
| Push-to-talk | Hold key/button | Good for quick inputs, awkward for conversation |
| Wake word ("Hey Paloma") | Always listening | Complex, privacy concerns, overkill |
| Continuous always-on | Always listening, send on silence | Too many false positives |

**Recommendation: Toggle voice mode.** One click activates. In voice mode:
1. Start listening
2. User speaks
3. Transcript appears in textarea (live interim preview)
4. User pauses → send
5. Paloma responds (streaming)
6. Streaming ends → wait 500ms → restart listening
7. Repeat until user toggles off

### Auto-Send Pause Duration
Research and product convention suggests **1.5 seconds** feels natural. Google's own demo auto-sends at that rate. Browser Speech API pause detection (when `onend` fires on silence) runs about 1–2s — this aligns well. The simplest approach: send immediately when `onend` fires with accumulated transcript.

### Live Interim Preview
Show interim transcript directly in the `input` textarea value (overwriting as user speaks). When `onend` fires, the final transcript replaces it. This feels most natural — the user sees what they're saying in the same place where they'd type.

Two styles:
- **Native textarea value**: Simplest. Set `input.value = interimTranscript`. On final, set `input.value = finalTranscript`.
- **Ghost overlay**: More visually distinct but more complex. Skip for v1.

Recommendation: native textarea approach. Simple, consistent.

### Visual Feedback
- **Mic button**: Static when off. Animated pulse (CSS ring animation) when listening.
- **Voice mode badge**: Subtle indicator (e.g., colored mic icon, small "Voice mode" label) when voice mode is active vs just one-shot listening.
- **Waveform**: Nice but unnecessary for v1. The pulsing mic is enough.
- **Transcript source label**: A small "via voice" label on sent messages is optional but nice.

### Interruption Handling (v1: Skip)
Interrupting TTS mid-speech is complex. In v1, skip it. The TTS runs to completion, then listening starts. In a future version, we could track the TTS duration and abort via a bridge message.

### Error States
- `not-allowed`: Microphone permission denied → show clear "Mic access needed" message
- `network`: Google STT unreachable → fall back gracefully, show error
- `no-speech`: Recognition fired but no speech detected → restart silently if in voice mode

### Keyboard Shortcut
- `Ctrl+M` in voice mode: start one-shot recording
- When a session is active with no streaming: `Ctrl+M` toggles voice mode
- `Escape` while listening: abort current recognition, stay in voice mode

---

## 5. Integration Design — Full Picture

### New File: `src/composables/useVoiceInput.js`

```js
// HMR-safe singleton
const _saved = import.meta.hot ? window.__PALOMA_VOICE__ : undefined
const voiceMode = _saved?.voiceMode ?? ref(false)      // persistent conversation mode
const isListening = _saved?.isListening ?? ref(false)  // mic is currently active
const transcript = _saved?.transcript ?? ref('')        // accumulated finals (current turn)
const interimTranscript = _saved?.interimTranscript ?? ref('')  // live preview
const error = _saved?.error ?? ref(null)
if (import.meta.hot) window.__PALOMA_VOICE__ = { voiceMode, isListening, transcript, interimTranscript, error }

const supported = computed(() => typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window))

// One SpeechRecognition instance (singleton)
let recognition = null

function getRecognition() {
  if (recognition) return recognition
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition = new SR()
  recognition.continuous = false        // use auto-restart on onend instead
  recognition.interimResults = true
  recognition.lang = 'en-US'
  recognition.maxAlternatives = 1
  return recognition
}

export function useVoiceInput() {
  // ... wire up events, return state + methods
  return { supported, voiceMode, isListening, transcript, interimTranscript, error,
           startListening, stopListening, toggleVoiceMode, clearTranscript }
}
```

### Modified: `src/components/prompt/PromptBuilder.vue`

Changes needed:
1. Import `useVoiceInput`
2. Watch `interimTranscript` → update `input.value` (live preview)
3. Watch `transcript` → when final arrives, set `input.value` and call `send()` if in voice mode
4. Add mic button to the template (alongside stop/send button)
5. Mic button pulsing animation when `isListening`

The key connection:
```js
const { voiceMode, isListening, transcript, interimTranscript, toggleVoiceMode } = useVoiceInput()

// Live preview in textarea
watch(interimTranscript, (t) => {
  if (isListening.value) input.value = t
})

// Final result → send
watch(transcript, (t) => {
  if (t && voiceMode.value) {
    input.value = t
    nextTick(() => send())
    clearTranscript()
  }
})
```

### Modified: `src/components/chat/ChatView.vue`

Add conversation loop restart:
```js
const { voiceMode, startListening } = useVoiceInput()

watch(streaming, (val, prev) => {
  // ... existing detectChanges logic ...
  
  // Conversation loop: restart listening when response ends and voice mode is active
  if (prev === true && val === false && voiceMode.value) {
    setTimeout(() => startListening(), 500)
  }
})
```

### Modified: `src/composables/useKeyboardShortcuts.js`

Add `Ctrl+M` shortcut wired to `toggleVoiceMode`. The shortcut should only work when not in a streaming state.

---

## 6. Open Questions for Chart

1. **Auto-send threshold**: Send immediately on `onend` (recognition's natural pause detection) OR use a fixed timer (1.5s after last final result)? I lean toward `onend` = natural, but a 1s timer gives more user control.

2. **Interim in textarea vs separate element**: Showing interim text in the textarea is simplest. But it stomps on any text the user already typed. Should interim preview be in a separate `<div>` above the textarea instead?

3. **Voice mode persistence**: Should voice mode persist across sessions (localStorage) or reset on page reload? Safer to reset on reload.

4. **What happens if user starts speaking while Paloma is still streaming?** In v1, nothing — the mic isn't active during streaming. Good default.

5. **Single-session voice vs global voice mode**: Voice mode should be per-session (different sessions might have different contexts), not global. The `useVoiceInput` composable state is global (singleton), but voice mode enable/disable should probably be scoped to the active session.

6. **Mic button placement**: In the existing send button area (replacing it when active), or as a separate persistent button in the controls row?

---

## 7. File Map (What Forge Will Touch)

| File | Change | Notes |
|------|--------|-------|
| `src/composables/useVoiceInput.js` | **Create** | Core composable — SpeechRecognition, state, send trigger |
| `src/components/prompt/PromptBuilder.vue` | **Modify** | Mic button, wire useVoiceInput, interim preview in textarea |
| `src/components/chat/ChatView.vue` | **Modify** | Watch streaming → restart listening in voice mode |
| `src/composables/useKeyboardShortcuts.js` | **Modify** | Add Ctrl+M shortcut |
| `src/prompts/base.js` | No change | Voice input is browser-side only, no DNA impact |
| `src/prompts/phases.js` | No change | |

No new MCP servers. No bridge changes. No Python. Pure browser composable.

---

## 8. Recommended Architecture Summary

```
[User speaks]
      ↓
[Web Speech API — Chrome on Windows, Google cloud STT]
      ↓
[useVoiceInput.js]
  - interimTranscript → live preview in textarea
  - transcript (final, on onend) → auto-send trigger
      ↓
[PromptBuilder.vue — send() called programmatically]
      ↓
[ChatView.vue → sendMessage() → useChat.js → bridge]
      ↓
[AI responds, streaming.value: false → true → false]
  (JARVIS voice tool call completes before streaming ends)
      ↓
[ChatView.vue watches streaming → false]
  if voiceMode → setTimeout 500ms → startListening()
      ↓
[useVoiceInput.js — restarts recognition]
      ↓
[Back to top — conversation continues]
```

**Why this works:**
- Zero new dependencies
- Zero API keys
- Zero bridge changes  
- Follows all existing Paloma patterns (singleton composable, HMR preservation, emit-based send)
- The send path is untouched — voice input injects text the same way the keyboard does
- Symmetrical with TTS: TTS is bridge-mediated (Python); STT is browser-native. Both directions handled cleanly.

---

## 9. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Chrome Web Speech API unreliable | Low | It's backed by Google's speech infrastructure |
| Edge v134+ regression | Medium | Use Chrome (already works), or Deepgram as fallback |
| Beep on recognition start | Certain | Rapid auto-restart suppresses it; acceptable |
| Interim text stomps user's typed text | Possible | Only activate interim preview when `isListening` |
| TTS still playing when listening restarts | Low | 500ms delay + TTS is synchronous (blocks until done) |
| Microphone permission flow | Certain but once | Handle `not-allowed` error gracefully |

---

## Notes for Chart

The architecture is clear and clean. Chart should:
1. Define the exact `useVoiceInput.js` API (events, state shape, pause detection strategy)
2. Decide the interim-in-textarea vs separate-element question  
3. Spec the mic button design and placement in PromptBuilder
4. Decide auto-send vs manual-send mode behavior
5. Decompose into work units — this is 3-4 focused files, could be 1 Forge session

The biggest design decision Chart needs to make: **send on `onend` (immediate, trusts browser VAD) vs send after 1s timer (extra buffer, user can abort)**. I'd lean toward the timer for better control, but it's Chart's call.
