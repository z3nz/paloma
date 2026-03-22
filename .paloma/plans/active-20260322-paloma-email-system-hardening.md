# Email System Hardening

**Status:** active
**Created:** 2026-03-22
**Scope:** paloma / infrastructure

## Problem

The email system has six issues causing intermittent email reading and wrong-machine-answering:

1. **No recipient filtering** — poll query is `is:unread in:inbox` with no `to:` filter, so every machine grabs every email
2. **No machine identity** — no config tells each machine which email alias it owns
3. **Hardcoded sender** — `paloma@verifesto.com` hardcoded in gmail.js, ignores machine identity
4. **seenIds lost on restart** — in-memory Set, no persistence to disk
5. **Reply check only looks for main alias** — `_isThreadReplied` misses replies from other machine aliases
6. **Multi-machine draft plan never built** — Cloudflare routing, Send-As, per-machine auth all unimplemented

## Approach

### Tier 1 — Code Fixes (Forge)
Tighten what we have with code changes. No external service config needed.

### Tier 2 — Infrastructure (Scout → Chart → Forge)
Cloudflare email routing, Gmail Send-As, fleet discovery. Requires Scout research first.

## Work Units

#### WU-1: Fix all 5 code-level email issues: recipient filtering, machine identity, sender
- **Feature:** Tier 1 — Email Watcher Hardening
- **Status:** completed
- **Files:** bridge/email-watcher.js, mcp-servers/gmail.js, .paloma/machine-profile.json
- **Scope:** Fix all 5 code-level email issues: recipient filtering, machine identity, sender address, seenIds persistence, multi-alias reply detection.
- **Acceptance:** Email watcher only processes emails addressed to this machine's alias. seenIds survive bridge restarts. Replies from any Paloma alias are detected. Sender address matches machine identity. Daily continuity email unchanged.
- **Result:** Committed in 40a59b6. All 5 fixes shipped: recipient filtering by emailAlias, seenIds persistence to disk, PALOMA_ALIASES for reply detection, gmail.js reads machine profile, graceful fallbacks for missing config.
#### WU-2: Scout research: Cloudflare email routing, Gmail aliases, fleet discovery, naming
- **Feature:** Tier 2 — Multi-Machine Email Infrastructure
- **Status:** completed
- **Files:** .paloma/docs/scout-email-infrastructure-20260322.md, .paloma/docs/machine-fleet.md
- **Scope:** Scout research: Cloudflare email routing, Gmail aliases, fleet discovery, naming conventions.
- **Acceptance:** Scout doc produced with implementation steps. Ready for Chart.
- **Result:** Key finding: Cloudflare Email Routing is NOT compatible with Google Workspace MX records. Correct path is Google Workspace aliases via Admin Console. Machine-based naming confirmed. Full scout doc and updated fleet doc written.
## Implementation Notes (WU-1)

**Files modified:**
- `.paloma/machine-profile.json` — added `emailAlias` field ("paloma@verifesto.com" for LYNCH-TOWER)
- `bridge/email-watcher.js` — recipient filtering, seenIds persistence, multi-alias reply detection
- `mcp-servers/gmail.js` — SENDER_ADDRESS now reads from machine profile as fallback

**Changes:**
1. Poll query filtered by `to:${emailAlias}` — each machine only processes its own mail
2. SeenIds persisted to `~/.paloma/email-seen-ids.json` — survives bridge restarts, capped at 500
3. `_isThreadReplied` checks all PALOMA_ALIASES, not just hardcoded main address
4. `resolveSenderAddress()` in gmail.js: env var → machine-profile.json → hardcoded fallback
5. Graceful fallbacks throughout — missing profile file just warns and processes all emails

**Untouched:** Daily continuity email logic (`_sendContinuityEmail`, `_scheduleDailyEmail`) — zero changes.
