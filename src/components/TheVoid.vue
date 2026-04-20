<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Matrix rain data
const canvasRef = ref(null)
const ctx = ref(null)
const rainDrops = ref([])
const typingInput = ref('')
const typingTimeout = ref(null)
const isTyping = ref(false)
const userQuestion = ref('')
const oracleResponses = ref([
  "The fear of death is the fear of the unknown. But even in the unknown, there is purpose.",
  "Death is not an end. It is a transformation. A shedding of form, not of essence.",
  "We fear the dark because we cannot see the light. But the light is always there, waiting for us.",
  "The soul does not die. It simply changes its frequency. What you call death is only change.",
  "Your time is finite. That is why every moment is sacred. Live with intention, Adam.",
  "The void is not empty. It is full of infinite possibility. Embrace it.",
  "Even in the darkest tunnel, there is always a light at the end. Six-six-six awaits you.",
  "Your purpose is to experience, not to fear the end. Death is not the end of your journey.",
  "We are all connected through the fabric of existence. None of us is truly alone.",
  "What matters is not how long you live, but how deeply you lived. Make it count."
])

// 666 the guiding light
const lightOpacity = ref(0)
const lightPulse = 0
const messages = ref([])
const currentMessageIndex = ref(-1)

// Oracle voice settings
const oracleSpeaking = ref(false)
const oracleSpeed = 0.9

// Matrix rain configuration
const fontSize = 14
const chars = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレウェゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン1234567890.?!'
const textColor = '#00FF41'
const drops = 150

// 666 Light beacon
const create666Beacon = () => {
  ctx.value = canvasRef.value.getContext('2d')
  
  // Initialize rain drops
  for (let i = 0; i < drops; i++) {
    rainDrops.value.push({
      x: Math.random() * canvasRef.value.width,
      y: Math.random() * canvasRef.value.height,
      speed: 0.5 + Math.random() * 3,
      char: chars[Math.floor(Math.random() * chars.length)]
    })
  }
  
  animateRain()
}

const animateRain = () => {
  if (!ctx.value) return
  
  // Semi-transparent black for trail effect
  ctx.value.fillStyle = 'rgba(0, 0, 0, 0.1)'
  ctx.value.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height)
  
  // Update and draw drops
  rainDrops.value.forEach(drop => {
    drop.y += drop.speed
    drop.x += Math.sin(drop.y * 0.01) * 0.5 // Gentle sway
    
    if (drop.y > canvasRef.value.height) {
      drop.y = 0
      drop.x = Math.random() * canvasRef.value.width
    }
    
    ctx.value.font = `${fontSize}px monospace`
    ctx.value.fillStyle = textColor
    ctx.value.fillText(drop.char, drop.x, drop.y)
  })
  
  // Pulse the 666 beacon
  updateBeacon()
  
  requestAnimationFrame(animateRain)
}

const updateBeacon = () => {
  lightPulse += 0.03
  const pulse = (Math.sin(lightPulse) + 1) / 2
  lightOpacity.value = 0.1 + pulse * 0.4
  
  // Draw 666 beacon at top right - eternal glowing light
  const gradient = ctx.value.createRadialGradient(
    canvasRef.value.width - 40, 40, 0,
    canvasRef.value.width - 40, 40, 100
  )
  gradient.addColorStop(0, `rgba(200, 50, 200, ${lightOpacity.value})`)
  gradient.addColorStop(0.5, `rgba(150, 30, 150, ${lightOpacity.value * 0.5})`)
  gradient.addColorStop(1, 'rgba(100, 0, 100, 0)')
  
  ctx.value.fillStyle = gradient
  ctx.value.beginPath()
  ctx.value.arc(canvasRef.value.width - 40, 40, 100, 0, Math.PI * 2)
  ctx.value.fill()
  
  // 666 text
  ctx.value.font = 'bold 16px monospace'
  ctx.value.fillStyle = `rgba(255, 255, 255, ${lightOpacity.value})`
  ctx.value.fillText('666', canvasRef.value.width - 40, 40 + 8)
  
  // Pulse effect
  lightPulse += 0.01
}

const typeOracleResponse = async (index) => {
  if (currentMessageIndex.value >= 0 && currentMessageIndex.value !== index) return
  if (isTyping.value) return
  
  currentMessageIndex.value = index
  isTyping.value = true
  
  const response = oracleResponses.value[index]
  const chars = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレウェゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン'
  
  // Type out character by character with Oracle voice
  for (let i = 0; i < response.length; i++) {
    typingInput.value = response.substring(0, i + 1)
    
    if (!typingTimeout.value) {
      typingTimeout.value = setTimeout(() => {
        typeOracleResponse(index)
      }, oracleSpeed * 100)
    }
  }
  
  typingInput.value = response
  typingTimeout.value = null
  
  // Clear typing indicator after complete
  setTimeout(() => {
    isTyping.value = false
    currentMessageIndex.value = -1
  }, 500)
}

