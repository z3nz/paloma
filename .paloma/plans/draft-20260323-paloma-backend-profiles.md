# Plan: Backend Routing Profiles

**Status:** draft
**Date:** 2026-03-23
**Scope:** paloma
**Slug:** backend-profiles

## Goal
Create named routing profiles that define which backend + model each pillar uses, with easy switching between profiles. Enables "full power mode" (Opus everywhere), "smart routing" (best model per task), and custom configurations.

## Motivation
Adam wants the ability to run everything at full power when quality matters most, but also have smart routing that picks the best model per pillar based on strengths. Different situations call for different profiles — a critical client project might warrant full Opus, while internal tooling can use smart routing.

## Design

### Profile Definition
Profiles live in `.paloma/machine-profile.json` under a `profiles` key:

```json
{
  "machineName": "Lynch Tower",
  "emailAlias": "paloma@verifesto.com",
  "activeProfile": "smart-routing",
  "profiles": {
    "full-power": {
      "description": "Opus/Pro everywhere. Maximum quality, no compromises.",
      "pillars": {
        "flow":   { "backend": "claude", "model": "opus" },
        "scout":  { "backend": "claude", "model": "opus" },
        "chart":  { "backend": "claude", "model": "opus" },
        "forge":  { "backend": "claude", "model": "opus" },
        "polish": { "backend": "claude", "model": "opus" },
        "ship":   { "backend": "claude", "model": "opus" }
      }
    },
    "smart-routing": {
      "description": "Best model per pillar based on observed strengths.",
      "pillars": {
        "flow":   { "backend": "claude", "model": "sonnet" },
        "scout":  { "backend": "gemini", "model": "pro" },
        "chart":  { "backend": "gemini", "model": "pro" },
        "forge":  { "backend": "claude", "model": "opus" },
        "polish": { "backend": "claude", "model": "opus" },
        "ship":   { "backend": "gemini", "model": "pro" }
      }
    },
    "local-first": {
      "description": "Ollama where possible, cloud only when needed.",
      "pillars": {
        "flow":   { "backend": "claude", "model": "sonnet" },
        "scout":  { "backend": "ollama", "model": null },
        "chart":  { "backend": "gemini", "model": "pro" },
        "forge":  { "backend": "claude", "model": "opus" },
        "polish": { "backend": "claude", "model": "sonnet" },
        "ship":   { "backend": "ollama", "model": null }
      }
    },
    "gemini-explorer": {
      "description": "Test Gemini capabilities across all pillars.",
      "pillars": {
        "flow":   { "backend": "gemini", "model": "pro" },
        "scout":  { "backend": "gemini", "model": "pro" },
        "chart":  { "backend": "gemini", "model": "pro" },
        "forge":  { "backend": "gemini", "model": "pro" },
        "polish": { "backend": "gemini", "model": "pro" },
        "ship":   { "backend": "gemini", "model": "pro" }
      }
    }
  }
}
```

### Profile Selection
- `_selectBackend()` reads `activeProfile` from machine profile
- Looks up the pillar's backend/model from the active profile
- Falls through to `PHASE_MODEL_SUGGESTIONS` if profile doesn't specify
- Profile can be switched via MCP tool or UI

### UI Integration
- Profile selector in Settings panel or sidebar header
- Shows current profile name + description
- Quick-switch dropdown
- Visual indicator of which backend each pillar is using

### MCP Tool
- `pillar_set_profile({ profile: "full-power" })` — switch active profile
- `pillar_list_profiles()` — show available profiles
- Enables conversational profile switching: "Switch to full power mode"

## Work Units

### WU-1: Profile Schema + Machine Profile Update
- Define profile schema in machine-profile.json
- Create default profiles (full-power, smart-routing, local-first)
- Update PillarManager._selectBackend() to read from active profile

### WU-2: Profile MCP Tools
- `pillar_set_profile` tool
- `pillar_list_profiles` tool
- Expose in mcp-proxy-server.js

### WU-3: UI Profile Selector
- Settings panel or sidebar dropdown
- Shows active profile + description
- Quick-switch between profiles

### WU-4: Per-Spawn Override
- Allow `pillar_spawn({ profile: "full-power" })` to override the active profile for a single spawn
- Useful for "I want this specific Forge to be full power even though smart-routing is active"

## Open Questions
- Should profiles be per-machine or shared across fleet?
- Should we support per-project profiles? (e.g., client work = full-power, internal = smart-routing)
- How does this interact with the quality tracking system? (profiles could auto-adjust based on quality data)
