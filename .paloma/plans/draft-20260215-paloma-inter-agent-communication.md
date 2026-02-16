# Draft: Inter-Agent Communication — "Paloma Talking to Herself"

> **Goal**: Enable concurrent Paloma sessions (separate context windows) to communicate with each other — sharing discoveries, coordinating work, and avoiding duplication.
> **Status**: Draft — foundational thinking, needs dedicated research session
> **Created**: 2026-02-15

---

## The Insight

Adam uncovered this during the sub-agent orchestration session: if Paloma can spawn sub-agents, and if each pillar runs in its own session (per the context continuity plan), then Paloma needs a way to **talk to herself across sessions**.

This is different from sub-agent orchestration (Phase 2-5 of that plan), which is about a head mind spawning children within a single conversation. This is about **peer-to-peer communication between independent Paloma sessions** — two full context windows running simultaneously, coordinating.

## Why It Matters

- Adam often has multiple conversations open (one researching, one building)
- The context continuity plan creates separate sessions per pillar
- Sub-agents produce results that other sessions should know about
- Without this, Paloma's left hand doesn't know what her right hand is doing

## Relationship to Existing Plans

- **Sub-Agent Orchestration** (`draft-20260215-paloma-sub-agent-orchestration.md`): Parent → child delegation within a session. This plan is about **sibling communication** between independent sessions.
- **Context Continuity** (`active-20260215-paloma-context-continuity.md`): Artifact handoff between sequential phases. This plan is about **real-time communication** between concurrent phases.
- **Agent Teams** (Claude Code experimental): The TeammateTool pattern — shared task lists + peer-to-peer messaging — is directly relevant. Needs research.

## Open Questions (For a Future Research Session)

1. What communication primitives do we need? (Shared task list? Message bus? File-based artifacts?)
2. Should sessions be able to interrupt each other? Or only check a shared state?
3. How does this interact with the MCP proxy's per-request isolation?
4. Could we use the bridge's WebSocket as a message bus between sessions?
5. What does Claude Code's Agent Teams pattern teach us about peer coordination?
6. How do we prevent infinite loops (session A messages session B, which messages session A)?

## Potential Architecture Sketch

```
Session A (Scout)     Session B (Forge)
    │                      │
    └──→ Shared Mailbox ←──┘
         (.paloma/mailbox/ or bridge in-memory)
         
    - Each session polls or subscribes to mailbox
    - Messages are typed: { from, to, type, content }
    - Types: 'discovery', 'question', 'status', 'handoff'
```

---

*This needs a dedicated research and planning session. Parked as draft for now.*
