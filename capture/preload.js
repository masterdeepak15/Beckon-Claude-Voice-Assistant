'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit bridge — the capture renderer can only send audio
// chunks and utterance-end signals, nothing else is exposed.
contextBridge.exposeInMainWorld('captureAPI', {
  sendChunk: (arrayBuffer) => ipcRenderer.send('audio-chunk', arrayBuffer),
  sendUtteranceEnd: () => ipcRenderer.send('audio-utterance-end'),
  reportError: (message) => ipcRenderer.send('capture-error', message)
});
