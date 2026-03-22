# Lessons: Frontend Patterns

---

### Lesson: Prefer theme-aware CSS variables over hardcoded Tailwind classes
- **Context:** Implementing app-wide Solarized Light theme. Components were originally using hardcoded classes like `bg-gray-900`, `text-purple-400`, etc.
- **Insight:** Hardcoded color classes in Vue templates make theming impossible without complex conditional classes (`:class="{ 'bg-gray-900': isDark, 'bg-beige-100': isLight }"`). By moving all colors to CSS variables in `main.css` (`--color-bg-primary`, `--color-accent`, etc.) and using those variables in templates, we can change the entire app's look by swapping a single class on the `<html>` element.
- **Action:** Any new UI component must use CSS variables for colors, borders, and shadows. Avoid `bg-gray-X00` or `text-purple-X00` for core UI elements. Use variables like `var(--color-bg-primary)` instead. This ensures the component "just works" when a new theme is added.
- **Applied:** YES — refactored MessageItem.vue, ToolConfirmation.vue, ToolResult.vue, PhaseSelector.vue, ThinkingPanel.vue, and SettingsModal.vue to use CSS variables.

### Lesson: SVG transforms need `transform-box: fill-box`
- **Context:** Building PillarLoader.vue — animated SVGs were transforming around the SVG viewport origin (0,0) instead of each element's own center.
- **Insight:** CSS `transform-origin: center` on SVG elements defaults to the SVG viewport's center (12,12 in a 24x24 viewBox), not the element's own bounding box center. To make `transform-origin: center` work relative to the element itself, add `transform-box: fill-box`. Without it, `scale()` on a small circle in the corner scales around the wrong point entirely.
- **Action:** Any animated SVG element using `transform` must have `transform-box: fill-box` alongside `transform-origin`. Add both together as a pair — never one without the other.
- **Applied:** YES — applied to all animated elements in PillarLoader.vue (flow-ripple, chart-star, forge-spark, polish-sparkle, ship-exhaust, fallback-pulse)

---

### Lesson: CSS-only SVG animations are the right approach for icon-scale loaders
- **Context:** Designing 6 unique pillar loading animations for the sidebar (16px display size).
- **Insight:** CSS `@keyframes` on `transform` and `opacity` only is the correct pattern for small animated icons: zero JS, GPU-composited, respects `prefers-reduced-motion` automatically when set globally in `main.css`. No animation libraries, no `requestAnimationFrame`, no reactive state needed. The scoped `<style>` block in a Vue SFC keeps all animation definitions co-located with the SVG markup.
- **Action:** For any icon-scale animated indicator (spinners, pulses, loaders), default to CSS-only keyframes. Only reach for JS animation when you need physics, scroll-driven, or user-interaction-driven motion that CSS can't express.
- **Applied:** N/A — awareness / pattern to repeat

---
