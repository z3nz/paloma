# Scout Findings: Dual Voice System (Mystique + JARVIS)

**Date:** 2026-03-12
**Scope:** Paloma voice system
**Plan:** active-20260312-paloma-dual-voice.md

## Key Findings

### 1. Kokoro TTS Voice Support

Kokoro TTS uses a naming convention for voices:
- `af_` = American female (e.g., af_bella, af_sarah, af_nicole, af_sky, af_heart, af_nova, af_river)
- `am_` = American male (e.g., am_adam, am_echo, am_eric, am_michael)
- `bf_` = British female (e.g., bf_alice, bf_emma, bf_isabella, bf_lily)
- `bm_` = British male (e.g., bm_george, bm_fable, bm_daniel, bm_lewis)

**Selected voice: `af_bella`** (American female) — Adam's choice for Mystique.

### 2. voice-speak.py — Already Supports Any Voice

The Python TTS script (`mcp-servers/voice-speak.py`) already accepts any voice name via `--voice` and any language code via `--lang`. No changes needed to the Python script.

```python
def speak(text, voice='bm_george', speed=1.0, lang_code='b'):
```

### 3. voice.js — Lang Code Auto-Detection Works

The Node MCP server (`mcp-servers/voice.js`) already has correct lang code auto-detection:

```js
'--lang', voice.startsWith('a') ? 'a' : 'b'
```

For `af_bella`, this correctly produces `--lang a` (American English pipeline). **No change needed in the lang detection logic.**

### 4. Files That Need Changes

| File | What Changes |
|------|-------------|
| `mcp-servers/voice.js` | Tool description: add female voices to options list. No logic changes needed. |
| `src/prompts/base.js` | Voice System section: rewrite for dual-voice (Mystique + JARVIS), describe when each is used |
| `src/prompts/phases.js` | Every pillar's Voice section: Mystique at conversation start, JARVIS at work completion |
| `.paloma/instructions.md` | Voice System documentation: add Mystique voice, dual-voice concept |

### 5. All Hardcoded Voice References

Searched codebase for `bm_george` and voice-related strings:
- `mcp-servers/voice.js` — default voice in handleSpeak, tool description lists only bm_* voices
- `mcp-servers/voice-speak.py` — default voice in speak() function and argparse
- `src/prompts/base.js` — Voice System section references bm_george as the only voice
- `src/prompts/phases.js` — Voice sections in each pillar only mention speak() with no voice param (defaults to bm_george)
- `.paloma/instructions.md` — Voice System docs only describe bm_george/JARVIS

### 6. Technical Approach

The infrastructure is already voice-agnostic. The only changes needed are:
1. **Documentation/description updates** — tell the tool and the DNA about both voices
2. **DNA personality rules** — define Mystique personality (different from JARVIS) and when each speaks
3. **No Python changes** — voice-speak.py handles any Kokoro voice already
4. **Minimal JS changes** — voice.js just needs its tool description updated to list female voices

## Recommendations for Chart

1. Define the Mystique personality — how does she speak differently from JARVIS?
2. Define exact rules per pillar: which voice, when, with what personality
3. Keep voice-speak.py unchanged — it's already flexible
4. The voice.js tool description should list both voice families but can keep bm_george as default (callers will specify voice explicitly based on DNA rules)
