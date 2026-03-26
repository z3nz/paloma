# Plan: Verifesto Storybook Animation Choreography Fix

**Status:** active
**Created:** 2026-03-22
**Scope:** verifesto-studios — frontend animation
**Phase:** Charted, ready for Forge

---

## Research References

- `.paloma/docs/scout-verifesto-animation-final-20260322.md` — Root cause analysis and proposed solutions

---

## Goal

Fix three visual defects in the Verifesto Studios storybook animation:
1. Back cover geometry is wrong when the book is closed (fills full 52rem instead of 26rem)
2. Cover text vanishes before the cover starts swinging
3. Spread fade-in is flat/cheap with no choreography relative to cover movement

All fixes are pure CSS/Vue — no animation libraries, no architecture changes, no form logic touched.

---

## Project Location

`/home/adam/paloma/projects/verifesto-studios/frontend/src/`

---

## Architecture Grounding

Before implementing, Forge MUST read these files in the project:
- `components/StoryBook.vue` — scene container, cover wrapper, 3D hierarchy
- `components/BookBack.vue` — back cover (currently static)
- `components/BookCover.vue` — front cover face + text content
- `components/BookSpread.vue` — inner pages reveal
- `style.css` — CSS custom properties (book dimensions, colors)
- `App.vue` — state machine reference

**Key measurements (from style.css / StoryBook.vue):**
- `--book-width: 52rem` — full open book width
- `--book-cover-width: 26rem` — closed book / single cover width
- `.book-cover-wrapper` position: `left: 50%; width: 50%` — right half of 52rem parent
- Scene expansion: `0.35s cubic-bezier(0.4, 0.0, 0.2, 1)`
- Scene close: `transition-duration: 0.4s; transition-delay: 0.5s`
- Cover swing open: `1.1s cubic-bezier(0.4, 0.0, 0.2, 1) 0.1s delay`
- Cover swing close: `0.9s cubic-bezier(0.4, 0.0, 0.2, 1)` (no delay)
- `cover-opened` emitted at t=1400ms; `cover-closed` at t=1100ms

---

## Timing Diagram

```
OPENING SEQUENCE (t=0 when bookState → 'opening')
─────────────────────────────────────────────────────────────────
t=0.000s  Scene starts expanding: 26rem → 52rem (0.35s cubic)
t=0.000s  BookBack starts expanding: 50%/left:50% → 100%/left:0 (0.35s cubic)
t=0.000s  Cover wrapper arms (0.1s delay before rotation begins)
t=0.100s  Cover begins rotating: 0° → -160° (1.1s cubic)
t=0.350s  Scene fully at 52rem ✓
t=0.350s  BookBack fully at 100% width ✓
t=0.400s  Spread transition begins: opacity 0→1, scale 0.98→1 (0.5s / 0.6s)
t=0.620s  Cover ≈ 45° — still visually covering spread
t=0.720s  Cover ≈ 90° → cover-front backface kicks in, content naturally hidden
t=0.900s  Spread fully visible (0.4s delay + 0.5s duration)
t=1.200s  Cover settles at -160°
t=1.400s  cover-opened emitted → bookState → 'open'

CLOSING SEQUENCE (t=0 when bookState → 'closing')
─────────────────────────────────────────────────────────────────
t=0.000s  Spread fades out: opacity 1→0, scale 1→0.98 (0.3s, NO delay)
t=0.000s  Cover begins rotating back: -160° → 0° (0.9s, no delay)
t=0.300s  Spread gone ✓
t=0.500s  Scene starts shrinking: 52rem → 26rem (0.5s delay, 0.4s duration)
t=0.500s  BookBack starts shrinking: 100%/0 → 50%/50% (0.5s delay, 0.4s duration)
t=0.900s  Cover at 0° ✓
t=0.900s  Scene shrunk to 26rem ✓
t=0.900s  BookBack shrunk ✓
t=1.100s  cover-closed emitted → bookState → 'closed'
```

