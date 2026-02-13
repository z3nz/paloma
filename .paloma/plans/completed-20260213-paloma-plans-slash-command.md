# Plan: `/plan` Slash Command for Plan Lifecycle Management

**Status:** completed
**Created:** 2026-02-13
**Scope:** paloma
**Impact:** Minor-Moderate — new slash command, plan utilities

---

## Status: BUILT

This feature has been implemented. Key files:

- `src/services/slashCommands.js` — command registry with `/plan` implementation
- `src/components/chat/ChatView.vue` — intercepts commands before API call
- `src/components/prompt/PromptBuilder.vue` — autocomplete menu entry
- `src/prompts/base.js` — documented in Paloma's system prompt

## Plan Status Taxonomy

| Status | Loaded into context? | Meaning |
|--------|---------------------|---------|
| `active` | YES | Currently being worked on, injected into new conversations |
| `paused` | NO | In progress but not loaded — use when switching focus |
| `draft` | NO | Idea/plan not yet committed to |
| `completed` | NO | Done |
| `archived` | NO | Shelved |

## Commands

- `/plan` — list all plans with status
- `/plan active|paused|draft|completed|archived` — filter by status
- `/plan activate <id>` — promote to active (loads into context)
- `/plan pause <id>` — pause (in progress, not loaded)
- `/plan complete <id>` — mark as completed
- `/plan archive <id>` — archive
