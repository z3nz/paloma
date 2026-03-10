# JARVIS Voice System

**Status:** Scout ✅ → Chart ✅ → Forge ✅ → Polish ✅ → Ship 🔄  
**Date:** 2026-03-10  
**Scope:** Paloma core — voice interaction system

## Goal

Give Paloma a voice. Build an MCP tool that speaks text aloud via Kokoro TTS with a JARVIS-like British male personality. Integrate voice behavior into Paloma's DNA so every pillar, every session knows how and when to speak.

## Research References

- `.paloma/docs/research-jarvis-voice-style-guide.md` — JARVIS personality analysis (15+ quotes, style rules, anti-patterns)
- `.paloma/docs/scout-voice-input-windows-20260310.md` — Windows Voice Access setup guide

## Architecture

### Components
1. **`mcp-servers/voice-speak.py`** — Python TTS script (Kokoro, `bm_george` voice, British English)
2. **`mcp-servers/voice.js`** — Node.js MCP server wrapping the Python script
3. **`~/.paloma/mcp-settings.json`** — Server registration
4. **`.paloma/mcp.json`** — Permissions (enabled + autoExecute)
5. **`src/prompts/base.js`** — Voice System section with JARVIS personality rules
6. **`src/prompts/phases.js`** — Per-pillar voice behavior (when each pillar should speak)
7. **`.paloma/instructions.md`** — Voice system documentation

### Voice Input (Adam → Paloma)
- Windows Voice Access (Settings > Accessibility > Speech)
- Always-on, on-device speech recognition
- Types directly into Windows Terminal / WSL2
- Sleep/wake commands for walk-around-the-house workflow

### Voice Output (Paloma → Adam)
- `mcp__paloma__voice__speak` MCP tool
- Kokoro TTS with `bm_george` voice (British male)
- PulseAudio through WSLg to Windows speakers/headset
- JARVIS personality: short, confident, warm, witty

## Implementation Notes

- `sanitizer.py` (root) was the original prototype — `voice-speak.py` is the production version
- `kokoro_env/` virtual environment has all Python dependencies pre-installed
- Voice server auto-executes (no permission prompt needed)
- Voice sections added to ALL six pillars in phases.js with pillar-appropriate examples
- bm_george chosen over bm_fable/bm_daniel based on quality grade and JARVIS community recommendations
