'use strict';
const fs = require('fs');
const path = require('path');
const { CLAUDE_SETTINGS_FILE, loadConfig, saveConfig } = require('./config');

// The core lifecycle events worth surfacing on the tray. See README for the
// full 20+ event list Claude Code supports — these six cover the common cases.
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];

function buildHookEntry(port, eventName) {
  return {
    matcher: '',
    hooks: [
      {
        type: 'http',
        url: `http://127.0.0.1:${port}/hook/${eventName}`,
        timeout: 3
      }
    ]
  };
}

/**
 * Merges beckon's hook entries into ~/.claude/settings.json WITHOUT
 * touching any hooks the user already has configured for other tools. Takes
 * a timestamped backup before writing. Idempotent — safe to run again.
 */
function installHooks() {
  const config = loadConfig();
  const port = config.hookServerPort;

  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `${CLAUDE_SETTINGS_FILE} exists but isn't valid JSON — fix it manually before running this.`
      );
    }
    const backupPath = `${CLAUDE_SETTINGS_FILE}.beckon-backup-${Date.now()}.json`;
    fs.writeFileSync(backupPath, raw);
    console.log(`Backed up existing settings to ${backupPath}`);
  } else {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_FILE), { recursive: true });
  }

  if (!settings.hooks) settings.hooks = {};

  for (const eventName of EVENTS) {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];

    const alreadyPresent = settings.hooks[eventName].some((entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h.type === 'http' && h.url === `http://127.0.0.1:${port}/hook/${eventName}`)
    );

    if (!alreadyPresent) {
      settings.hooks[eventName].push(buildHookEntry(port, eventName));
    }
  }

  fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  saveConfig({ hooksInstalled: true });

  console.log(`\nInstalled HTTP hooks for: ${EVENTS.join(', ')}`);
  console.log(`Pointing at: http://127.0.0.1:${port}/hook/<EventName>`);
  console.log(`\nHeads up: these hooks now fire for EVERY Claude Code session on this`);
  console.log(`machine, not just ones the tray launches — that's what makes the tray`);
  console.log(`aware of, e.g., a permission prompt in a manual terminal session.`);
  console.log(`Everything stays local (127.0.0.1) — nothing leaves your machine.\n`);
  console.log(`Restart any running Claude Code sessions (or type /hooks to verify)`);
  console.log(`for the new hooks to take effect.`);
}

function uninstallHooks() {
  const config = loadConfig();
  const port = config.hookServerPort;

  if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) {
    console.log('No settings.json found — nothing to remove.');
    return;
  }

  const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf8'));
  if (!settings.hooks) {
    console.log('No hooks configured — nothing to remove.');
    return;
  }

  for (const eventName of EVENTS) {
    if (!Array.isArray(settings.hooks[eventName])) continue;
    settings.hooks[eventName] = settings.hooks[eventName].filter((entry) => {
      if (!Array.isArray(entry.hooks)) return true;
      return !entry.hooks.some((h) => h.type === 'http' && h.url === `http://127.0.0.1:${port}/hook/${eventName}`);
    });
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }

  fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  saveConfig({ hooksInstalled: false });
  console.log('Removed beckon hooks. Other hooks were left untouched.');
}

module.exports = { installHooks, uninstallHooks, EVENTS };
