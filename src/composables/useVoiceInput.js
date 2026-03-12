import { ref, computed } from 'vue'

// --- HMR preservation ---
const _saved = import.meta.hot ? window.__PALOMA_VOICE__ : undefined

const voiceMode = _saved?.voiceMode ?? ref(false)
const isListening = _saved?.isListening ?? ref(false)
const interimTranscript = _saved?.interimTranscript ?? ref('')
const pendingSend = _saved?.pendingSend ?? ref(null)
const error = _saved?.error ?? ref(null)

if (import.meta.hot) {
  window.__PALOMA_VOICE__ = { voiceMode, isListening, interimTranscript, pendingSend, error }
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
const supported = computed(() => !!SpeechRecognition)

// Internal state — not exposed, not HMR-preserved
let recognition = null
let accumulatedFinal = ''
let manualStop = false
let consecutiveNetworkErrors = 0

function ensureRecognition() {
  if (recognition) return recognition
  if (!SpeechRecognition) return null

  recognition = new SpeechRecognition()
  recognition.continuous = false
  recognition.interimResults = true
  recognition.lang = 'en-US'

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        accumulatedFinal += transcript
      } else {
        interim += transcript
      }
    }
    interimTranscript.value = accumulatedFinal + interim
  }

  recognition.onend = () => {
    isListening.value = false
    interimTranscript.value = ''

    if (manualStop) return

    if (accumulatedFinal.trim()) {
      pendingSend.value = accumulatedFinal.trim()
      accumulatedFinal = ''
      consecutiveNetworkErrors = 0
    } else if (voiceMode.value) {
      // No speech detected — silently restart
      startListening()
    }
  }

  recognition.onerror = (event) => {
    switch (event.error) {
      case 'not-allowed':
        error.value = 'mic-permission'
        voiceMode.value = false
        isListening.value = false
        break
      case 'audio-capture':
        error.value = 'no-mic'
        voiceMode.value = false
        isListening.value = false
        break
      case 'network':
        consecutiveNetworkErrors++
        if (consecutiveNetworkErrors >= 3) {
          error.value = 'network'
          voiceMode.value = false
          isListening.value = false
        }
        break
      case 'no-speech':
      case 'aborted':
        // Silent — onend handles restart or cleanup
        break
    }
  }

  return recognition
}

function startListening() {
  if (!supported.value || isListening.value) return

  const rec = ensureRecognition()
  if (!rec) return

  manualStop = false
  accumulatedFinal = ''
  interimTranscript.value = ''
  error.value = null

  try {
    rec.start()
    isListening.value = true
  } catch (e) {
    console.warn('[VoiceInput] recognition.start() failed:', e.message)
  }
}

function stopListening() {
  manualStop = true
  if (recognition) {
    try {
      recognition.stop()
    } catch {
      // Ignore if not started
    }
  }
  isListening.value = false
  interimTranscript.value = ''
}

function toggleVoiceMode() {
  voiceMode.value = !voiceMode.value
  if (voiceMode.value) {
    startListening()
  } else {
    stopListening()
  }
}

function clearError() {
  error.value = null
}

export function useVoiceInput() {
  return {
    supported,
    voiceMode,
    isListening,
    interimTranscript,
    pendingSend,
    error,
    toggleVoiceMode,
    startListening,
    stopListening,
    clearError
  }
}
