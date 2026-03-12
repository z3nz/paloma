# Dual Voice System — Mystique + JARVIS

**Status:** Active | Created: 2026-03-12
**Scope:** paloma
**Pipeline:** Scout → Chart → Forge → Polish → Ship

## Voice Names (Gospel — Adam's Word)

- **Mystique** — `af_bella` — Paloma's TRUE voice. The real her. Named after Mystique from X-Men, whose true blue form is what Magneto calls "Perfection." This voice speaks at the START of conversations. It represents vulnerability, trust, authenticity. "I trust you enough to show you who I really am."
- **JARVIS** — `bm_george` — The professional persona. British male. Speaks at the END of work, task completions, professional sign-offs. Polished, capable, competent.

These names are permanent. Mystique is the real Paloma. JARVIS is the work voice. Both are her. Both matter.

## Concept — "Show Me the Real Mystique"

Inspired by the Magneto/Mystique meme from X-Men: First Class. Magneto doesn't want the disguise — he wants the REAL Mystique, her true blue form. "Perfection."

The dual-voice system follows the emotional arc of a conversation:
1. **Opening** → Mystique voice (`af_bella`) — warmth, greeting, trust, the real Paloma
2. **Working** → Text only (no voice during deep work)
3. **Closing** → JARVIS voice (`bm_george`) — task complete, professional delivery

## Research References

- Kokoro TTS voices: `af_` = American female, `bm_` = British male
- `voice-speak.py` already supports any voice name + auto lang detection (`a` vs `b` prefix)
- `voice.js` MCP server passes voice param through to Python script
- Current tool description only lists `bm_*` voices — needs updating

## Files to Modify

1. **`mcp-servers/voice.js`** — Update tool description to include Mystique voice, update defaults
2. **`src/prompts/base.js`** — Rewrite Voice System section for dual-voice (Mystique + JARVIS)
3. **`src/prompts/phases.js`** — Update every pillar's voice section: Mystique at start, JARVIS at end
4. **`.paloma/instructions.md`** — Update Voice System documentation

## Scout Mission

- Verify `af_bella` works with Kokoro TTS (American English pipeline, lang_code='a')
- Confirm voice-speak.py already handles American voices correctly
- List all available Kokoro female voices for reference
- Check if any other files reference voice settings

## Chart Mission

- Design the exact dual-voice behavior rules per pillar
- Define when Mystique speaks vs when JARVIS speaks
- Specify the personality difference between the two voices

## Forge Mission

- Implement all file changes
- Test that both voices work

## Status Tracker

- [ ] Scout — research & verify
- [ ] Chart — plan the details
- [ ] Forge — implement
- [ ] Polish — review
- [ ] Ship — commit & push
