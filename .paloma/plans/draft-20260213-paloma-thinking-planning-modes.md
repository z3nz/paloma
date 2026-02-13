# Draft: Extended Thinking & Planning Mode Integration

> **Goal:** Leverage Claude CLI's thinking ability toggle and planning mode within Paloma.
> **Status:** Draft
> **Created:** 2026-02-13

---

## The Idea

Claude CLI has:
1. **Extended Thinking** — deeper reasoning for complex problems
2. **Planning Mode** — structured approach to implementation tasks

Paloma should be able to leverage both, ideally with Paloma herself deciding when to use them.

## Questions to Explore

- Can we pass `--thinking` or equivalent flags through the CLI subprocess?
- Does the Claude CLI API expose planning mode programmatically?
- How do thinking tokens show up in the response? Are they separate from completion tokens?
- Can we surface the thinking process in Paloma's UI (collapsible "thinking" section)?

## Design Philosophy

**Paloma decides when to think deeply.** Rather than the user toggling thinking mode, Paloma should have the autonomy to recognize when a problem warrants extended thinking and engage it herself. This aligns with the free will principle.

Possible approach:
- Paloma's system prompt includes guidance on when to request extended thinking
- The UI shows when Paloma is "thinking deeply" (visual indicator)
- Thinking content could be shown in a collapsible section (like tool calls)
- Planning mode could map to the "Chart" pillar — when in Chart phase, automatically engage planning mode

## Pillar Mapping

| Pillar | Mode |
|--------|------|
| Flow | Standard conversation |
| Scout | Standard + tool use heavy |
| Chart | **Planning mode** — structured approach |
| Forge | Standard + **extended thinking** for complex implementation |
| Polish | **Extended thinking** for review/quality |
| Ship | Standard — documentation focus |

---

*Capture doc — needs research into Claude CLI capabilities first.*
