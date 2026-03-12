# Voice/TTS Cross-Platform Fix

**Status:** active → resolved
**Created:** 2026-03-11
**Scope:** paloma

## Result

Voice/TTS is **working on macOS**. Tested successfully — `speak` tool produced audio output. The `kokoro_env/` Python venv exists with all dependencies. No fix was needed — the setup script already handles macOS correctly.

## What Was Verified

- `kokoro_env/` venv exists at `/Users/adam/Projects/paloma/kokoro_env/`
- Python 3.9.6 available at `/usr/bin/python3`
- `mcp__paloma__voice__speak` tool executed successfully
- Audio output worked (spoke greeting to Adam)

## Note

If voice breaks in the future on macOS, check:
- `portaudio` installed via `brew install portaudio` (needed by `sounddevice`)
- `kokoro_env/` venv is intact — recreate with `python3 -m venv kokoro_env && kokoro_env/bin/pip install kokoro sounddevice markdown spacy`
