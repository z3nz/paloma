# Pillar-Specific Loading Animations

**Status:** Draft  
**Scope:** Paloma UI  
**Date:** 2026-02-13

## Concept

Each pillar gets a unique animated loading indicator that reflects its metaphor. When Paloma is streaming a response, the loading animation matches the active pillar/phase of the session. This replaces the generic spinner with something that feels alive and contextual.

## Pillar Animations

### Flow (Water Flowing)
- Paloma's icon with animated water ripples/waves
- CSS keyframe animation: gentle sine-wave motion, opacity pulses
- Color: blue/teal tones
- Feeling: calm, continuous, meditative

### Scout (Magnifying Glass)
- Magnifying glass icon sweeping/scanning
- Animation: subtle left-right panning with a focus pulse
- Could include a faint "scan line" effect
- Color: amber/gold
- Feeling: searching, curious, exploratory

### Chart (Map Unfolding)
- Map or compass icon with animated drawing/unfolding
- Animation: paths drawing themselves, compass needle rotating
- Color: green tones
- Feeling: orientation, planning, discovery

### Forge (Hammer on Anvil)
- Hammer striking down on an anvil
- Animation: rhythmic up-down hammer motion with spark particles on impact
- Color: orange/ember
- Feeling: building, crafting, intensity

### Polish (Buffing/Shine)
- Polishing cloth or sparkle effect
- Animation: circular buffing motion with expanding shine/gleam bursts
- Color: silver/white highlights
- Feeling: refinement, care, attention to detail

### Ship (Rocket Blasting Off)
- Rocket icon with exhaust animation
- Animation: slight upward drift with flame particles trailing below
- Color: red/orange exhaust fading to white
- Feeling: launch, momentum, release

## Technical Approach

### Option A: CSS-Only Animations
- SVG icons with CSS `@keyframes` animations
- Lightweight, no JS overhead during streaming
- Each pillar has a dedicated `<svg>` with animated elements
- Toggled via a class like `.loading-flow`, `.loading-scout`, etc.

### Option B: Lottie/Canvas Animations
- Richer motion possible (particles, complex paths)
- Heavier — adds a dependency (lottie-web ~250kb)
- Better for the spark/particle effects (Forge, Ship)

### Recommended: Option A with Selective Enhancement
- Start with CSS-only SVG animations for all 6 pillars
- If a specific pillar needs particle effects (Forge sparks, Ship exhaust), add a tiny canvas overlay just for those
- No new dependencies initially

## Implementation Outline

1. **Create `src/components/ui/PillarLoader.vue`**
   - Props: `pillar` (string), `active` (boolean)
   - Renders the appropriate animated SVG based on pillar
   - Exposes a clean API: `<PillarLoader pillar="flow" :active="streaming" />`

2. **Design 6 SVG animations**
   - Each ~20-40 lines of SVG + CSS keyframes
   - Contained within the component, scoped styles

3. **Integrate into MessageList or streaming indicator**
   - Replace current loading indicator with `<PillarLoader>`
   - Session's `phase` prop determines which animation plays

4. **Fallback**
   - Default animation (gentle pulse) if phase is unset or unrecognized
   - Graceful — never breaks if a pillar name changes

## Files to Create/Modify

- `src/components/ui/PillarLoader.vue` — New component with all 6 animations
- `src/components/chat/MessageList.vue` — Replace loading indicator with PillarLoader
- Possibly `src/assets/` — If SVGs are externalized (prefer inline for animation control)

## Open Questions

- Should the animation also appear in the TopBar or just inline with messages?
- Size: small inline icon (~24px) or larger centered animation (~48-64px)?
- Should there be a subtle background color shift per pillar too?
