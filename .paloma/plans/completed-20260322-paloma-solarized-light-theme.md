# Plan: App-Wide Solarized Light Theme (2026-03-22)

Implement a full app-wide light/dark theme toggle for Paloma, moving beyond the inbox-only implementation to a global Solarized Light theme.

## Status: Completed

## Objectives
- [x] Global theme state management in `useTheme.js`
- [x] Rename localStorage key to `paloma:theme`
- [x] Apply `paloma-light` class to `html` element
- [x] Move Solarized Light CSS variables to `src/styles/main.css`
- [x] Add theme toggle to Settings Modal
- [x] Clean up `InboxView.vue` scoped styles
- [x] Refactor components to use theme variables instead of hardcoded dark colors

## Implementation Notes
- **Mechanism**: The theme is controlled by a `paloma-light` class on the `<html>` element. CSS variables in `main.css` are overridden when this class is present.
- **Persistence**: Theme preference is saved in localStorage under `paloma:theme`.
- **UI**: A new "Appearance" section was added to the Settings Modal. The Inbox toggle remains as a shortcut.
- **Contrast**: Code blocks were kept dark in light mode to maintain compatibility with the dark syntax highlighting theme and provide a "design choice" look.
- **Refactoring**: Components like `MessageItem`, `ToolConfirmation`, and `ThinkingPanel` were updated to use theme variables (`--color-accent`, `--color-success`, etc.) instead of hardcoded Tailwind classes like `text-purple-400`.

## Verified
- [x] Theme toggle works globally
- [x] Settings modal UI is clear
- [x] Inbox view remains functional and looks good in both themes
- [x] Diffs and tool results adapt to both themes
- [x] Transition between themes is smooth (0.2s)

## Readiness
- Ready for Polish.
