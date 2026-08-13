'use strict';

/**
 * FED provider — consumes Int16 PCM chunks pushed from the Electron capture
 * renderer (via IPC, see capture/capture.html + main.js wiring). Vosk does
 * its own internal utterance-boundary detection: acceptWaveform() returns
 * true exactly when a phrase finalizes, so we don't need the renderer's
 * separate VAD signal for this provider — every chunk just gets fed in.
 */
function createVoskProvider({ modelPath, sampleRate, onUtterance }) {
  let vosk;
  try {
    vosk = require('vosk');
  } catch (e) {
    throw new Error(
      "The 'vosk' package isn't installed. Run: npm install vosk\n" +
      'Then download a model from https://alphacephei.com/vosk/models and set voskModelPath in tray.config.json.'
    );
  }
  if (!modelPath) {
    throw new Error(
      'No Vosk model path configured. Download a small model from ' +
      'https://alphacephei.com/vosk/models, unzip it, and set voskModelPath ' +
      '(or VOSK_MODEL_PATH env var) — see README.md.'
    );
  }

  vosk.setLogLevel(-1);
  const model = new vosk.Model(modelPath);
  const recognizer = new vosk.Recognizer({ model, sampleRate: sampleRate || 16000 });

  return {
    selfContained: false,
    feedChunk(int16Buffer) {
      if (recognizer.acceptWaveform(int16Buffer)) {
        const result = recognizer.result();
        if (result && result.text) onUtterance(result.text);
      }
    },
    // No-op: vosk finalizes on its own via acceptWaveform above, it doesn't
    // need the renderer's separate silence-based utterance-end signal.
    finalizeUtterance() {},
    stop() {
      recognizer.free();
      model.free();
    }
  };
}

module.exports = { createVoskProvider };
