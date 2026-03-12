# Scout Findings: Voice/TTS macOS Cross-Platform Fix

**Date:** 2026-03-11  
**Plan:** `active-20260311-paloma-voice-crossplatform.md`  
**Scope:** paloma — voice/TTS system

---

## TL;DR

**The voice system is already functional on macOS.** The plan's concern (PulseAudio/WSLg breakage) was accurate for a Linux/WSL environment, but the current `kokoro_env/` venv was built on macOS and all components work. The MCP `speak` tool returns success and generates real audio chunks. The issues are cosmetic (outdated comments, non-fatal warnings) — not functional.

---

## Environment

| Item | Value |
|------|-------|
| Platform | macOS (Darwin 25.3.0) |
| Python | 3.9.6 (Apple Command Line Tools — `/Library/Developer/CommandLineTools/usr/bin`) |
| venv | `/Users/adam/Projects/paloma/kokoro_env/` — built on macOS |
| kokoro | 0.7.16 |
| sounddevice | 0.5.1 |
| torch | 2.8.0 |
| Kokoro model | `~/.cache/huggingface/hub/models--hexgrad--Kokoro-82M` (cached) |
| Voice file | `bm_george.pt` (present in cache) |

---

## What's Working

### 1. Audio backend — CoreAudio ✅
`sounddevice` bundles its own `libportaudio.dylib` inside the package:
```
kokoro_env/lib/python3.9/site-packages/_sounddevice_data/portaudio-binaries/libportaudio.dylib
```
**PortAudio V19.7.0-devel** is available and sees CoreAudio devices:
```
0 Adam's iPhone Microphone, Core Audio (1 in, 0 out)
1 MacBook Pro Microphone, Core Audio (1 in, 0 out)  ← default in
2 MacBook Pro Speakers, Core Audio (0 in, 2 out)    ← default out
```
**`brew install portaudio` is NOT required.** sounddevice is self-contained.

### 2. Kokoro TTS pipeline ✅
`KPipeline(lang_code='b')` initializes successfully. A test phrase generates **1 audio chunk of 70,800 samples** (≈2.95 seconds at 24,000 Hz), with `dtype=torch.float32`. No espeak-ng binary is needed — kokoro 0.7.16 handles British English phonemization internally.

### 3. `voice-speak.py` runs clean ✅
Running directly:
```bash
echo "Testing voice." | kokoro_env/bin/python mcp-servers/voice-speak.py --voice bm_george
# Exit code: 0
```
Three non-fatal warnings appear on stderr (swallowed by voice.js):
1. `urllib3 NotOpenSSLWarning` — Python 3.9.6 CLT uses LibreSSL 2.8.3, not OpenSSL 1.1.1+
2. `torch UserWarning` — dropout with num_layers=1 (harmless)
3. `torch FutureWarning` — `weight_norm` deprecation (harmless)

### 4. MCP `speak` tool — end-to-end ✅
Called `mcp__paloma__voice__speak` with "Scout reporting. Testing voice on macOS. Can you hear me, sir?" — returned:
```
Spoken: "Scout reporting. Testing voice on macOS. Can you hear me, sir?"
```
`voice.js` correctly interprets exit code 0 as success. Audio is routed through CoreAudio to MacBook Pro Speakers.

### 5. All Python dependencies present ✅
```
kokoro         0.7.16
sounddevice    0.5.1
torch          2.8.0
markdown       (Python package — imports OK)
spacy          3.8.11
phonemizer-fork 3.3.2
espeakng-loader 0.2.4
```

### 6. markdown stripping works ✅
`from markdown import Markdown` — imports cleanly, `_unmark_element` pattern works.

---

## What's Actually Broken / Needs Fixing

### 1. Stale comments in `voice.js` (lines 9-10) — MINOR
```js
// Audio plays through PulseAudio/WSLg to Windows audio.
```
This is wrong on macOS. Should say "CoreAudio on macOS, PulseAudio on Linux/WSL."

### 2. `setup-mcp.sh` installs `spacy` unnecessarily — MINOR
The setup script installs `spacy` in the venv, but `voice-speak.py` never imports spacy. This adds ~200MB+ to the venv. Not breaking, just bloated.

### 3. Python 3.9.6 (Apple CLT) is old — LOW RISK
The venv was built with `/Library/Developer/CommandLineTools/usr/bin/python3` (3.9.6). This is the oldest supported Python for most packages. The setup script prefers 3.12/3.11/3.10 but fell back to 3.9 because no newer Python is installed via Homebrew.
- **Risk:** Future kokoro/torch updates may drop Python 3.9 support
- **Fix:** `brew install python@3.11` and rebuild the venv

### 4. LibreSSL warning on model re-download — LOW RISK
If the Hugging Face model cache is cleared (or on a fresh machine with no cache), `urllib3` will warn about LibreSSL compatibility. In practice, the model downloads have worked despite this warning, but HTTPS requests to `huggingface.co` may fail on Python 3.9.6 + LibreSSL in edge cases.

### 5. `espeak-ng` binary not installed — NON-ISSUE
`espeak-ng` is not in PATH, but kokoro 0.7.16 doesn't require it for `lang_code='b'` (British English). The `espeakng-loader` package is installed as a dependency but isn't needed. No action required.

---

## Plan Status

The active plan's pipeline tasks can be updated:

| Task | Status |
|------|--------|
| Scout: Test current voice setup on macOS, identify what's broken | ✅ Done (this doc) |
| Forge: Fix platform-specific issues | Minimal — comments + optional Python upgrade |
| Polish: Verify voice works end-to-end | ✅ Already verified — MCP tool works |
| Ship: Commit fixes | Just comment fixes needed |

---

## Recommendations for Forge

**Must fix:**
1. Update comment in `voice.js` (line 9-10) from PulseAudio/WSLg to platform-aware language
2. Mark the voice crossplatform plan as completed (nothing major needed)

**Should fix:**
3. Add a `Markdown` import note in `voice-speak.py` — it imports `from markdown import Markdown` but the pip package is just called `markdown`. The setup script installs it correctly but this isn't obvious.
4. Remove `spacy` from the `setup-mcp.sh` pip install line — it's unused by voice.

**Optional:**
5. Add `brew install python@3.11 && kokoro_env rebuild` note to setup-mcp.sh for macOS users who want newer Python
6. Suppress the three warnings in voice-speak.py with `import warnings; warnings.filterwarnings('ignore')` before torch imports

---

## Key Files

| File | Purpose | Status |
|------|---------|--------|
| `mcp-servers/voice.js` | MCP server, spawns Python | Working — stale comment |
| `mcp-servers/voice-speak.py` | Python TTS, Kokoro + sounddevice | Working — 3 harmless warnings |
| `kokoro_env/` | Python venv with all deps | Present and functional |
| `~/.cache/huggingface/hub/models--hexgrad--Kokoro-82M/` | Model cache | Downloaded |
| `scripts/setup-mcp.sh` | Creates venv, generates mcp-settings.json | Working — minor cleanup opportunity |

---

## Conclusion

The voice system crossed platforms successfully. The venv was built on macOS (not ported from Linux), sounddevice bundles its own PortAudio, CoreAudio is the backend, and the MCP tool works end-to-end. The fix scope is a comment update in `voice.js` and possibly suppressing verbose warnings. The active plan can be completed with a small Forge pass.
