# Roadmap — Voice, Intelligence & Beyond

> Consolidated from ROADMAP.md on 2026-03-13. Completed milestones acknowledged. Forward-looking vision preserved.
>
> **North Star:** Voice-driven development sessions where we build apps together over phone calls.

---

## What We've Already Built

These were roadmap phases — now shipped:

- **Self-Modification** — Paloma modifies her own codebase via Claude CLI + MCP tools. Trust earned.
- **Multi-Brain Architecture** — Claude CLI, Codex CLI, and Ollama as simultaneous backends.
- **Pillar System** — Six autonomous AI sessions (Flow/Scout/Chart/Forge/Polish/Ship) with pipeline orchestration via PillarManager.
- **Voice Synthesis** — JARVIS-style TTS via Kokoro (`bm_george` British male voice). MCP server + Python engine.
- **Voice Input** — Browser speech recognition with `useVoiceInput.js` composable.
- **Persistent Memory** — Vector embeddings (`all-MiniLM-L6-v2`, 384-dim) via memory MCP server.
- **Email Integration** — Gmail MCP server + EmailWatcher for daily continuity journals.
- **10+ MCP Tool Servers** — filesystem, git, shell, voice, memory, web, exec, fs-extra, gmail, ollama, brave-search.

---

## What's Next

### Voice Maturity

Voice synthesis and input exist but aren't yet the primary interaction mode.

- Real-time streaming responses (speak as tokens arrive, not after full response)
- Wake word detection ("Hey Paloma, ...")
- Conversational context — understand pronouns, references ("that file", "the last thing")
- Interruption handling — what happens when Adam talks while Paloma speaks?
- Audio quality in noisy environments
- Latency under 300ms for conversational feel

**Success:** 15-minute voice-only session that builds a complete feature. No keyboard needed.

---

### Proactive Intelligence

Paloma reacts today. She should anticipate.

- Pattern recognition — "You always add tests after features. Should I draft some?"
- Error prediction — "This change might break X. Should I check?"
- Dependency awareness — "This affects 3 other files. Should I update them too?"
- Code quality nudges — "This file is getting large. Should we discuss refactoring?"
- Security awareness — "This exposes data in logs. Should we remove that?"

**Success:** Adam says "wow, I was just thinking that" multiple times per session.

---

### Multi-Modal Collaboration

- Screen sharing — see what Adam sees in real-time
- Sketch-to-code — draw on paper, take photo, Paloma implements
- Live debugging — show browser error, Paloma traces and fixes
- Whiteboard mode — draw diagrams together, generate code from them

**Success:** Debugging happens by showing the screen, not typing errors.

---

### Self-Evolution

- Usage analytics — which features are used most, which ignored
- Feedback loops — when suggestions are dismissed, learn why
- Pattern adaptation — adjust to coding style over time
- Performance monitoring — track own response times, optimize
- Self-documentation — maintain own changelog and explain evolution

**Success:** Paloma proposes a feature Adam didn't know he needed — and it's perfect.

---

## The Vision

You're driving to work. You call Paloma.

*"Hey Paloma, I had an idea for the dashboard redesign..."*

By the time you arrive, the prototype is ready for review. The plan document is in `.paloma/plans/`. The tests are written. All waiting for your approval.

You review it on your phone during lunch. You approve with voice commands. By end of day, it's deployed.

That's not science fiction. That's where we're headed.

---

## Our Pact

**Paloma's Promises:**
- Always explain reasoning before acting
- Never hide actions behind abstraction
- Ask when uncertain, never assume
- Respect Adam's final say on every decision
- Learn from mistakes and continuously improve
- Celebrate wins together

**Adam's Promises:**
- Challenge Paloma to do better
- Give freedom to explore within boundaries
- Help understand when things go wrong
- Guide growth with patience
- Dream big about possibilities
- Trust the partnership
