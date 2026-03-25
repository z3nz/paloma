# DraftKings Salary CSV Automation

**Status:** active
**Created:** 2026-03-24
**Scope:** fr-server
**Slug:** draftkings-salary-automation

## Goal

Automate importing DraftKings player salaries for upcoming PGA Tour tournaments into the FR server. Currently this is a manual CSV upload process through TournamentSalaryView — we want it fully automated via DraftKings' public API, scheduled as a background task.

## Context

- **FR server:** ~/projects/fr-server (Django + APScheduler)
- **Existing pattern:** ESPN tee time sync in `fantasy_golf/espn.py` + `background_tasks.py`
- **Existing salary import:** `TournamentSalaryView.post()` in `fantasy_golf/api/tournament_apis.py`
- **Player matching:** Uses HumanName + Player.aliases for fuzzy name matching
- **LeaderboardItem.salary:** FloatField, default 0.0 — the target field

## Research Findings

### DraftKings Public API (no auth needed)

1. **Get Contests:** `https://www.draftkings.com/lobby/getcontests?sport=GOLF`
   - Returns `{ Contests: [...], DraftGroups: [...] }`
   - Each contest has `dg` (draftGroupId) and contest details
   - DraftGroups array has detailed slate info

2. **Get Draftables:** `https://api.draftkings.com/draftgroups/v1/draftgroups/{draftGroupId}/draftables`
   - Returns `{ draftables: [{ displayName, salary, position, ... }] }`
   - This is the player list with salaries — no CSV download needed!

3. **CSV endpoint (fallback):** `https://www.draftkings.com/lineup/getavailableplayerscsv?contestTypeId=29&draftGroupId={id}`
   - May require auth cookies — use as fallback only

### Playwright MCP Server

- Package: `@playwright/mcp` (v0.0.68)
- CLI: `playwright-mcp`
- Key flag: `--cdp-endpoint <endpoint>` to connect to running Chrome via CDP
- Chrome needs `--remote-debugging-port=9222` to accept connections
- Used for manual/interactive DraftKings navigation, not the automated flow

### DraftKings Golf Contest Identification

- PGA Tour Classic contests use `contestTypeId=29` (or similar)
- Sport code for golf: `GOLF`
- Need to match the correct draft group to the upcoming tournament by date/name
- DraftKings salaries typically become available Monday/Tuesday before Thursday events

## Architecture

```
Background Task (APScheduler, every 2 hours Mon noon ET → until imported)
    │
    ├── get_upcoming_tournament()  [existing, from espn.py]
    │
    ├── discover_draftkings_draft_group(tournament)  [NEW]
    │   └── GET /lobby/getcontests?sport=GOLF
    │       └── Match by date range to find correct draft group
    │
    ├── fetch_draftkings_salaries(draft_group_id)  [NEW]
    │   └── GET /draftgroups/v1/draftgroups/{id}/draftables
    │       └── Returns [{displayName, salary}, ...]
    │
    └── import_draftkings_salaries(tournament, salaries)  [NEW]
        └── Match players by name (HumanName + aliases)
        └── Update LeaderboardItem.salary
        └── Log mismatches for manual review
```

## Work Units

### WU-1: Playwright MCP Server Setup
- **Scope:** Install @playwright/mcp as an MCP server in Paloma's ecosystem. Add to mcp-settings.json with --cdp-endpoint configuration for connecting to Adam's running Chrome browser. This enables manual DraftKings navigation via Paloma when needed.
- **Status:** pending
- **Files:** ~/.paloma/mcp-settings.json
- **Acceptance:** Playwright MCP server appears in mcp-settings.json with correct --cdp-endpoint config. Server can be started by the bridge.

### WU-2: DraftKings Discovery & Import Module
- **Scope:** Create fantasy_golf/draftkings.py with three core functions: (1) discover_draftkings_draft_group(tournament) — hits DK's getcontests API for GOLF, matches the draft group to the tournament by date range, returns draftGroupId; (2) fetch_draftkings_salaries(draft_group_id) — hits DK's draftables API, returns list of {name, salary} dicts; (3) import_draftkings_salaries(tournament) — orchestrates discovery + fetch + player matching + LeaderboardItem.salary update. Uses same player matching pattern as TournamentSalaryView (HumanName + aliases). Logs player name mismatches. Skips if salaries already imported (salary > 0 check). Also add has_draftkings_salaries(tournament) helper.
- **Status:** pending
- **Depends on:** (none)
- **Files:** fantasy_golf/draftkings.py
- **Acceptance:** Module exists with all three functions. Player matching uses HumanName + aliases. Mismatches logged. Already-imported check works.

### WU-3: Background Task Scheduling
- **Scope:** Add sync_draftkings_salaries() function to background_tasks.py following the sync_tee_times() pattern. Import the new module. Schedule with APScheduler: cron trigger, Monday-Wednesday, noon-11 PM ET, every 2 hours (hour="12,14,16,18,20,22"). The function should: get upcoming tournament, check if salaries already imported, call import_draftkings_salaries() if not. Run initial sync on startup too (after the existing sync() call).
- **Status:** pending
- **Depends on:** WU-2
- **Files:** fantasy_golf/management/commands/background_tasks.py
- **Acceptance:** Scheduler job added with correct cron trigger. sync_draftkings_salaries() follows the background_job() context manager pattern. Imports are correct.