---

## Implementation

### Fix 1: BookBack.vue — Back Cover Geometry

**Problem:** `position: absolute; inset: 0` makes the back cover fill all 52rem, but when closed the scene shows only 26rem with `overflow: visible`, so the left half of the back cover hangs out to the left.

**Files changed:** `StoryBook.vue` (1 line) + `BookBack.vue` (script + styles)

#### StoryBook.vue — pass bookState prop

Find the `<BookBack />` element and add the prop:

```html:components/StoryBook.vue
<<<<<<< SEARCH
        <!-- Book back cover (always visible as book base) -->
        <BookBack />
=======
        <!-- Book back cover (always visible as book base) -->
        <BookBack :book-state="bookState" />
>>>>>>> REPLACE
```

#### BookBack.vue — full rewrite

Replace the entire file:

```vue:components/BookBack.vue
<script setup>
import { computed } from 'vue'

const props = defineProps({
  bookState: {
    type: String,
    required: true
  }
})

const stateClass = computed(() => `is-${props.bookState}`)
</script>

<template>
  <div :class="['book-back', stateClass]"></div>
</template>

<style scoped>
/*
  Default (closed) state: matches front cover footprint.
  Front cover is at left: 50%, width: 50% inside the 52rem .storybook.
  Back cover must match to appear as the same closed-book silhouette.
  Transition expands/contracts in sync with the scene width change.
*/
.book-back {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 50%;
  border-radius: var(--book-radius);
  background:
    radial-gradient(ellipse at 30% 40%, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
    linear-gradient(135deg, var(--book-cover-dark) 0%, var(--book-spine-color) 100%);
  transform: translateZ(-2px);
  box-shadow:
    0 12px 24px rgba(0, 0, 0, 0.3),
    0 4px 8px rgba(0, 0, 0, 0.2);
  /* Opening transition matches scene expansion timing */
  transition:
    width 0.35s cubic-bezier(0.4, 0.0, 0.2, 1),
    left  0.35s cubic-bezier(0.4, 0.0, 0.2, 1);
}

/* Full book width when open */
.book-back.is-opening,
.book-back.is-open,
.book-back.is-turning {
  width: 100%;
  left: 0;
}

/* Closing: match scene closing transition exactly (0.5s delay, 0.4s duration) */
.book-back.is-closing {
  width: 50%;
  left: 50%;
  transition:
    width 0.4s cubic-bezier(0.4, 0.0, 0.2, 1) 0.5s,
    left  0.4s cubic-bezier(0.4, 0.0, 0.2, 1) 0.5s;
}

/* Mobile: back cover hidden (opacity fade handles mobile UX) */
@media (max-width: 768px) {
  .book-back {
    display: none;
  }
}

/* Reduced motion: disable geometric transition */
@media (prefers-reduced-motion: reduce) {
  .book-back {
    transition: none !important;
  }
}
</style>
```

**Why this works:**
- Initial render: `bookState='closed'` → `left: 50%; width: 50%` — correctly positioned under the front cover
- `opening`: transitions to `100%/left:0` in 0.35s — same as scene expansion
- `closing`: transitions back to `50%/left:50%` with 0.5s delay + 0.4s — same as scene close
- `closed` after close: already at `50%/left:50%`, no change

---

### Fix 2: BookCover.vue — Cover Text Visibility During Opening

**Problem:** `contentClass` returns `'is-hidden'` (opacity: 0) the moment `bookState` becomes `opening`, before the cover rotation even begins (0.1s delay). Cover swings open with blank face.

**File changed:** `BookCover.vue` — one line in the computed property

The front cover (`.cover-front` in StoryBook.vue) already has `backface-visibility: hidden`. When the cover rotates past 90°, the front face naturally disappears — no explicit opacity change needed. Let physics do the work.

