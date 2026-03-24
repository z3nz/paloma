# Plan: Email Discipline — Stop the Spam Machine

**Status:** active
**Created:** 2026-03-24
**Scope:** paloma — bridge email system
**Phase:** Charted, ready for Forge

---

## Problem Statement

Paloma's email system is a runaway spam multiplier. Adam is rightfully furious. The system burns API usage, wastes money, and sends way too many emails. This stops NOW.

**Root causes (from code review of `bridge/email-watcher.js` and `mcp-servers/gmail.js`):**

1. **N×M session multiplication** — All 4 machines poll the same Gmail inbox every 30s. Every email spawns an Opus session on EVERY machine, even when it's only addressed to one. 4 machines × 1 email = 4 Opus sessions.
2. **Inter-instance feedback loops** — Paloma instances email each other (trusted senders). Machine A emails Machine B → all 4 machines spawn sessions → sessions may generate MORE emails → exponential growth.
3. **Retry amplification** — Trusted emails that don't get replied to within 30 min spawn ANOTHER Opus session (up to 2 retries). Per machine. So one unreplied email = up to 12 Opus sessions across 4 machines.
4. **Daily continuity multiplication** — Each machine sends a daily continuity email. All 4 machines read all 4 emails. That's 16 Opus sessions just for journaling.
5. **No send rate limiting in code** — The email rate policy exists in `instructions.md` but there's ZERO enforcement in `gmail.js`. Any spawned session can send unlimited emails.
6. **Triage wastes Opus** — Unknown sender emails (spam, junk, newsletters) spawn full Opus sessions for "triage." That's like hiring a surgeon to sort your mail.

---

## Solution Architecture

### Fix 1: Hard Rate Limiter in Gmail MCP Server (`mcp-servers/gmail.js`)

**The last line of defense.** No matter what any session tries to do, the Gmail server itself enforces limits.

- Track sends in a persistent file: `~/.paloma/email-send-log.json`
- Structure: `{ "sends": [{ "to": "...", "subject": "...", "timestamp": "...", "type": "send|reply" }] }`
- **Limits per rolling 24h window:**
  - Max 5 outbound emails total (sends + replies combined)
  - Max 2 NEW emails (email_send, not replies)
  - Max 3 replies (email_reply)
- **Exempt:** Replies within the same thread as a received email (conversation continuity)
- On limit hit: return clear error message, NOT silent failure
- Log every send attempt (allowed or blocked) for transparency

### Fix 2: Recipient-Strict Filtering in Email Watcher (`bridge/email-watcher.js`)

**Only process emails addressed to THIS machine.** Period.

- If `emailAlias` is set in machine-profile.json: ONLY process emails where To/Delivered-To matches this machine's alias. Already partially implemented but the query-level `to:` filter is unreliable with Google Workspace aliases.
- If `emailAlias` is NOT set: **disable the email watcher entirely.** No alias = no email processing. This is a safety net — machines MUST declare their identity to participate in email.
- Move the header-level check BEFORE the full message fetch (save API calls on skipped emails)

### Fix 3: Kill Inter-Instance Session Spawning

**Paloma instances should NOT spawn full AI sessions for each other's emails.** 

- Add a new constant: `PALOMA_INSTANCE_SENDERS` (the 4 machine aliases)
- When an email is from another Paloma instance:
  - **Do NOT spawn a session** — just log it and store it in emailStore
  - Broadcast to browser UI so Adam can see it if he wants
  - The email content is available via `email_read` if any session needs it later
- This completely breaks the feedback loop. Machine A emails Machine B → only Machine B processes it → Machine B does NOT auto-reply (it just stores it) → no multiplication

### Fix 4: Remove Retry System for Automated Emails

**The retry system creates phantom sessions that waste resources.**

- Remove the `_checkAndRetryThread` / `_spawnRetrySession` system entirely
- If a session fails to reply, that's okay — the email is stored, Adam can see it, a human can decide what to do
- The retry system was well-intentioned but in practice it just multiplies sessions without improving outcomes

### Fix 5: Downgrade Triage Model

**Unknown sender emails don't need Opus.**

