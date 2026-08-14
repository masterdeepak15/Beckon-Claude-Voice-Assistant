# Beckon — CLI Reference

Everything needed to install, run, and manage Beckon from the command line. For the architecture and design rationale, see `README.md`; this doc is pure how-to.

---

## 1. What Beckon Needs Before You Start

Short version: **just Node.js 18+ and a microphone.** Everything else — Claude Code, the `assistant` skill, the speech engine and its model — installs itself. Details below are for reference/troubleshooting, not steps you need to do by hand.

| Requirement | Handled how |
|---|---|
| Node.js 18+ | You install this yourself — the one real prerequisite |
| [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) | Auto-installed by `npm install` (if `claude` is already on PATH) or by `beckon start` (if not) |
| The **`assistant`** Claude Code skill | Auto-installed the same way |
| Speech engine + model (Vosk on Linux) | Auto-downloaded during `npm install` |
| Onboarding (naming your assistant) | **Can't be automated** — see §4, it's one short conversation |
| A microphone | Yours to provide |
| Windows 10+ or Linux with a desktop environment | macOS isn't supported (not tested, no code path for it) |

**Windows:** the default voice engine (SAPI) is built into the OS — nothing to install at all for the default setup. Just confirm a default mic is set (Settings → Sound) with permission for Windows Speech Recognition.

**Linux:** the default voice engine is Vosk, and `npm install` downloads its model automatically (~40MB, one-time). The only thing worth installing yourself if it's missing: `sudo apt install alsa-utils` (provides `arecord`, used as a capture fallback on some setups).

---

## 2. Installation

```bash
npm install -g @masterdeepak15/beckon
```

That's it. This one command:
- Installs the `beckon` CLI and the Electron tray runtime (a required dependency now — no separate step)
- Downloads the Vosk speech model automatically, so `sttProvider: "vosk"` works immediately with zero manual config
- If Claude Code is already on your PATH, installs the `assistant` skill for you too
- If Claude Code *isn't* installed yet, that's fine — `beckon start` installs it the first time you run it (§4)

Watch the output — it tells you exactly what it did and what (if anything) is still pending.

### Installing from source (if you cloned the repo instead)
```bash
git clone https://github.com/masterdeepak15/Beckon-Claude-Voice-Assistant.git
cd Beckon-Claude-Voice-Assistant
npm install         # same automatic setup runs here too
npm link             # makes the local `beckon` command available globally
```

---

## 3. Voice Engines (Switch Anytime, No Reinstall Needed)

All three engines' packages install with Beckon itself now — switching between them from the tray's **Voice Engine** menu (or `sttProvider` in the config) never requires a separate `npm install` step.

| Engine | Model setup | Best for |
|---|---|---|
| `sapi` | None — built into Windows | Windows users, zero setup |
| `vosk` | Auto-downloaded on `npm install` (Linux default) | Lightweight, fully offline |
| `whisper` | Model (~40MB `tiny.en` by default) downloads automatically the first time you actually use it, then caches offline | Best accuracy, any platform, heavier on CPU |

Want a bigger/more accurate Vosk model than the small default? Download one from https://alphacephei.com/vosk/models and point `voskModelPath` in the config (§6) at it — your override always wins over the auto-downloaded one.

---

## 4. First Run — Fully Automated

```bash
beckon start
```

or just:
```bash
beckon
```

**This does everything for you, in order:**

