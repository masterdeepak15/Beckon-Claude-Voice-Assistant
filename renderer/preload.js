'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupAPI', {
  onUpdate: (callback) => ipcRenderer.on('popup-update', (_event, data) => callback(data))
});
