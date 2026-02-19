# Claude Code Instructions

## First Thing — Read the Project Instructions

At the start of every conversation, **read `.paloma/instructions.md` before doing anything else.** That file is the canonical source of truth for all project knowledge, workflow rules, conventions, and discipline. It is loaded automatically in Paloma's own UI sessions and pillar spawns, but Claude Code does not load it by default — so you must read it yourself.

Also read any `active-` plans in `.paloma/plans/` to understand current work in progress.

## Knowledge Lives in the Project

All project knowledge belongs in `.paloma/` — in `instructions.md`, plans, docs, and roots. NOT only in external tool memory (Claude's MEMORY.md, etc.). When you learn something new, write it to `.paloma/instructions.md` or `.paloma/docs/` FIRST. External memory may reference the project as source of truth, but `.paloma/` is the canonical home. This ensures knowledge travels with `git clone` and is available to every tool, every pillar, every session — not locked to one AI provider.

## MCP Tools

Prefer MCP tools (`mcp__paloma__*`) over Claude-native tools (Read, Write, Edit, Bash) when available. MCP tools flow through Paloma's bridge and work reliably. Use Claude-native tools as fallback only.
