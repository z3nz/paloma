# Voice Input on Windows 11 for WSL2 Terminal

**Date:** 2026-03-10  
**Context:** Setting up always-on voice dictation for talking to Paloma in WSL2 terminal

## Recommendation: Windows Voice Access

**Voice Access** (not Win+H Voice Typing) is the right tool. Key differences:

| Feature | Voice Typing (Win+H) | Voice Access |
|---|---|---|
| Always-on | No (stops on keyboard) | **Yes** |
| Internet required | Yes (Azure cloud) | **No** (on-device) |
| Stops on Enter key | Yes | **No** |
| Sleep/wake commands | No | **Yes** |

## Setup

1. **Settings > Accessibility > Speech > Voice Access** — turn it on
2. Downloads speech model (~150MB) on first run
3. Set to **auto-start at login**
4. Connect headset
5. Focus Windows Terminal (WSL2 session)
6. Speak naturally — it types your words

## Voice Commands

- **"Voice access sleep"** — pause listening (walk away)
- **"Voice access wake up"** — resume listening (come back)
- **"Press Enter"** — submit the text (in default mode)
- Stay in **default mode** (not dictation mode) for terminal use — it auto-detects text fields

## WSL2 Compatibility

Works perfectly. Windows Terminal is a native Win32 app — Voice Access injects keystrokes at the Windows level. No special config needed.

## Alternatives

- **Wispr Flow** — Push-to-talk (Ctrl+Win), better transcription for technical terms, $15/mo
- **Talon Voice** — Always-on, programmable, steep learning curve, free tier available
- **VoiceMode MCP** — MCP server with local Whisper STT, experimental
