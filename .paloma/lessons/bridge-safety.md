# Lesson: Bridge Code Must Be Bulletproof

**Learned:** 2026-03-21
**Context:** Smart Backend Selection project — Forge edited `bridge/backend-health.js` and crashed the bridge, killing all of Paloma

## The Rule

The bridge (`bridge/`) is Paloma's nervous system. If it crashes, EVERYTHING dies — no pillars, no tools, no recovery without manual intervention. Bridge code must be treated with the same care as a production database migration.

## What Happened

A Forge session implementing WU-1+WU-2 (BackendHealth fixes + machine profile generation) introduced changes to `bridge/backend-health.js` that crashed the bridge on startup. Adam had to manually debug and fix with a separate Claude session.

## How to Prevent

1. **Defensive coding in bridge files** — every new method must be wrapped in try/catch, every property access must be null-checked
2. **New features must be additive and optional** — if `_generateMachineProfile()` fails, the bridge must still start. If `_selectBackend()` throws, fall back to the old `'gemini'` default.
3. **Polish must review bridge changes with extra scrutiny** — not just correctness, but crash-safety
4. **Forge sessions editing bridge files should read the full file after editing** to catch syntax errors, missing imports, undefined references
5. **Never change existing critical paths without fallback** — `spawn()`, `checkAll()`, `_handleCliEvent()` are hot paths. Changes must not break the happy path.
6. **Bridge startup is the most dangerous moment** — a syntax error at module level = total failure, no graceful degradation possible

## The Principle

Frontend bugs are annoying. Bridge crashes are catastrophic. ---

### Lesson: Explicitly handle CORS and Cache-Control in Bridge API
- **Context:** Added CORS and cache-busting headers to `bridge/index.js` routes.
- **Insight:** In multi-port development environments (Vite on :5173, Bridge on :19191), the browser's browser-side JS will be blocked by CORS unless the bridge explicitly allows the cross-origin origin. Additionally, without `Cache-Control: no-cache`, the browser may aggressively cache `index.html` and other non-hashed static files, leading to frustrating stale UI states that require DevTools "Disable cache" to fix.
- **Action:** Any new API route in the bridge must include `corsHeaders` on response. Static file serving must differentiate between hashed assets (immutable cache) and entry points (no cache).
- **Applied:** YES — updated `bridge/index.js` to include CORS for all `/api/` routes and `no-cache` for non-asset static files.