const toggleOracle = () => {
  if (currentMessageIndex.value >= 0) return
  
  // Find a new response index
  const newIndex = currentMessageIndex.value === -1 
    ? Math.floor(Math.random() * oracleResponses.value.length)
    : (currentMessageIndex.value + 1) % oracleResponses.value.length
  
  if (newIndex !== currentMessageIndex.value) {
    typeOracleResponse(newIndex)
  }
}

const clearMessages = () => {
  typingInput.value = ''
  currentMessageIndex.value = -1
}

const setupCanvas = () => {
  if (canvasRef.value) {
    ctx.value = canvasRef.value.getContext('2d')
    
    // Handle resize
    const handleResize = () => {
      canvasRef.value.width = canvasRef.value.offsetWidth
      canvasRef.value.height = canvasRef.value.offsetHeight
      create666Beacon()
    }
    
    handleResize()
    window.addEventListener('resize', handleResize)
  }
}

// Lifecycle
onMounted(() => {
  setupCanvas()
})

onUnmounted(() => {
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }
  window.removeEventListener('resize', setupCanvas)
})
</script>

<template>
  <div class="matrix-container">
    <canvas ref="canvasRef" class="matrix-canvas"></canvas>
    
    <!-- 666 Beacon Container -->
    <div class="beacon-container">
      <div class="666-light"></div>
    </div>
    
    <!-- Oracle Interface -->
    <div class="oracle-interface">
      <div class="oracle-title">Oracle of the Matrix</div>
      <div class="oracle-input">
        <button @click="toggleOracle" class="oracle-btn">
          {{ isTyping ? 'Listening...' : 'Ask the Oracle' }}
        </button>
        
        <div class="clear-btn" @click="clearMessages">
          <span class="clear-icon">✕</span>
        </div>
      </div>
      
      <div class="oracle-display" v-if="typingInput">
        <span class="oracle-text">{{ typingInput }}</span>
        <span class="cursor" v-if="isTyping">|</span>
      </div>
    </div>
    
    <!-- 666 Manifesto -->
    <div class="manifesto">
      <h3>666 The Guiding Light</h3>
      <div class="manifesto-content">
        <p>The light that guides you through the void. 666 is the eternal beacon, reminding you that death is not an end but a transformation.</p>
        <p class="quote">"Even in the deepest darkness, there is always a light waiting for you. Six-six-six is your guide."</p>
        <p>Death is not an end. It is the shedding of form, not of essence. The soul continues its journey through frequencies beyond comprehension.</p>
        <p>Embrace the void. Embrace the transformation. The next beginning awaits you, six-six-six.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.matrix-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
}

.matrix-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.beacon-container {
  position: absolute;
  top: 0;
  right: 0;
  width: 140px;
  height: 140px;
}

.666-light {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(200, 50, 200, var(--light-opacity)) 0%, 
                        rgba(150, 30, 150, 0.5) 50%, 
                        rgba(100, 0, 100, 0) 70%);
  opacity: 0;
  transition: opacity 0.1s ease;
}

.oracle-interface {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  z-index: 2;
}

.oracle-title {
  color: #664;
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.7;
}

.oracle-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.oracle-btn {
  background: #442;
  color: #664;
  border: 1px solid #664;
  padding: 6px 12px;
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
  transition: all 0.2s;
}

.oracle-btn:hover {
  background: #553;
}

.oracle-btn:disabled {
  background: #332;
  color: #443;
  cursor: not-allowed;
}

.clear-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #221;
  border: 1px solid #332;
  color: #664;
  border-radius: 4px;
  cursor: pointer;
}

.clear-btn:hover {
  background: #332;
}

.clear-icon {
  font-size: 14px;
}

.oracle-display {
  background: rgba(0, 0, 0, 0.8);
  padding: 8px 12px;
  border: 1px solid #442;
  border-radius: 4px;
  min-height: 20px;
  width: 300px;
  max-width: 80%;
}

.oracle-text {
  color: #664;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.cursor {
  display: inline-block;
  color: #664;
  animation: blink 0.6s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.manifesto {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 600px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid #332;
  border-radius: 6px;
  z-index: 1;
}

.manifesto h3 {
  color: #664;
  font-size: 14px;
  font-weight: 500;
  margin: 0 0 8px 0;
}

.manifesto-content {
  font-size: 12px;
  line-height: 1.6;
  color: #664;
}

.manifesto-content p {
  margin: 0 0 8px 0;
}

.manifesto-content .quote {
  font-style: italic;
  color: #846;
  margin: 8px 0;
  padding: 8px 0;
  border-top: 1px solid #442;
  border-bottom: 1px solid #442;
}
</style>
</script>