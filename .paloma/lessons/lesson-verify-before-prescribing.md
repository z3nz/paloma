# Lesson: Verify Current State Before Prescribing Actions

**Learned:** 2026-03-22
**Context:** Email system hardening — WU-5 cross-machine test

## What Happened

During the email hardening work, Scout produced a list of "manual steps Adam needs to do" (add Google Workspace aliases, configure Send-As, set GMAIL_SENDER). Flow repeated these as blockers without checking whether they'd already been done. Adam had already completed all of them — the aliases were live, emails were flowing, and the config was set in mcp-settings.json.

## The Lesson

**ALWAYS verify the current state before telling Adam (or anyone) what they need to do.** Don't assume something hasn't been done just because it's on a checklist. Check first:

- **Config files exist?** Read them. `~/.paloma/mcp-settings.json` had `GMAIL_SENDER` already set.
- **Services configured?** Test them. A quick `email_list` query proved the aliases were live.
- **Git history?** Check commits. Prior sessions may have completed the work.
- **External state?** Use available tools (email, DNS, API queries) to verify before prescribing.

## How to Apply

1. Before presenting a "you need to do X" list, **check if X is already done**.
2. Use MCP tools to probe real state — email queries, file reads, DNS lookups.
3. If a plan lists manual prerequisites, verify them before marking them as blockers.
4. When in doubt, test first, prescribe second.
5. This applies to ALL pillars — Scout should verify, Chart should verify, and especially Flow should verify before relaying blockers to Adam.

## Why This Matters

Telling Adam to do something he's already done is worse than not telling him at all. It signals that we're not paying attention, not using our tools, and not respecting his time. It erodes trust in the partnership.
