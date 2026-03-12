<template>
  <Transition name="splash-fade">
    <div v-if="visible" class="splash-overlay">
      <canvas ref="canvas" class="splash-canvas" />
      <div class="splash-content">
        <h1 class="splash-title">Paloma</h1>
        <button class="splash-button" @click="dismiss">
          Enter
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['dismiss'])

const canvas = ref(null)
const visible = ref(true)
let animationId = null

function dismiss() {
  visible.value = false
  if (animationId) cancelAnimationFrame(animationId)
  setTimeout(() => emit('dismiss'), 600) // match transition duration
}

onMounted(() => {
  const cvs = canvas.value
  if (!cvs) return
  const ctx = cvs.getContext('2d')

  let A = 0
  let B = 0

  function resize() {
    cvs.width = window.innerWidth
    cvs.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  // Color palette — warm gradient from Paloma's purple accent
  const palette = [
    [30, 30, 40],      // darkest
    [40, 35, 55],
    [55, 40, 70],
    [70, 48, 90],
    [90, 58, 115],
    [110, 72, 140],
    [124, 92, 160],    // near accent
    [124, 92, 191],    // accent #7c5cbf
    [145, 113, 209],   // accent-hover #9171d1
    [170, 140, 220],
    [200, 175, 235],
    [230, 215, 250],   // brightest
  ]

  function frame() {
    const W = cvs.width
    const H = cvs.height
    const resolution = 2 // pixel size for performance + retro feel

    // Clear with background
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, W, H)

    const cosA = Math.cos(A), sinA = Math.sin(A)
    const cosB = Math.cos(B), sinB = Math.sin(B)

    // Use typed arrays for the zbuffer and output
    const cols = Math.floor(W / resolution)
    const rows = Math.floor(H / resolution)
    const size = cols * rows
    const zbuffer = new Float32Array(size)
    const lumBuffer = new Int8Array(size).fill(-1)

    const R1 = 1.0  // tube radius
    const R2 = 2.0  // torus radius
    const K2 = 5.0  // distance
    const K1 = Math.min(W, H) * 0.4 / resolution // scale factor

    // Sample the torus surface
    for (let theta = 0; theta < 6.28; theta += 0.03) {
      const cosT = Math.cos(theta), sinT = Math.sin(theta)

      for (let phi = 0; phi < 6.28; phi += 0.01) {
        const cosP = Math.cos(phi), sinP = Math.sin(phi)

        const circleX = R2 + R1 * cosT
        const circleY = R1 * sinT

        // 3D rotation
        const x = circleX * (cosB * cosP + sinA * sinB * sinP) - circleY * cosA * sinB
        const y = circleX * (sinB * cosP - sinA * cosB * sinP) + circleY * cosA * cosB
        const z = K2 + cosA * circleX * sinP + circleY * sinA
        const ooz = 1.0 / z

        // Project to screen
        const xp = Math.floor(cols / 2 + K1 * ooz * x)
        const yp = Math.floor(rows / 2 - K1 * ooz * y * 0.5)

        // Luminance
        const L = cosP * cosT * sinB - cosA * cosT * sinP - sinA * sinT + cosB * (cosA * sinT - cosT * sinA * sinP)

        if (xp >= 0 && xp < cols && yp >= 0 && yp < rows) {
          const idx = xp + yp * cols
          if (ooz > zbuffer[idx]) {
            zbuffer[idx] = ooz
            let lumIdx = Math.max(0, Math.floor(L * 8))
            lumIdx = Math.min(lumIdx, palette.length - 1)
            lumBuffer[idx] = lumIdx
          }
        }
      }
    }

    // Render pixels
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = i + j * cols
        const lum = lumBuffer[idx]
        if (lum >= 0) {
          const [r, g, b] = palette[lum]
          ctx.fillStyle = `rgb(${r},${g},${b})`
          ctx.fillRect(i * resolution, j * resolution, resolution, resolution)
        }
      }
    }

    A += 0.04
    B += 0.02

    animationId = requestAnimationFrame(frame)
  }

  animationId = requestAnimationFrame(frame)

  onBeforeUnmount(() => {
    if (animationId) cancelAnimationFrame(animationId)
    window.removeEventListener('resize', resize)
  })
})
</script>

<style scoped>
.splash-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #0d1117;
}

.splash-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.splash-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  pointer-events: none;
}

.splash-title {
  font-size: 3rem;
  font-weight: 300;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(230, 237, 243, 0.9);
  text-shadow: 0 0 40px rgba(124, 92, 191, 0.5), 0 0 80px rgba(124, 92, 191, 0.2);
}

.splash-button {
  pointer-events: all;
  padding: 0.75rem 2.5rem;
  background: transparent;
  border: 1px solid rgba(124, 92, 191, 0.5);
  color: rgba(230, 237, 243, 0.8);
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.splash-button:hover {
  background: rgba(124, 92, 191, 0.15);
  border-color: rgba(124, 92, 191, 0.8);
  color: #e6edf3;
  box-shadow: 0 0 20px rgba(124, 92, 191, 0.3);
}

/* Fade out transition */
.splash-fade-leave-active {
  transition: opacity 0.6s ease;
}

.splash-fade-leave-to {
  opacity: 0;
}
</style>
