'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const MEMORY_ROOT = path.join(HOME, '.assistant');
const IDENTITY_FILE = path.join(MEMORY_ROOT, 'IDENTITY.md');
const BECKON_CONFIG_FILE = path.join(MEMORY_ROOT, 'beckon.config.json');
const CLAUDE_SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');

const DEFAULT_CONFIG = {
  // How long (ms) to keep buffering audio for a command after the wake word,
  // before giving up and returning to idle WITHOUT calling Claude.
  commandWindowMs: 6000,
  // Extra wake phrases besides the assistant's own name (from IDENTITY.md).
  // Heads up: generic words like "hi"/"hey" will false-trigger on ambient speech.
  extraWakePhrases: ['hi', 'hi there', 'hey'],
  // Working directory Claude Code runs in for voice-triggered sessions.
  workingDirectory: HOME,
  // "whisper" | "vosk" | "sapi" (sapi = Windows built-in, no setup, no model download)
  sttProvider: process.platform === 'win32' ? 'sapi' : 'vosk',
  // Whisper model size, only used when sttProvider is "whisper".
  // Options (accuracy vs speed/RAM): tiny.en, base.en, small.en, tiny, base, small (multilingual)
  whisperModel: 'Xenova/whisper-tiny.en',
  // Path to a Vosk model folder, only used when sttProvider is "vosk". Falls back to VOSK_MODEL_PATH env var.
  voskModelPath: process.env.VOSK_MODEL_PATH || '',
  // Speak responses back using OS-native TTS. Off by default.
  ttsEnabled: false,
  // TTS voice name, if the OS has more than one installed. Empty = system default.
  ttsVoice: '',
  // Claude Code CLI binary name/path.
  claudeBin: 'claude',
  // Local HTTP server port that receives Claude Code HTTP hooks (see daemon/hook-server.js).
  hookServerPort: 8765,
  // Whether `beckon install-hooks` has been run — informational only.
  hooksInstalled: false
};

function readAssistantName() {
  if (!fs.existsSync(IDENTITY_FILE)) return null;
  const text = fs.readFileSync(IDENTITY_FILE, 'utf8');
  const match = text.match(/##\s*Assistant Persona[\s\S]*?Name:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function loadConfig() {
  let userConfig = {};
  if (fs.existsSync(BECKON_CONFIG_FILE)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(BECKON_CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error(`[config] Failed to parse ${BECKON_CONFIG_FILE}: ${e.message}`);
    }
  }
  return { ...DEFAULT_CONFIG, ...userConfig };
}

function saveConfig(partial) {
  const current = loadConfig();
  const next = { ...current, ...partial };
  if (!fs.existsSync(MEMORY_ROOT)) fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  fs.writeFileSync(BECKON_CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function ensureMemoryRootExists() {
  if (!fs.existsSync(MEMORY_ROOT)) {
    throw new Error(
      "~/.assistant/ doesn't exist yet. Complete onboarding with the 'assistant' " +
      'Claude Code skill first (any normal conversation triggers it).'
    );
  }
  if (!fs.existsSync(BECKON_CONFIG_FILE)) saveConfig({});
}

function getWakePhrases() {
  const name = readAssistantName();
  const config = loadConfig();
  const phrases = [...config.extraWakePhrases];
  if (name) phrases.unshift(name);
  return [...new Set(phrases.map((p) => p.toLowerCase().trim()))].sort(
    (a, b) => b.length - a.length
  );
}

module.exports = {
  HOME,
  MEMORY_ROOT,
  IDENTITY_FILE,
  BECKON_CONFIG_FILE,
  CLAUDE_SETTINGS_FILE,
  DEFAULT_CONFIG,
  readAssistantName,
  loadConfig,
  saveConfig,
  ensureMemoryRootExists,
  getWakePhrases
};
