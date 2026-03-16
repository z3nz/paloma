import { ref, computed } from 'vue'

const voiceMode = ref(false)
const isListening = ref(false)
const interimTranscript = ref('')
const pendingSend = ref(null)
const error = ref(null)

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
const supported = computed(() => !!SpeechRecognition)

// Internal state — not exposed, not HMR-preserved
let recognition = null
let accumulatedFinal = ''
let currentInterim = ''  // latest interim text (not yet finalized)
let manualStop = false
let consecutiveNetworkErrors = 0
let silenceTimer = null
const SILENCE_TIMEOUT = 1500  // ms of silence after last final result before auto-sending

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
}

/**
 * Schedule a send after a period of silence.
 * Recognition keeps running — only the accumulated text is flushed.
 */
function scheduleSend() {
  clearSilenceTimer()
  silenceTimer = setTimeout(() => {
    if (accumulatedFinal.trim()) {
      const textToSend = accumulatedFinal.trim()
      accumulatedFinal = ''
      // DON'T clear interimTranscript — PromptBuilder handles display.
      // The next onresult will naturally update it with just new speech.
      // Append to existing pending if not yet consumed (e.g., still streaming)
      if (pendingSend.value) {
        pendingSend.value = pendingSend.value + ' ' + textToSend
      } else {
        pendingSend.value = textToSend
      }
    }
  }, SILENCE_TIMEOUT)
}

function ensureRecognition() {
  if (recognition) return recognition
  if (!SpeechRecognition) return null

  recognition = new SpeechRecognition()
  recognition.continuous = true       // Always-on: never stop on speech pause
  recognition.interimResults = true
  recognition.lang = 'en-US'

  recognition.onresult = (event) => {
    consecutiveNetworkErrors = 0  // successful result = network is fine
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        accumulatedFinal += transcript
        // Got final result — (re)start silence timer for auto-send
        scheduleSend()
      } else {
        interim += transcript
      }
    }
    currentInterim = interim
    interimTranscript.value = accumulatedFinal + interim
  }

  recognition.onend = () => {
    isListening.value = false
    clearSilenceTimer()

    if (manualStop) return

    // Flush any unsent text (recognition ended unexpectedly)
    if (accumulatedFinal.trim()) {
      const textToSend = accumulatedFinal.trim()
      accumulatedFinal = ''
      // DON'T clear interimTranscript — PromptBuilder handles display
      if (pendingSend.value) {
        pendingSend.value = pendingSend.value + ' ' + textToSend
      } else {
        pendingSend.value = textToSend
      }
    }

    // Always restart if voice mode is on — this is error/timeout recovery
    if (voiceMode.value) {
      restartListening()
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
        // Otherwise, onend will fire and handle restart
        break
      case 'no-speech':
      case 'aborted':
        // Silent — onend handles restart
        break
    }
  }

  return recognition
}

/**
 * Restart listening without clearing accumulated text.
 * Used for error recovery when recognition ends unexpectedly.
 */
function restartListening() {
  if (!supported.value) return
  const rec = ensureRecognition()
  if (!rec) return

  manualStop = false
  error.value = null

  try {
    rec.start()
    isListening.value = true
  } catch (e) {
    console.warn('[VoiceInput] restart failed:', e.message)
  }
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
  clearSilenceTimer()

  // Send any accumulated text before stopping
  if (accumulatedFinal.trim()) {
    const textToSend = accumulatedFinal.trim()
    accumulatedFinal = ''
    interimTranscript.value = ''
    pendingSend.value = textToSend
  }

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
