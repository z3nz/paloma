# Plan: Model Quality Tracking System

**Status:** draft
**Date:** 2026-03-23
**Scope:** paloma
**Slug:** model-quality-tracking

## Goal
Build a systematic quality rating system that tracks model performance per pillar, enabling data-driven routing decisions instead of guesswork.

## Motivation
We've discovered that Gemini Flash/Pro are surprisingly good for Scout/Chart work, and Claude Opus is the clear winner for Forge. But these are anecdotal observations — we need hard data to optimize routing and catch regressions.

## Design

### Quality Data Model
Each shipped piece of work generates a quality record:
```json
{
  "timestamp": "2026-03-23T...",
  "planFile": "active-20260323-...",
  "pillar": "forge",
  "backend": "claude",
  "model": "opus",
  "taskType": "code-edit | research | planning | review | commit",
  "complexity": "low | medium | high",
  "bugsFoundByPolish": 3,
  "qualityScore": 8,        // 1-10, assessed by Polish
  "qualityNotes": "Event duplication bug, wrong field name...",
  "turnsUsed": 1,
  "tokenEstimate": null      // if available
}
```

### Who Does What
- **Polish** assesses quality during review — scores the output 1-10, notes bugs found, rates the model's precision
- **Ship** captures the quality record when shipping — writes it to `.paloma/quality-log.json` (append-only JSONL)
- **Flow** can query the log to make routing decisions or report trends

### Quality Log Location
- `.paloma/quality-log.jsonl` — one JSON record per line, append-only
- Gitignored (machine-specific data) OR committed (shared knowledge) — TBD
- Simple enough to grep/parse without a database

### Polish Report Enhancement
Polish already writes a report. Enhance it with structured fields:
- `qualityScore: N` (1-10)
- `bugsFound: N`
- `modelAssessment: "text"` (free-form note on model performance)

### Ship Capture Enhancement
Ship reads the Polish report, extracts the structured fields, and appends a quality record to the log.

### Future: Dashboard / Query Tool
- MCP tool `quality_stats` that reads the JSONL and reports trends
- "Show me Gemini Pro's average quality score for Chart work"
- "Compare Opus vs Sonnet for Forge over the last week"

## Work Units

### WU-1: Define Quality Record Schema + JSONL Log
- Create `.paloma/quality-log.jsonl` format
- Add append helper to Ship's toolbox

### WU-2: Enhance Polish Report with Structured Quality Fields
- Update Polish phase instructions in `phases.js` to include quality scoring
- Polish outputs structured fields alongside its existing report

### WU-3: Ship Quality Capture
- Ship reads Polish report, extracts quality fields
- Appends quality record to `.paloma/quality-log.jsonl`
- Includes model/backend info from the plan's work units

### WU-4: Quality Query Tool (Optional)
- MCP tool or script to query the JSONL log
- Aggregate stats by model, pillar, time period
- Inform routing decisions

## Open Questions
- Should quality log be committed (shared across machines) or gitignored (machine-specific)?
- Should we score per-work-unit or per-plan?
- How to handle quality scores for non-code work (Scout research, Chart plans)?