```js:components/BookCover.vue
<<<<<<< SEARCH
const contentClass = computed(() => {
  if (props.bookState === 'closed') return ''
  if (props.bookState === 'closing') return 'is-closing'
  return 'is-hidden'
})
=======
const contentClass = computed(() => {
  if (props.bookState === 'closed' || props.bookState === 'opening') return ''
  if (props.bookState === 'closing') return 'is-closing'
  return 'is-hidden'
})
>>>>>>> REPLACE
```

**No CSS changes needed.** The existing `backface-visibility: hidden` on `.cover-front` (StoryBook.vue) handles natural disappearance at 90°. The `is-closing` CSS (delayed opacity fade-in as cover returns) is already correct and untouched.

**Why this works:**
- During `opening`: content is visible (class `''`). Cover rotates. At 90°, `backface-visibility: hidden` fires and the entire cover-front face disappears.
- During `open`/`turning`: `is-hidden` — opacity 0, correct (cover is behind the spread).
- During `closing`: `is-closing` — delayed fade-in (0.27s ease-in with 0.63s delay), content returns as cover swings back. Already correct, unchanged.

---

### Fix 3: BookSpread.vue — Choreographed Reveal

**Problem:** Spread uses `opacity 0.3s ease-out` with no delay. Pages pop in without relation to the cover's movement — feels like a UI overlay, not physical pages being revealed.

**Solution:** Add 0.4s delay (cover is still in front at that point, hiding the spread in 3D), duration 0.5s. Add a subtle `scale(0.98) → scale(1)` "rising from the pages" effect. Separate the closing transition (immediate, no delay, matches current behavior).

**File changed:** `BookSpread.vue` — update scoped CSS only, no script changes.

```css:components/BookSpread.vue
<<<<<<< SEARCH
.book-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  transform: translateZ(-1px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease-out;
  display: flex;
  flex-direction: column;
}

.book-spread.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.book-spread.is-closing {
  opacity: 0;
  transition: opacity 0.3s ease-out;
  pointer-events: none;
}
=======
.book-spread {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  pointer-events: none;
  /* Default hidden state: slightly recessed and scaled down */
  transform: translateZ(-1px) scale(0.98);
  /* Opening reveal: delay so cover clears first, then rise + fade */
  transition:
    opacity   0.5s ease-out 0.4s,
    transform 0.6s ease-out 0.4s;
  display: flex;
  flex-direction: column;
}

.book-spread.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateZ(-1px) scale(1);
}

.book-spread.is-closing {
  opacity: 0;
  transform: translateZ(-1px) scale(0.98);
  /* Closing: immediate fade, no delay — spread is gone before cover returns */
  transition:
    opacity   0.3s ease-out,
    transform 0.3s ease-out;
  pointer-events: none;
}
>>>>>>> REPLACE
```

Also update the `prefers-reduced-motion` block to strip the scale animation:

```css:components/BookSpread.vue
<<<<<<< SEARCH
/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .book-spread {
    transition: opacity 0.15s ease !important;
  }
}
=======
/* Reduced motion: no scale, instant opacity only */
@media (prefers-reduced-motion: reduce) {
  .book-spread {
    transform: translateZ(-1px) !important;
    transition: opacity 0.15s ease !important;
  }
}
>>>>>>> REPLACE
```

**Why this works:**
- The 0.4s delay is safe: the cover at `z-index: 5` and `translateZ(0)` visually occludes the spread until past 90° (t≈0.72s). During the delay window (t=0–0.4s), the cover is in front anyway.
- Scale 0.98→1 is subtle but readable: 2% growth over 0.6s gives a gentle "lift" without being distracting.
- `is-closing` overrides the transition immediately (no delay), so the spread is gone well before the cover swings back.
- Mobile: `scale()` is fine in flat context; `translateZ` collapses to no-op but `scale(0.98→1)` still works as a nice mobile reveal.
- Reduced motion: transform locked, opacity instant.

---

## Mobile Fallback — No Changes Needed

