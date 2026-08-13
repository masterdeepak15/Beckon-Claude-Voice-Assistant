'use strict';

/**
 * FED provider — consumes Int16 PCM chunks + an utterance-end signal from
 * the Electron capture renderer's RMS-based VAD (whisper isn't streaming,
 * so we buffer a whole utterance and transcribe it in one shot when the
 * renderer says speech stopped).
 *
 * Runs fully locally via @xenova/transformers (ONNX runtime) — no cloud
 * calls, no API key. First use downloads the model (~40-150MB depending
 * on size) from Hugging Face and caches it; after that it's fully offline.
 */
function createWhisperProvider({ modelName, sampleRate, onUtterance }) {
  let pipelinePromise = null;
  let chunks = [];

  function int16ToFloat32(int16Buffer) {
    const int16 = new Int16Array(int16Buffer.buffer, int16Buffer.byteOffset, int16Buffer.length / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    return float32;
  }

  function getPipeline() {
    if (!pipelinePromise) {
      let transformers;
      try {
        transformers = require('@xenova/transformers');
      } catch (e) {
        throw new Error(
          "The '@xenova/transformers' package isn't installed. Run: npm install @xenova/transformers"
        );
      }
      pipelinePromise = transformers.pipeline('automatic-speech-recognition', modelName || 'Xenova/whisper-tiny.en');
    }
    return pipelinePromise;
  }

  return {
    selfContained: false,

    feedChunk(int16Buffer) {
      chunks.push(int16ToFloat32(int16Buffer));
    },

    // Called by main.js when the capture renderer's VAD signals silence
    // after speech — this is where whisper actually runs inference.
    async finalizeUtterance() {
      if (chunks.length === 0) return;
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      chunks = [];

      try {
        const transcriber = await getPipeline();
        const result = await transcriber(merged, { sampling_rate: sampleRate || 16000 });
        if (result && result.text && result.text.trim()) onUtterance(result.text.trim());
      } catch (err) {
        console.error('[whisper] transcription failed:', err.message);
      }
    },

    stop() {
      chunks = [];
    }
  };
}

module.exports = { createWhisperProvider };
