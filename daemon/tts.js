'use strict';
const { spawn } = require('child_process');

/**
 * OS-native TTS, no cloud calls. `voiceName` is best-effort — if it doesn't
 * match an installed voice, falls back to the system default silently.
 */
function speak(text, voiceName) {
  const clean = text.replace(/"/g, "'").slice(0, 500);

  if (process.platform === 'win32') {
    const voiceSelect = voiceName
      ? `try { $s.SelectVoice("${voiceName}") } catch {}; `
      : '';
    const psCmd = `Add-Type -AssemblyName System.Speech; ` +
      `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceSelect}` +
      `$s.Speak("${clean}")`;
    spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
    return;
  }

  if (process.platform === 'linux') {
    const args = voiceName ? ['-o', voiceName, clean] : [clean];
    const spd = spawn('spd-say', args);
    spd.on('error', () => {
      const espeakArgs = voiceName ? ['-v', voiceName, clean] : [clean];
      spawn('espeak', espeakArgs).on('error', () => {
        console.error('[tts] No TTS engine found (tried spd-say, espeak).');
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

module.exports = { speak, listVoices };