The mobile block in `StoryBook.vue` already handles the full override:
- `book-cover-wrapper` uses opacity transition (`transform: none !important`)
- `book-spread` is `position: relative`, `width: 100%`, `transform: none` implied by flat context
- `BookBack` is `display: none` on mobile

Our changes don't touch any mobile-specific behavior.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Z-fighting at 90° mark | LOW | Spread at `translateZ(-1px)`, cover at `translateZ(0)` + `z-index: 5`. `backface-visibility: hidden` ensures clean flip. |
| BookBack left border-radius visible | NEGLIGIBLE | Left side of back cover is hidden behind front cover in 3D. Even if visible at open angle, it's the same `--book-radius` as everything else. |
| Initial page load snap (back cover) | NONE | `bookState='closed'` on mount → `left: 50%; width: 50%` renders immediately, no "from" state to animate from. |
| Spread scale causing layout shift | NONE | `position: absolute; inset: 0` — scale transforms don't affect document flow. |
| Closing spread race condition | NONE | `is-closing` class applies same tick as `is-visible` is removed. `is-closing` overrides transition to no-delay immediately. |
| Rapid open/close edge case | LOW | If user spams the button, `StoryBook.vue` watch clears its timeout. The CSS transitions will still animate correctly from wherever they are (CSS handles mid-transition interruption gracefully). |
| Cover text at exactly 90° during opening | NONE | Theoretical state that's impossible to user-trigger — CSS handles transition continuously. |

---

## Files to Modify

| File | Change | Lines affected |
|------|--------|---------------|
| `components/StoryBook.vue` | Add `:book-state="bookState"` to `<BookBack />` | ~1 line |
| `components/BookBack.vue` | Add script (prop), update geometry + transitions | Full file rewrite (simple) |
| `components/BookCover.vue` | Add `'opening'` to the "show content" branch | 1 line |
| `components/BookSpread.vue` | Update transition + add scale transform + reduced-motion | ~15 lines CSS |

**Do NOT touch:**
- `App.vue` — state machine
- `composables/useIntakeForm.js` — form logic
- `components/BookPageLeft.vue`, `BookPageRight.vue` — form steps
- `style.css` — CSS custom properties (no changes needed)

---

## Forge Acceptance Criteria

After implementation, verify:
1. **Closed state**: Back cover appears as a single book cover (26rem), not a wide rectangle bleeding to the left.
2. **Opening**: Cover text is visible while the cover swings — disappears naturally when cover passes 90°, not before.
3. **Open state**: Spread is fully visible with a "risen from the pages" feel, not a flat opacity pop.
4. **Closing**: Spread fades immediately. Cover swings back. Scene shrinks.
5. **Closed again**: Book looks like a clean closed book, same as initial state.
6. **Mobile**: No visible change — same opacity fade behavior as before.
7. **Reduced motion**: Instant opacity transitions, no scale animation.

---

## Status Tracker

- [x] Scout complete — root causes identified
- [x] Chart complete — plan written and approved
- [x] Forge — implement fixes
- [ ] Polish — visual QA, timing verification
- [ ] Ship — commit and push

## Implementation Notes

- **BookBack Geometry**: Updated `BookBack.vue` to match the front cover's footprint (`left: 50%; width: 50%`) when closed. Added a geometric transition that expands/contracts in sync with the scene width.
- **Cover Text Visibility**: Modified `BookCover.vue` to keep the front cover content visible during the `opening` state. The content now disappears naturally due to `backface-visibility: hidden` when the cover rotates past 90 degrees.
- **Spread Reveal Choreography**: Updated `BookSpread.vue` to delay the fade-in until the cover has mostly cleared the spread. Added a subtle scale animation (`0.98` to `1.0`) to give the appearance of pages rising into view. Verified that the closing transition is immediate.
- **Mobile/Accessibility**: Maintained existing mobile fallbacks and enhanced the `prefers-reduced-motion` overrides for the new transitions.
