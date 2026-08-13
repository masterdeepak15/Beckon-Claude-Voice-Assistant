# Beckon

**Hands-free voice front-end for Claude Code.** Say your assistant's name — chosen by *you* at onboarding, not by this app — and it wakes up in your system tray, listens, invokes Claude Code, notifies you, and goes back to sleep. Like Siri or Google Assistant, but for Claude Code.

> **Installation, every CLI command, and configuration reference → [`CLI.md`](./CLI.md).** This file is architecture and design; that one is how-to.

## What It Does

```
🎙  Hidden Electron window (getUserMedia) — mic capture, same code on Windows & Linux
       │  PCM chunks + energy-based voice detection (utterance boundaries)
       ▼
🧠  STT provider (your choice): Whisper | Vosk | Windows SAPI — 100% local, zero AI cost
       │  wake phrase detected (your assistant's name) → buffer the command → "processing"
       ▼
⚡  Claude Code invoked once: `claude -p "<command>" -c --output-format stream-json`
       │  realtime text + tool-use events streamed back as they happen
       ▼
🔔  Tray icon animates, popup shows live status, native OS notification on completion
       ▼
💤  Back to idle — the Claude Code process already exited, nothing lingers
```

Nothing calls Claude until you've actually said a command after the wake word. Wake it and say nothing → it just goes back to sleep, no cost incurred.

## The Assistant's Name Is Yours, Not Ours

Beckon is the name of *this app*. The name it listens for is whatever you named your assistant during the Claude Code `assistant` skill's onboarding — Maya, Jarvis, whatever you picked. Beckon reads that choice live from `~/.assistant/IDENTITY.md`; it's never hardcoded.

## Two Realtime Channels

1. **`stream-json` on stdout** — granular live updates (text, tool calls) for the specific command Beckon itself launched.
2. **Claude Code's native HTTP hooks** *(optional — `beckon install-hooks`)* — Claude Code can POST directly to a local endpoint Beckon runs (`type: "http"` hooks, no `curl` subprocess needed). This makes Beckon aware of *any* Claude Code session on your machine, not just voice-triggered ones — e.g. a manual terminal session hitting a permission prompt can still notify you. Everything stays on `127.0.0.1`. Full detail in [`CLI.md` §7](./CLI.md#7-realtime-hooks-optional).

## Tray Menu

Right-click the icon: current status, **Hold/Resume** listening, **Push to Talk** (skip the wake word), switch **Voice Engine** (Whisper/Vosk/SAPI), toggle voice replies, install/remove hooks, jump to the memory folder, exit.

## Repo Layout

```
beckon/
├── bin/beckon.js            CLI entry point (installed globally as `beckon`)
├── main.js                   Electron main process — tray, popup, wiring
├── daemon/
│   ├── config.js              reads ~/.assistant/IDENTITY.md + beckon.config.json
│   ├── core.js                wake/command state machine (EventEmitter)
│   ├── claude-bridge.js       spawns Claude Code, parses stream-json realtime
│   ├── hook-server.js         local HTTP server for Claude Code's native hooks
│   ├── install-hooks.js       safe merge into ~/.claude/settings.json
│   ├── tts.js                 optional OS-native voice replies
│   ├── stt/                   whisper.js, vosk.js, sapi.js — pluggable STT providers
│   └── service/                windows.js, linux.js — auto-start registration
├── capture/                   hidden renderer: mic capture via getUserMedia
├── renderer/                  popup overlay (listening/processing animation)
├── assets/generate-icons.js   tray icon PNG generator
└── CLI.md                     full install/usage documentation
```

## What's Actually Been Tested

I don't have a real display, microphone, or a live Claude Code session with hooks configured in the environment this was built in. Being specific about what's real:

✅ **Verified with actual test runs:**
- The wake/command state machine — found and fixed a real bug where a command spoken in the *same breath* as the wake word used to hang forever instead of running
- The local hook server — a real HTTP POST round-tripped through it end-to-end
- `install-hooks`/`uninstall-hooks` — merges into a real `settings.json` without disturbing an unrelated existing hook, is idempotent, cleans up only its own entries
- Icon generation — real PNGs written and validated
- **The full Electron app boots** — ran headlessly under Xvfb; found and fixed a real bug where a missing optional STT dependency used to crash the entire app setup instead of degrading gracefully
- The full CLI (`bin/beckon.js`) — every command tested end-to-end against a fake home directory, including graceful failure when Electron isn't installed yet

❌ **Not verified — test on your own machine first:**
- Real microphone capture and VAD threshold tuning (`capture/capture.html`) — will likely need tuning for your mic/room
- Actual Whisper transcription accuracy/latency, and the first-run model download
- Tray icon rendering and popup positioning on your actual desktop environment (Linux tray behavior varies a lot by DE — GNOME needs an extension)
- The exact `stream-json` shape and CLI flags against your installed Claude Code version — check `claude --help`

## License
MIT
