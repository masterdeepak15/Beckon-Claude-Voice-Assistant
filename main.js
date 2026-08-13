'use strict';
const { app, Tray, Menu, BrowserWindow, ipcMain, Notification, shell, screen, dialog } = require('electron');
const path = require('path');

const config = require('./daemon/config');
const { AssistantCore } = require('./daemon/core');
const { startHookServer } = require('./daemon/hook-server');

let tray = null;
let popupWindow = null;
let captureWindow = null;
let hookServer = null;
let core = null;
let sttProvider = null;
let iconTimer = null;

const ICON_FRAMES = {
  idle: ['tray-idle.png'],
  awake: ['tray-listening-1.png', 'tray-listening-2.png'],
  processing: ['tray-processing-1.png', 'tray-processing-2.png', 'tray-processing-3.png'],
  paused: ['tray-paused.png']
};
let frameIndex = 0;

function iconPath(file) {
  return path.join(__dirname, 'assets', file);
}

function setTrayAnimation(state) {
  if (iconTimer) clearInterval(iconTimer);
  const frames = ICON_FRAMES[state] || ICON_FRAMES.idle;
  frameIndex = 0;
  tray.setImage(iconPath(frames[0]));
  if (frames.length > 1) {
    iconTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      tray.setImage(iconPath(frames[frameIndex]));
    }, 450);
  }
}

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 300,
    height: 64,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  popupWindow.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
  positionPopupNearTray();
}

function positionPopupNearTray() {
  if (!popupWindow) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { width, height } = popupWindow.getBounds();

  // Windows: tray is bottom-right, popup goes above it.
  // Linux (varies by DE): best-effort — corner nearest the tray icon.
  let x = Math.round(trayBounds.x - width / 2);
  let y = trayBounds.y > display.workArea.height / 2
    ? trayBounds.y - height - 8   // tray near bottom → popup above
    : trayBounds.y + trayBounds.height + 8; // tray near top → popup below

  x = Math.max(display.workArea.x, Math.min(x, display.workArea.x + display.workArea.width - width));
  popupWindow.setBounds({ x, y, width, height });
}

function showPopup(state, meta) {
  if (!popupWindow) return;
  const name = config.readAssistantName() || 'Assistant';
  const captionText =
    (meta && meta.tool && `Using: ${meta.tool}`) ||
    (meta && meta.captionText) ||
    '';
  popupWindow.webContents.send('popup-update', { state, name, captionText });

  if (state === 'idle') {
    // brief delay so a quick idle flicker doesn't hide-then-reshow jarringly
    setTimeout(() => { if (core.state === 'idle') popupWindow.hide(); }, 1500);
  } else {
    positionPopupNearTray();
    popupWindow.showInactive(); // never steal focus from whatever the user's doing
  }
}

function createCaptureWindowIfNeeded(cfg) {
  if (cfg.sttProvider === 'sapi') return; // SAPI does its own capture, no renderer needed
  captureWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'capture', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  captureWindow.loadFile(path.join(__dirname, 'capture', 'capture.html'));
}

function createSttProvider(cfg, onUtterance, onReady) {
  if (cfg.sttProvider === 'sapi') {
    const { createSapiProvider } = require('./daemon/stt/sapi');
    return createSapiProvider({ onUtterance, onReady });
  }
  if (cfg.sttProvider === 'whisper') {
    const { createWhisperProvider } = require('./daemon/stt/whisper');
    return createWhisperProvider({ modelName: cfg.whisperModel, sampleRate: 16000, onUtterance });
  }
  const { createVoskProvider } = require('./daemon/stt/vosk');
  return createVoskProvider({ modelPath: cfg.voskModelPath, sampleRate: 16000, onUtterance });
}

