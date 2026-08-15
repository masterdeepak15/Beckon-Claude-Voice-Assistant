# Beckon

**Hands-free voice front-end for Claude Code.** Say your assistant's name — chosen by *you* at onboarding, not by this app — and it wakes up in your system tray, listens, invokes Claude Code, notifies you, and goes back to sleep. Like Siri or Google Assistant, but for Claude Code.

```bash
npm install -g @masterdeepak15/beckon
```
One command. It downloads its own speech model, installs Claude Code if you don't have it yet, and installs the `assistant` skill — no separate setup checklist. Full detail in [`CLI.md` §1–2](./CLI.md#1-what-beckon-needs-before-you-start).

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

## Setup Automation

`beckon start` checks three things every time, in order, and fixes what it can before launching: Claude Code CLI installed → the `assistant` skill installed → onboarding actually completed. The first two are scripted (native installer, `claude plugin install`); the third genuinely can't be — naming your assistant is a real conversation, so Beckon just tells you what to do instead of faking it. Run the checks on their own with `beckon setup`. Full detail in [`CLI.md` §4](./CLI.md#4-first-run--fully-automated).

## Tray Menu

Right-click the icon: current status, **Hold/Resume** listening, **Push to Talk** (skip the wake word), switch **Voice Engine** (Whisper/Vosk/SAPI), toggle voice replies, install/remove hooks, jump to the memory folder, exit.

## Repo Layout

```
beckon/
├── bin/beckon.js            CLI entry point (installed globally as `beckon`)
├── main.js                   Electron main process — tray, popup, wiring
├── scripts/postinstall.js    runs on `npm install` — downloads the Vosk model,
│                              auto-installs the assistant skill if claude exists
├── daemon/
│   ├── config.js              reads ~/.assistant/IDENTITY.md + beckon.config.json
│   ├── core.js                wake/command state machine (EventEmitter)
│   ├── claude-bridge.js       spawns Claude Code, parses stream-json realtime
│   ├── setup.js                `beckon setup` — checks/fixes Claude Code, the
│   │                            assistant skill, and the speech model
│   ├── model-installer.js     shared download/extract logic (postinstall + setup)
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

I don't have a real display, microphone, or access to `claude.ai`/`alphacephei.com` (the real Claude Code installer and Vosk model servers) in the environment this was built in. Being specific about what's real, across all three releases so far:

✅ **Verified with actual test runs:**
- The wake/command state machine — found and fixed a real bug where a command spoken in the *same breath* as the wake word used to hang forever instead of running
- The local hook server — a real HTTP POST round-tripped through it end-to-end
- `install-hooks`/`uninstall-hooks` — merges into a real `settings.json` without disturbing an unrelated existing hook, is idempotent, cleans up only its own entries
- Icon generation — real PNGs written and validated
- The full Electron app boots — ran headlessly under Xvfb; found and fixed a real bug where a missing optional STT dependency used to crash the entire app setup instead of degrading gracefully
- The full CLI (`bin/beckon.js`) — every command tested end-to-end against a fake home directory, including graceful failure when Electron isn't installed
- `beckon setup`'s Claude-Code/skill detection — tested against fake `claude` binary fixtures covering all readiness states (nothing installed, skill-installed-but-not-onboarded, fully ready), plus idempotency (re-running against an "already installed" state doesn't error)
- Found and fixed a real bug in the install automation: `curl | bash` was silently reporting success even when curl got a 403, because bash's pipeline exit status only reflects the *last* command — fixed with `set -o pipefail`
- The postinstall model download/setup — ran a real local HTTP server serving a fixture model zip and validated the full pipeline: download → extract → correct folder placement → `config.js` auto-detects it with zero manual config (verified before/after state in the *same process*, no restart needed) → idempotent re-run skips re-downloading → non-global installs correctly skip the heavy steps → `beckon setup` correctly retries a failed/missing download rather than leaving the user stuck
- **A real production failure, not just sandbox testing:** v0.3.0 made `vosk` a required dependency, and it broke `npm install` entirely on a real Windows machine — `vosk`'s `ffi-napi` dependency failed to compile under MSBuild. Fixed in v0.3.1: `vosk` is optional again, but unlike the original `optionalDependencies` problem this replaced, every layer now explicitly checks whether `vosk` actually loaded (`config.isVoskAvailable()`) rather than assuming — the default engine self-heals to `whisper`/`sapi` instead of silently pointing at a broken one, `postinstall` gives platform-specific guidance instead of a generic warning, and `beckon setup` distinguishes "vosk never installed" from "model download failed" so the advice is actually correct for what happened. Verified by simulating the exact failure (mocking `require('vosk')` to throw) through the full chain: default-provider selection, `postinstall.js`, and `beckon setup`'s retry path.
- **A second real production failure, same user, next step:** with `vosk` fixed, `npm install` succeeded — but `beckon start` then said "🎉 Everything is ready" and immediately crashed with "Electron isn't installed." Root cause: `beckon setup` never actually checked Electron at all, and `require('electron')` can return a path string successfully even when the *actual binary* never downloaded (it's fetched separately, by Electron's own postinstall, and can silently fail on corporate networks that block the ~150MB GitHub download). Fixed in v0.3.2: added a real check (`fs.existsSync()` on the resolved binary path, not just a successful `require()`) as the very first setup step — since Beckon has no headless mode, nothing else matters if this fails — plus an automatic repair attempt (re-running Electron's own install script) before giving up. Verified for real, not just logically: installed Electron for real in the test environment, deleted its downloaded binary to reproduce the exact "`require('electron')` succeeds, but the file doesn't exist" failure mode, confirmed detection caught it, then confirmed the auto-repair actually re-downloaded a working 182MB binary from scratch.

❌ **Not verified — test on your own machine first:**
- Real microphone capture and VAD threshold tuning (`capture/capture.html`) — will likely need tuning for your mic/room
- Actual Whisper transcription accuracy/latency
- Tray icon rendering and popup positioning on your actual desktop environment (Linux tray behavior varies a lot by DE — GNOME needs an extension)
- The exact `stream-json` shape and CLI flags against your installed Claude Code version — check `claude --help`
- **The real download servers** — `claude.ai`'s native installer and `alphacephei.com`'s Vosk model host aren't reachable from where this was built, so the download/extract *mechanism* is proven against a real server, but the *specific real URLs* are correct per current docs, not confirmed end-to-end against the actual services

## License
MIT