1. Checks if the Claude Code CLI is installed (`claude --version`). If not, runs the official native installer for your OS automatically (`https://claude.ai/install.ps1` on Windows, `https://claude.ai/install.sh` on Linux). If that just ran for the first time, it'll ask you to open a new terminal (so `claude` is on your PATH) and run `beckon start` again — that's a one-time thing.
2. Checks if the **`assistant`** Claude Code skill is installed. If not, adds the Spyder marketplace and installs it automatically (`claude plugin marketplace add masterdeepak15/Spyder` + `claude plugin install assistant@spyder`) — safe to run repeatedly, won't duplicate or error if already present.
3. Checks if onboarding has actually happened (i.e. you've named your assistant). **This one step can't be automated** — naming your assistant is a real conversation, not something a script can fill in for you. If it hasn't happened yet, Beckon tells you to open a terminal, run `claude`, and just say hi; onboarding kicks in on its own.
4. Once all three are green, launches the tray app.

Run the checks on their own anytime, without launching the app, with:
```bash
beckon setup
```

**Test it:** once running, say your assistant's name followed by a request — "Maya, what's today's date." You should see the tray icon animate (pulsing green = listening for your command, spinning blue = working), then a notification with the response.

---

## 5. Full Command Reference

| Command | What it does |
|---|---|
| `beckon` / `beckon start` | Checks readiness (Claude Code installed, `assistant` skill installed, onboarding done), auto-fixes what it can, then launches the tray app |
| `beckon setup` | Runs just the readiness check/auto-fix above, without launching the app afterward |
| `beckon install-service` | Register Beckon to auto-start on login (Task Scheduler on Windows, `systemd --user` on Linux) |
| `beckon uninstall-service` | Remove that auto-start registration |
| `beckon service-status` | Check whether auto-start is currently registered/running |
| `beckon install-hooks` | Wire up realtime Claude Code HTTP hooks — see §7 |
| `beckon uninstall-hooks` | Remove those hooks (leaves any other hooks you have untouched) |
| `beckon generate-icons` | Regenerate the tray icon PNGs (only needed if you edit `assets/generate-icons.js`) |
| `beckon --help` | Show command summary |

**Recommended first-time flow:**
```bash
beckon start              # confirm mic + wake word actually work
# ... Ctrl+C once you're happy ...
beckon install-service    # now let it run automatically in the background
beckon install-hooks      # optional — see §7 for what this gives you
```

---

## 6. Configuration — `~/.assistant/beckon.config.json`

Created automatically on first run. Edit it directly, or change most of it from the tray menu.

```json
{
  "commandWindowMs": 6000,
  "extraWakePhrases": ["hi", "hi there", "hey"],
  "workingDirectory": "/home/you",
  "sttProvider": "vosk",
  "whisperModel": "Xenova/whisper-tiny.en",
  "voskModelPath": "",
  "ttsEnabled": false,
  "ttsVoice": "",
  "claudeBin": "claude",
  "hookServerPort": 8765,
  "hooksInstalled": false
}
```

| Key | What it controls |
|---|---|
| `commandWindowMs` | How long (ms) Beckon waits for you to speak a command after the wake word before giving up — no command means no Claude call at all |
| `extraWakePhrases` | Words that wake Beckon besides your assistant's name. ⚠️ Generic words like `"hi"`/`"hey"` **will** false-trigger on normal background conversation — trim this list if that's annoying |
| `workingDirectory` | Where Claude Code runs for voice-triggered commands. Point it at a specific project if you mostly want voice control there |
| `sttProvider` | `"sapi"` \| `"vosk"` \| `"whisper"` — see §3 |
| `whisperModel` | Which Whisper model size to use (only relevant if `sttProvider` is `"whisper"`) |
| `voskModelPath` | Path to your downloaded Vosk model folder (only relevant if `sttProvider` is `"vosk"`) |
| `ttsEnabled` | Speak responses back out loud (OS-native TTS, no cloud) |
| `ttsVoice` | Specific voice name, if you have more than one installed. Empty = system default |
| `claudeBin` | Override if `claude` isn't on PATH or you want a specific binary |
| `hookServerPort` | Local port for the hooks integration (§7) — change if 8765 is taken |
| `hooksInstalled` | Informational flag, set automatically by `install-hooks`/`uninstall-hooks` |

---

## 7. Realtime Hooks (Optional)

`beckon install-hooks` wires Beckon into Claude Code's native hooks system so the tray becomes aware of **any** Claude Code session on your machine — not just voice-triggered ones. If you're heads-down in a manual terminal session and Claude needs your permission for something, the tray can still notify you.

**What it does, concretely:** merges entries into `~/.claude/settings.json` for the `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, and `Stop` events, each pointing at `http://127.0.0.1:<port>/hook/<EventName>` — a tiny local server Beckon runs. Nothing leaves your machine.

**Safety:**
- Takes a timestamped backup of your existing `settings.json` before touching it
- Only ever adds/removes its own entries — any other hooks you've configured (linters, formatters, custom scripts) are left completely alone
- Safe to run more than once (idempotent, won't duplicate entries)
- `beckon uninstall-hooks` cleanly removes only what it added

**After installing or removing hooks**, restart any Claude Code sessions you have open (or run `/hooks` inside one to verify) for the change to take effect.

---

## 8. Uninstalling

```bash
beckon uninstall-service     # stop auto-start
beckon uninstall-hooks       # remove hooks, if installed
npm uninstall -g @masterdeepak15/beckon
```

Your assistant's memory (`~/.assistant/`) is untouched by any of this — that belongs to the `assistant` Claude Code skill, not Beckon, and isn't deleted by uninstalling Beckon.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `~/.assistant/ doesn't exist yet` on startup | Run the `assistant` Claude Code skill's onboarding first (any normal Claude Code conversation triggers it) |
| Wake word never triggers | On Linux, confirm the Vosk model actually downloaded (`ls` the `models/` folder inside the installed package, or check the `npm install` output for download errors — offline installs skip this step); try `beckon start` in the foreground to see console errors |
| Tray icon doesn't appear (Linux) | Some desktop environments (notably plain GNOME) need a tray/AppIndicator extension installed — this is a DE limitation, not a Beckon bug |
| "Voice engine isn't ready" dialog | Rare now that the packages install automatically — usually means the Vosk model download failed during `npm install` (no internet at install time?). Run `beckon setup`, or switch engines from the tray menu |
| Claude Code exits with a nonzero code / bridge errors | Confirm `claude --help` still supports `-p`, `-c`, `--output-format stream-json` — flags can change between Claude Code releases; adjust `claudeBin`/check `daemon/claude-bridge.js` if they have |
| Hooks don't seem to fire | Restart your Claude Code session after `install-hooks`; confirm nothing else is using port 8765 (`hookServerPort` in config) |
| False wake-word triggers from background noise/TV | Trim `extraWakePhrases` down to just your assistant's actual name in the config |

For anything else, check the console output from `beckon start` (run in the foreground, not as a service) — that's where the real error messages show up.
