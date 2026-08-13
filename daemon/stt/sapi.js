'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PS_SCRIPT = `
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$rec.SetInputToDefaultAudioDevice()
$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -Action {
    $text = $EventArgs.Result.Text
    if ($text) { Write-Output $text }
} | Out-Null
$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
Write-Output "__READY__"
while ($true) { Start-Sleep -Milliseconds 500 }
`;

/**
 * SELF-CONTAINED provider — unlike whisper/vosk, this does NOT consume PCM
 * chunks from the Electron capture renderer. Windows' own SAPI engine does
 * its own mic capture + VAD + STT. main.js should skip creating the capture
 * window entirely when this provider is selected.
 */
function createSapiProvider({ onUtterance, onReady }) {
  const scriptPath = path.join(os.tmpdir(), 'beckon-sapi-listener.ps1');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');

  const ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true }
  );

  let buffer = '';
  ps.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      if (line === '__READY__') { if (onReady) onReady(); continue; }
      onUtterance(line);
    }
  });

  ps.stderr.on('data', (chunk) => console.error('[sapi]', chunk.toString().trim()));
  ps.on('exit', (code) => console.error(`[sapi] listener exited (code ${code}).`));

  return { selfContained: true, stop: () => ps.kill() };
}

module.exports = { createSapiProvider };
