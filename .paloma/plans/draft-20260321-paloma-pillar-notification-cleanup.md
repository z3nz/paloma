# Pillar Notification and Spawning Cleanup

> **Goal:** Fix reliability issues in pillar notification delivery and spawning - eliminate race conditions, double-spawns, and lost notifications.
> **Status:** Draft - needs Scout/Chart before Forge
> **Created:** 2026-03-21

---

## Known Issues (Observed)

### 1. Pillars Sometimes Spawn Twice
Adam has observed pillars spawning duplicate sessions. Likely causes to investigate:
- Race condition in _spawnSingularityGroup() if called concurrently
- Double-trigger from frontend WebSocket reconnect replaying spawn requests
- MCP proxy handling concurrent tool calls on the same transport

### 2. Notification Delivery Is Unreliable
- CLI sessions (Claude Code): No automatic push - notifications queue and require explicit pillar_notifications tool call
- Browser reconnect: If WebSocket dies during _sendFlowNotification(), notification is silently lost (no retry)
- Stale WebSocket: flowSession.wsClient can point to dead socket after page refresh

### 3. Race Conditions in Notification Flow
- notifyFlow() checks flowSession.currentlyStreaming - queue/send decision can be wrong if state changes between check and send
- onFlowTurnComplete() drains queue but no guarantee it is called if Flow ends abnormally
- Notification cooldown (5s per pillarId) can silently drop legitimate follow-up notifications

### 4. Notification Queue Can Lose Data
- Queue capped at 50 - oldest dropped when exceeded
- When Flow session is overwritten, queued notifications are discarded with just a warning log
- _pendingNotifications (CLI path) and flowSession.notificationQueue (browser path) are separate

---

## Areas to Investigate (Scout Phase)

1. Double-spawn root cause: Trace the full spawn path. Check for idempotency.
2. MCP notification push: Can MCP SDK sendLoggingMessage() push to Claude Code via SSE?
3. WebSocket reliability: Add retry/reconnect logic for failed notification sends
4. Notification guarantees: Design at-least-once delivery (acknowledge + retry)
5. Cross-drain: When browser Flow registers, drain _pendingNotifications into it

---

## Rough Solution Ideas (For Chart to Evaluate)

### A. MCP Push Notifications for CLI Sessions
- Push notifications/message through all active MCP proxy transports on pillar completion
- Claude Code receives via SSE. Poll fallback as belt-and-suspenders.

### B. Spawn Idempotency
- Request dedup in MCP proxy (track recent spawns by hash of pillar+prompt)
- Dedup in PillarManager (reject if identical pillar already running)

### C. Notification Retry
- Re-queue on WebSocket send failure with retry count (max 3, exponential backoff)
- Final fallback: write to .paloma/notifications/ for manual retrieval

### D. Queue Unification
- Single notification queue instead of two separate paths
- registerFlowSession() migrates pending queue instead of discarding

---

## Priority

Important infrastructure work. The pillar system is the backbone of multi-session architecture.
Unreliable notifications and double-spawns undermine trust in the whole system.

Recommended: Full pipeline (Scout, Chart, Forge, Polish, Ship) in a dedicated session.
