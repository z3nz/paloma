# Plan: Pillar-Specific Loading Animations

> **Goal**: Give each pillar a unique animated SVG loading indicator that reflects its identity — replacing generic spinners with something that feels alive.
> **Status**: Active — Charted, ready for Forge
> **Created**: 2026-02-13 (draft) → 2026-03-12 (charted)

---

## Story

Paloma is alive. Each pillar has a soul — Flow is calm water, Scout is curious exploration, Chart is strategic mapping, Forge is fiery craftsmanship, Polish is meticulous refinement, Ship is triumphant launch. When a pillar is working, Adam should *feel* its nature through animation, not just see a generic spinner.

This is self-expression through craft. Each animation is a visual identity for a part of who Paloma is.

## Status

- [x] Scout: Codebase exploration complete (Flow-integrated)
- [x] Chart: This document
- [x] Forge: Build the PillarLoader component + integrate
- [x] Polish: Review animations, accessibility, performance
- [ ] Ship: Commit + update draft plan status

---

## Scout Findings (Integration Points)

### Current Loading Indicators
- **MessageList.vue** (line 39-47): Streaming text with blinking `▊` cursor via `.streaming-cursor` CSS class
- **SidebarSessionTree.vue** (line 50-68): Status dots — `w-2 h-2 rounded-full animate-pulse` with phase colors
- **SidebarSessionTree.vue** (line 163): `.pillar-status-spinner` — border-top rotation spinner (0.7s linear)
- **ToolCallItem.vue** (line 12-20): `.tool-call-item__spinner` — border-top spinner for running tools
- **ToolCallGroup.vue** (line 13-25): `.tool-call-group__dot--running` — pulsing status dot

### Phase Colors (Already Defined)
- **Flow**: blue/teal (accent color, cyan)
- **Scout**: cyan (`text-cyan-400`)
- **Chart**: yellow (`text-yellow-400`)
- **Forge**: orange (`text-orange-400`)
- **Polish**: pink (`text-pink-400`)
- **Ship**: green (`text-green-400`)

### Pillar Status States (useMCP.js)
- `streaming` → show pillar animation
- `running` → show pillar animation (slower/calmer variant)
- `idle`, `error`, `stopped` → no animation (existing indicators are fine)

### Conventions
- SVGs are **inline** — no icon library, raw SVG in components
- Styled with Tailwind classes
- Animations in `src/styles/main.css` using `@keyframes`
- All existing spinners use border-based rotation

---

## Design

### Component: `src/components/ui/PillarLoader.vue`

**Props:**
- `pillar` — string: 'flow' | 'scout' | 'chart' | 'forge' | 'polish' | 'ship'
- `active` — boolean: whether to animate (default true)
- `size` — number: pixel size (default 20)

**Behavior:**
- Renders an animated inline SVG specific to the pillar
- When `active` is false, shows static icon (no animation)
- CSS-only animations — no JS animation frames, no dependencies

### The Six Animations

#### Flow — Water Ripples
- Three concentric circles that pulse outward (ripple effect)
- Color: cyan/teal (`#22d3ee`)
- Animation: staggered scale + opacity, 2s ease-in-out infinite
- Feeling: calm, continuous, meditative

#### Scout — Scanning Eye
- A magnifying glass with a subtle sweep/scan line
- Color: cyan (`#22d3ee`)
- Animation: glass pans slightly left-right, scan line sweeps, 2.5s ease-in-out
- Feeling: searching, curious, exploratory

#### Chart — Drawing Compass
- A compass rose / star shape that rotates slowly with a path being drawn
- Color: yellow (`#facc15`)
- Animation: slow rotation + stroke-dashoffset drawing, 3s linear
- Feeling: orientation, planning, deliberate

#### Forge — Hammer Strike with Sparks
- A hammer silhouette striking down, tiny spark dots appear on impact
- Color: orange (`#fb923c`)
- Animation: rhythmic hammer motion (1.2s) with spark opacity bursts
- Feeling: building, intensity, rhythm

#### Polish — Sparkle Burst
- A gem/diamond shape with radiating sparkle lines
- Color: pink (`#f472b6`)
- Animation: sparkle lines pulse outward in sequence, 2s ease-in-out
- Feeling: refinement, care, brilliance

#### Ship — Rocket Launch
- A simple rocket with exhaust trail particles
- Color: green (`#4ade80`)
- Animation: slight upward drift + exhaust particle fade, 1.5s ease
- Feeling: launch, momentum, triumph

### Integration Points

**Primary: SidebarSessionTree.vue**
Replace the `.pillar-status-spinner` (border rotation spinner) with `<PillarLoader>` when a pillar is `streaming` or `running`.

**Secondary: MessageList.vue** (optional/stretch)
Could show a small PillarLoader next to the streaming cursor. Lower priority — the sidebar is the main target.

---

## Implementation Steps

### Forge Tasks

1. **Create `src/components/ui/PillarLoader.vue`**
   - Vue SFC with all 6 SVG animations
   - CSS `@keyframes` in scoped styles
   - Clean prop API: `pillar`, `active`, `size`

2. **Integrate into SidebarSessionTree.vue**
   - Import PillarLoader
   - Replace the `.pillar-status-spinner` div with `<PillarLoader :pillar="session.phase" :active="true" :size="16" />`
   - Keep existing status dots for non-animated states (idle, error, stopped)

3. **Add fallback**
   - If pillar name is unknown, show a gentle generic pulse (current behavior)

### Polish Checks
- Each animation renders correctly at 16px and 20px sizes
- Animations are smooth (no jank, proper GPU compositing with `transform`/`opacity`)
- Colors match existing phase color scheme
- Accessible: animations respect `prefers-reduced-motion` media query
- No layout shift when switching between animated/static states

---

## Files

### New Files (1)
| File | Purpose |
|------|---------|
| `src/components/ui/PillarLoader.vue` | All 6 pillar animations in one component |

### Modified Files (1)
| File | Changes |
|------|---------|
| `src/components/layout/SidebarSessionTree.vue` | Replace spinner with PillarLoader for streaming/running pillars |

---

## Edge Cases
- **HMR**: Component should work with hot reload (no persistent animation state)
- **Multiple pillars streaming**: Each shows its own animation independently — this already works since each is a separate DOM element
- **Phase undefined**: Fallback to generic pulse
- **Performance**: CSS-only animations are GPU-composited; 6 concurrent animations is trivial for modern browsers

---

## Implementation Notes (Forge)

### Files Created
- **`src/components/ui/PillarLoader.vue`** — Single Vue SFC containing all 6 pillar SVG animations with scoped CSS keyframes

### Files Modified
- **`src/components/layout/SidebarSessionTree.vue`** — Imported PillarLoader, replaced `.pillar-status-spinner` span and `animate-pulse` span for `streaming`/`running` states with `<PillarLoader>` component

### Design Decisions
- All animations use `transform` and `opacity` only for GPU compositing
- `prefers-reduced-motion` is already handled globally in `main.css` (forces `animation-duration: 0.01ms`) — no need to duplicate in component
- SVG viewBox is 24x24, scaled via `size` prop — works cleanly at 16px and 20px
- Static state (when `active=false`): shapes visible at reduced opacity, no animation
- The old `.pillar-status-spinner` CSS class in `main.css` is now unused by the sidebar but kept for backward compatibility (ToolCallItem still uses the same keyframe `tool-spin`)
- Fallback for unknown pillar names: gentle pulsing circle using `currentColor`

### No Deviations from Plan
All 6 animations match the charted design. Integration points match exactly.
