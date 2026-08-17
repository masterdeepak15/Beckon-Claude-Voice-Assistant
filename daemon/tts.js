'use strict';
const { spawn } = require('child_process');

// Tracks whatever's currently speaking so a new speak() call or an explicit
// stop() can interrupt it — needed for barge-in (user starts talking again
// while the assistant is still replying out loud).
let currentProc = null;

/** Kills whatever's currently speaking, if anything. Safe to call anytime. */
function stop() {
  if (currentProc && !currentProc.killed) {
    try { currentProc.kill(); } catch (e) { /* already exited — fine */ }
  }
  currentProc = null;
}

/**
 * OS-native TTS, no cloud calls. `voiceName` is best-effort — if it doesn't
 * match an installed voice, falls back to the system default silently.
 * Automatically interrupts any speech already in progress, since new speech
 * (a fresh reply, or the user barging in) should always take over rather
 * than queue behind stale audio.
 */
function speak(text, voiceName) {
  stop(); // never let two replies talk over each other
  const clean = text.replace(/"/g, "'").slice(0, 500);

  if (process.platform === 'win32') {
    const voiceSelect = voiceName
      ? `try { $s.SelectVoice("${voiceName}") } catch {}; `
      : '';
    const psCmd = `Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceSelect}` +
      `$s.Speak("${clean}")`;
    currentProc = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
    currentProc.on('exit', () => { currentProc = null; });
    return;
  }

  if (process.platform === 'linux') {
    const args = voiceName ? ['-o', voiceName, clean] : [clean];
    const spd = spawn('spd-say', args);
    currentProc = spd;
    spd.on('error', () => {
      const espeakArgs = voiceName ? ['-v', voiceName, clean] : [clean];
      const es = spawn('espeak', espeakArgs);
      currentProc = es;
      es.on('error', () => {
        console.error('[tts] No TTS engine found (tried spd-say, espeak).');
        currentProc = null;
      });
    });
  }
}

/** Best-effort voice listing for the tray's "Voice Replies" submenu. */
function listVoices() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const psCmd = `Add-Type -AssemblyName System.Speech; ` +
        `(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ` +
        `ForEach-Object { $_.VoiceInfo.Name }`;
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
      let out = '';
      ps.stdout.on('data', (d) => (out += d.toString()));
      ps.on('close', () => resolve(out.split('\n').map((l) => l.trim()).filter(Boolean)));
      ps.on('error', () => resolve([]));
      return;
    }
    if (process.platform === 'linux') {
      const espeak = spawn('espeak', ['--voices']);
      let out = '';
      espeak.stdout.on('data', (d) => (out += d.toString()));
      espeak.on('close', () => {
        const names = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[3]).filter(Boolean);
        resolve(names);
      });
      espeak.on('error', () => resolve([]));
      return;
    }
    resolve([]);
  });
}

module.exports = { speak, stop, listVoices };
