# Scout Findings: Verifesto Storybook 3D Animation Refinement

## Context
The Verifesto Studios 3D storybook animation is mechanically sound but visually flawed in its current implementation. This mission identifies the root causes of three critical visual issues and proposes CSS/Vue-based solutions that enhance the "feel" and realism of the animation without changing the underlying state machine or form logic.

## Problem 1: Back Cover Geometry in Closed State

### Root Cause
In `StoryBook.vue`, the `.storybook` container (the perspective parent) is always `var(--book-width)` (52rem). `BookBack.vue` uses `position: absolute; inset: 0`, so it fills the full 52rem width even when the book is closed. 

When the book is closed, `.storybook-scene` transitions to `var(--book-cover-width)` (26rem), but since it has `overflow: visible`, the left half of the back cover (the "spine" and "back" of an open book) is visible, hanging out to the left of the front cover. This breaks the illusion of a single, closed book sitting on the table.

Key files:
- `projects/verifesto-studios/frontend/src/components/StoryBook.vue` (L103, L122)
- `projects/verifesto-studios/frontend/src/components/BookBack.vue` (L6)

### Proposed Solution
Choreograph the back cover's width and position to match the front cover when the book is closed.

1. **Pass `bookState` to `BookBack.vue`** as a prop.
2. **Update `BookBack.vue` styling:**
   - Add classes for `is-closed`, `is-opening`, etc.
   - Initial state (closed): `width: 50%`, `left: 50%`, `border-radius: var(--book-radius)`.
   - Open/Opening states: `width: 100%`, `left: 0`, `border-radius: var(--book-radius)`.
   - Add a transition to `width` and `left` that matches the scene expansion (0.35s).
3. **Alternatively**, adjust `.storybook`'s transform in `StoryBook.vue` to center the book's right half when the scene is only 26rem wide.

**Recommendation:** The most robust fix is to have `BookBack` toggle its geometry. When closed, it should be the same size and position as the front cover (the right half of the 52rem scene).

---

## Problem 2: Cover Text Disappears Early

### Root Cause
In `BookCover.vue`, the `contentClass` computed property returns `is-hidden` for any state other than `closed` or `closing`. This triggers an `opacity: 0` transition (0.3s) immediately when `bookState` becomes `opening`. 

Because `StoryBook.vue` has a `0.1s` delay on the rotation transform, the text fades away *before* the cover even begins to move, leaving a blank olive surface for the duration of the swing.

Key file:
- `projects/verifesto-studios/frontend/src/components/BookCover.vue` (L14-18)

### Proposed Solution
Let physics and `backface-visibility` do the work.

1. **Update `contentClass` in `BookCover.vue`**:
   ```javascript
   const contentClass = computed(() => {
     if (props.bookState === 'closed' || props.bookState === 'opening') return ''
     if (props.bookState === 'closing') return 'is-closing'
     return 'is-hidden'
   })
   ```
2. **Remove the opacity transition** for the `opening` phase.
3. The front cover already has `backface-visibility: hidden`. When the cover rotates past 90 degrees, the front face (with the text) will naturally disappear, and the `cover-back` (parchment) will become visible.

---

## Problem 3: Spread Fade-in Looks Cheap

### Root Cause
`BookSpread.vue` has a simple `opacity: 0 \u2192 1` transition with a `0.3s` duration. It pops into view without any choreographed timing relative to the cover's rotation. This feels like a UI overlay rather than a reveal of physical pages.

Key file:
- `projects/verifesto-studios/frontend/src/components/BookSpread.vue` (L75-80)

### Proposed Solution
Add timing and depth to the reveal.

1. **Add transition-delay**: Only start showing the spread when the cover is at ~45-60 degrees.
   - `transition: opacity 0.5s ease-out 0.4s, transform 0.6s ease-out 0.4s;`
2. **Add "Reveal" Transform**:
   - Initial state: `opacity: 0`, `transform: translateZ(-20px) scale(0.98);`
   - Visible state: `opacity: 1`, `transform: translateZ(-1px) scale(1);`
3. This creates a "rising" effect where the pages seem to lift slightly as the cover clears them.

---

## Technical Recommendations for Forge

- **Refining `StoryBook.vue` layout**: Use a CSS variable for the current "expansion" of the book. 
- **Z-indexing**: Ensure the `BookBack` is at `translateZ(-2px)`, the `BookSpread` is at `translateZ(-1px)`, and the `BookCover` hinges from `translateZ(0)`. This prevents Z-fighting during the rotation.
- **Backface Visibility**: Ensure `backface-visibility: hidden` is set on both `.cover-front` and `.cover-back` to prevent flickering at the 90-degree mark.

## Research Findings: 3D Book Best Practices
- **Perspective**: `1200px` (already in `style.css`) is a good sweet spot for avoiding extreme distortion while maintaining a 3D feel.
- **Hinge Points**: The `transform-origin: left center` on the cover wrapper is correct for a book spine.
- **Timing**: Professional animations often use different durations for different parts of the flip to create a sense of weight. The current 1.1s for the open and 0.9s for the close is a good foundation.

Research complete. Findings ready for Chart and Forge.