function buildTrayMenu() {
  const cfg = config.loadConfig();
  const paused = core.state === 'paused';

  const voiceEngineSubmenu = ['sapi', 'vosk', 'whisper'].map((id) => ({
    label: { sapi: 'Windows Speech (SAPI)', vosk: 'Vosk (offline, lightweight)', whisper: 'Whisper (offline, most accurate)' }[id],
    type: 'radio',
    checked: cfg.sttProvider === id,
    click: () => {
      config.saveConfig({ sttProvider: id });
      promptRestart(`Voice engine changed to ${id}.`);
    }
  }));

  return Menu.buildFromTemplate([
    { label: `Status: ${core.state}${paused ? ' (Hold)' : ''}`, enabled: false },
    { type: 'separator' },
    {
      label: paused ? 'Resume Listening' : 'Hold (Pause Listening)',
      click: () => { paused ? core.resume() : core.pause(); refreshTray(); }
    },
    {
      label: 'Push to Talk...',
      click: () => core.setState('awake', { manual: true })
    },
    { type: 'separator' },
    { label: 'Voice Engine', submenu: voiceEngineSubmenu },
    {
      label: cfg.ttsEnabled ? 'Voice Replies: On' : 'Voice Replies: Off',
      type: 'checkbox',
      checked: cfg.ttsEnabled,
      click: () => config.saveConfig({ ttsEnabled: !cfg.ttsEnabled })
    },
    { type: 'separator' },
    {
      label: cfg.hooksInstalled ? 'Realtime Hooks: Installed ✓' : 'Install Realtime Hooks...',
      click: () => {
        const { installHooks } = require('./daemon/install-hooks');
        try {
          installHooks();
          dialog.showMessageBox({ message: 'Hooks installed. Restart any open Claude Code sessions to pick them up.' });
        } catch (e) {
          dialog.showErrorBox('Failed to install hooks', e.message);
        }
        refreshTray();
      }
    },
    { label: 'Open Memory Folder', click: () => shell.openPath(config.MEMORY_ROOT) },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ]);
}

function refreshTray() {
  tray.setContextMenu(buildTrayMenu());
  setTrayAnimation(core.state === 'paused' ? 'paused' : core.state);
}

function promptRestart(message) {
  const { response } = dialog.showMessageBoxSync({
    message: `${message} Restart beckon now to apply it?`,
    buttons: ['Restart Now', 'Later']
  });
  if (response === 0) { app.relaunch(); app.exit(0); }
}

function wireCoreEvents() {
  core.on('state', (state, meta) => { setTrayAnimation(state === 'paused' ? 'paused' : state); showPopup(state, meta); refreshTray(); });
  core.on('claude-tool', (tool) => showPopup('processing', { tool: tool.name }));
  core.on('claude-text', () => {}); // could stream into the popup caption; kept minimal here
  core.on('notify', ({ title, body }) => new Notification({ title, body }).show());
  core.on('done', (fullText) => {
    const firstLine = (fullText || '').split('\n').find((l) => l.trim());
    if (firstLine) new Notification({ title: config.readAssistantName() || 'Assistant', body: firstLine.slice(0, 200) }).show();
    const cfg = config.loadConfig();
    if (cfg.ttsEnabled && firstLine) require('./daemon/tts').speak(firstLine, cfg.ttsVoice);
  });
  core.on('error', (err) => new Notification({ title: 'Assistant error', body: err.message }).show());
  core.on('hook-event', ({ event }) => {
    // Realtime signal from ANY Claude Code session on the machine — surface
    // lightweight activity in the popup without treating it as our own cycle.
    if (['PreToolUse', 'PostToolUse'].includes(event)) showPopup('processing', { captionText: `External session: ${event}` });
  });
}

app.whenReady().then(() => {
  config.ensureMemoryRootExists();
  const cfg = config.loadConfig();
  const wakePhrases = config.getWakePhrases();

  core = new AssistantCore({ config: cfg, wakePhrases });

  tray = new Tray(iconPath('tray-idle.png'));
  tray.setToolTip(`${config.readAssistantName() || 'Beckon'} — click for options`);

  createPopupWindow();
  createCaptureWindowIfNeeded(cfg);
  wireCoreEvents();
  refreshTray();

  hookServer = startHookServer({
    port: cfg.hookServerPort,
    onHookEvent: (eventName, payload) => core.handleHookEvent(eventName, payload)
  });

  sttProvider = null;
  try {
    sttProvider = createSttProvider(
      cfg,
      (text) => core.handleUtterance(text),
      () => console.log('[beckon] STT provider ready.')
    );
  } catch (err) {
    console.error('[beckon] STT provider unavailable:', err.message);
    dialog.showErrorBox(
      `Voice engine "${cfg.sttProvider}" isn't ready`,
      `${err.message}\n\nThe tray is still running — fix this and pick "Voice Engine" ` +
      `from the tray menu once it's ready, or switch to a different engine now.`
    );
  }

  ipcMain.on('audio-chunk', (_event, arrayBuffer) => {
    if (sttProvider && sttProvider.feedChunk) sttProvider.feedChunk(Buffer.from(arrayBuffer));
  });
  ipcMain.on('audio-utterance-end', () => {
    if (sttProvider && sttProvider.finalizeUtterance) sttProvider.finalizeUtterance();
  });
  ipcMain.on('capture-error', (_event, message) => {
    new Notification({ title: 'Microphone error', body: message }).show();
  });

  tray.on('click', () => showPopup(core.state, {}));
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in the tray
app.on('before-quit', () => {
  if (hookServer) hookServer.stop();
  if (sttProvider && sttProvider.stop) sttProvider.stop();
});
