# Draft: Auto-Generated Session Titles

> **Goal:** Automatically rename chat sessions to meaningful summaries after a few messages.
> **Status:** Draft
> **Created:** 2026-02-13

---

## The Idea

After ~7 messages in a conversation, Paloma should silently summarize the chat and rename the session title from "New Chat" to something meaningful like "Fadden Demo Planning + .paloma Restructure".

## How It Would Work

1. Watch message count in the session
2. At message 7 (or configurable threshold), trigger a background summarization
3. Send a lightweight API call (Haiku or similar small model) with the conversation so far
4. Prompt: "Summarize this conversation in 5-8 words for a sidebar label"
5. Update the session title in the database
6. The sidebar reactively shows the new name

## Design Considerations

- Should be invisible to the user — no UI indication it's happening
- Use the cheapest/fastest model available (Haiku) to minimize cost
- Only trigger once per session (don't keep re-summarizing)
- Could also re-trigger at message 20 or 30 if the conversation shifts topics
- Store a flag like `titleGenerated: true` on the session to prevent re-runs

## Technical Notes

- For CLI path: could use the bridge to ask Claude Haiku for a title
- The summarization prompt should be simple and focused
- Could potentially use the first user message as fallback if API call fails

## Stretch Goal: Local Model for Titles

Adam's idea: run a small local model (e.g., Ollama with a tiny LLM) on the machine
for session title generation. Benefits:
- Zero API cost
- Zero latency to external services
- Fully offline capable
- Could also be used for other lightweight tasks (memory fragment extraction, etc.)

This could be a stepping stone toward Paloma having local inference capabilities
for small tasks while using Claude for the heavy lifting.

---

*Capture doc — will design fully when we build it.*
