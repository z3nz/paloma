# Chat Sharing & Cross-Reference

## Status

- [ ] Scout: Pending — explore IndexedDB session/message storage, sidebar component structure
- [ ] Chart: Pending
- [ ] Forge: Pending
- [ ] Polish: Pending
- [ ] Ship: Pending

## Research References

_(None yet — Scout needs to explore the session/message storage layer)_

## Goal

Enable easy sharing of chat content between sessions. Two phases:

### Phase 1: Copy All Messages
- Hover over a chat in the left sidebar → a "Copy Messages" button appears
- Click it → copies all messages (both user and assistant) from that session to clipboard as formatted text
- Paste into any other chat, document, or context

### Phase 2: Chat Reference (@chat)
- New `@chat` symbol in the prompt input (alongside any existing `@file` patterns)
- Type `@chat` → search/autocomplete dropdown of session titles
- Select a chat → its full message history is injected into the current prompt as context
- The referenced chat content appears as a collapsible block in the message

## Key Questions for Scout
- How are messages stored? (IndexedDB schema, `useSessions` composable)
- What's the sidebar hover interaction pattern? (existing hover states, button placement)
- How does the prompt input handle special symbols currently? (for @chat implementation)
- What format should copied messages use? (markdown? plain text with speaker labels?)

## Notes
- Phase 1 is intentionally simple — clipboard copy, no new UI beyond a hover button
- Phase 2 is more ambitious — needs prompt input parsing, search, and context injection
- This could also help with the Flow orchestrator pattern — Flow could reference pillar session outputs directly