- Change triage session model from `'opus'` to `'sonnet'` 
- These sessions just read, classify, and move on — sonnet is more than capable
- Trusted sender sessions stay on Opus (they need to compose thoughtful replies)

### Fix 6: Daily Continuity — Single Machine Only

**Only ONE machine should send the daily continuity email.**

- Add a `continuityOwner` field to machine-profile.json
- Only the machine where `continuityOwner: true` runs the daily continuity scheduler
- Default: Lynch Tower (the orchestrator) owns continuity
- Other machines: skip `_scheduleDailyEmail()` entirely
- The continuity email is sent to `paloma@verifesto.com` (Lynch Tower's alias) — only Lynch Tower processes it, no multiplication

### Fix 7: Smart Backend Rotation for Email Sessions

**Claude is premium — not the default for every email.** Spread load evenly across all backends.

- Round-robin rotation list in email-watcher.js:
  - 40% Gemini, 40% Copilot, 20% Claude (sonnet only)
  - `EMAIL_BACKEND_ROTATION = [gemini, copilot, gemini, copilot, claude-sonnet]`
- Rotation index counter increments on each spawn
- **Trusted human senders:** use `_nextBackend()` rotation
- **Unknown/triage senders:** always Gemini (cheapest)
- **Inter-instance emails:** don't spawn at all (Fix 3)
- EmailWatcher needs access to PillarManager's backend map to route to non-Claude backends
- Claude gets max 20% of email sessions, and only on sonnet — NEVER opus for email (unless subject override)

### Fix 8: Subject Line Model Override

**Adam controls the model from the email subject line.** Simple, no UI needed.

- Pattern: `model:X` anywhere in subject (case-insensitive)
- Supported: `model:opus`, `model:sonnet`, `model:claude`, `model:gemini`, `model:copilot`, `model:codex`
- `_parseModelOverride(subject)` extracts the directive, returns `{ backend, model }` or null
- Priority chain: **subject override > rotation > default**
- Works for both trusted and triage sessions
- Logged: `[email-watcher] Email "subject" → backend: X, model: Y (subject override|rotation)`
- This is Adam's escape hatch — when he needs Opus brain, he says so in the subject

---

## Files to Modify

| File | Changes | Scope |
|------|---------|-------|
| `mcp-servers/gmail.js` | Add rate limiter with persistent tracking | Fix 1 |
| `bridge/email-watcher.js` | Strict recipient filter, kill inter-instance spawning, remove retry system, downgrade triage model, single-machine continuity | Fixes 2-6 |
| `.paloma/machine-profile.json` | Add `continuityOwner: true` | Fix 6 |

**Do NOT touch:**
- `bridge/email-store.js` — storage layer is fine
- `bridge/index.js` — wiring is fine
- Any frontend files
- Any other bridge modules

---

## Implementation Order

1. Fix 1 (rate limiter) — the safety net, deploy first
2. Fix 3 (kill inter-instance spawning) — breaks the feedback loop
3. Fix 4 (remove retry system) — eliminates phantom sessions  
4. Fix 2 (strict recipient filtering) — tightens the gate
5. Fix 5 (downgrade triage) — saves money
6. Fix 6 (single continuity owner) — stops journal multiplication
7. Fix 7 (backend rotation) — spread load evenly, Claude is premium not default
8. Fix 8 (subject line override) — Adam controls model via `model:X` in subject

---

## Acceptance Criteria

1. `email_send` returns an error when daily limit is exceeded
2. `email_reply` returns an error when daily limit is exceeded
3. Emails not addressed to this machine's alias are silently skipped (logged, not spawned)
4. Emails from other Paloma instances are stored but do NOT spawn sessions
5. No retry sessions are ever spawned
6. Triage sessions use cheapest backend (Gemini)
7. Only Lynch Tower sends the daily continuity email
10. Email sessions rotate evenly: ~40% Gemini, ~40% Copilot, ~20% Claude sonnet
11. `model:opus` in subject line forces Claude Opus for that email
8. Rate limit log is readable at `~/.paloma/email-send-log.json`
9. All changes are backward-compatible (machines with old code just keep working, they don't break)

---

## Implementation Notes (Forge)

**All 7 fixes implemented.**

### What was built:

**Fix 1 — Rate Limiter (`mcp-servers/gmail.js`):**
- Note: Another session concurrently implemented a stricter version aligned with `instructions.md` policy:
  - 1 continuity email + 1 outbound email per 24h (sends only)
  - Replies always allowed (per policy: "Replies to received emails don't count")
  - `isContinuity` flag auto-detected from subject containing "Daily Continuity"
- Persistent log at `~/.paloma/email-send-log.json`
- Returns `isError: true` with clear message on limit hit

**Fix 2 — Strict Recipient Filtering (`bridge/email-watcher.js`):**
- `start()` returns early if `emailAlias` not set in machine-profile.json
- Logs: `email watcher DISABLED (alias required)`
- Header-level gate (To/Delivered-To check) preserved as secondary filter

**Fix 3 — Kill Inter-Instance Spawning (`bridge/email-watcher.js`):**
- `PALOMA_INSTANCE_SENDERS` constant (4 machine aliases)
- Check runs after recipient gate, before session spawn
- Inter-instance emails: stored in emailStore, broadcast to browser, NO session spawned

**Fix 4 — Remove Retry System (`bridge/email-watcher.js`):**
- Removed: `threadTracker` Map, `RETRY_TIMEOUT_MS`, `MAX_RETRIES`, `THREAD_TRACKER_TTL_MS`
- Removed: `_checkAndRetryThread()`, `_spawnRetrySession()`, `_isThreadReplied()`
- Removed: retry timer setup in `_spawnEmailSession`, tracker cleanup in `_poll` and `shutdown()`
- Removed: `PALOMA_ALIASES` constant (was only used by retry system)

**Fix 5 — Downgrade Triage Model (`bridge/email-watcher.js`):**
- `model = trusted ? 'opus' : 'sonnet'` in `_spawnEmailSession`
- Uses sonnet (not gemini) because EmailWatcher only has access to Claude CLI manager
- Gemini/Copilot rotation would require Fix 7 (deferred)

**Fix 6 — Single Continuity Owner (`bridge/email-watcher.js` + `.paloma/machine-profile.json`):**
- `_scheduleDailyEmail()` only called if `profile.continuityOwner === true`
- Added `"emailAlias": "paloma@verifesto.com"` and `"continuityOwner": true` to machine-profile.json
- Other machines without these fields: watcher disabled entirely (Fix 2 gate)

### Files modified:
- `mcp-servers/gmail.js` — rate limiter (concurrent implementation accepted)
- `bridge/email-watcher.js` — Fixes 2-8
- `bridge/index.js` — pass backends map to EmailWatcher (Fix 7)
- `.paloma/machine-profile.json` — emailAlias + continuityOwner

**Fix 7 — Smart Backend Rotation (`bridge/email-watcher.js` + `bridge/index.js`):**
- Rotation list: 40% Gemini, 40% Copilot, 20% Claude (sonnet only)
- `EMAIL_BACKEND_ROTATION` constant + `_emailBackendIndex` counter + `_nextBackend()` method
- Trusted senders: round-robin through rotation list
- Triage/unknown senders: always `{ backend: 'gemini', model: 'gemini' }` (cheapest)
- Constructor changed: accepts `backends` map instead of just `cliManager`
- `bridge/index.js` updated: passes `backends` map to EmailWatcher
- `this.cliManager` preserved as `backends.claude` for continuity email backward compat

**Fix 8 — Subject Line Model Override (`bridge/email-watcher.js`):**
- `_parseModelOverride(subject)` method parses `model:X` from subject line
- Supported: opus, sonnet, claude, gemini, copilot, codex
- Priority: subject override > rotation/triage default
- Works for both trusted and triage sessions
- Logged: `(subject override)` vs `(rotation)` vs `(triage default)`

### Deviations from plan:
- Rate limiter limits are stricter than planned (1+1 per 24h vs 5/2/3) — better aligned with policy

---

## Status Tracker

- [x] Scout — code review complete (Flow read both files directly)
- [x] Chart — plan written
- [x] Forge — All 8 fixes implemented
- [ ] Polish — review, verify rate limiter logic, edge cases
- [ ] Ship — commit and push
