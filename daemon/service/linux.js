'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UNIT_NAME = 'beckon.service';
const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const UNIT_PATH = path.join(UNIT_DIR, UNIT_NAME);
const PACKAGE_ROOT = path.join(__dirname, '..', '..');

function install() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch (e) {
    console.error("Electron isn't ready. Run 'beckon setup' first — it'll diagnose and try to repair this automatically.");
    return;
  }

  const unit = `[Unit]
Description=Beckon (Claude Code voice assistant)
After=graphical-session.target

[Service]
ExecStart=${electronPath} ${PACKAGE_ROOT}
Restart=on-failure
Environment=DISPLAY=:0
Environment=VOSK_MODEL_PATH=${process.env.VOSK_MODEL_PATH || ''}

[Install]
WantedBy=graphical-session.target
`;

  fs.mkdirSync(UNIT_DIR, { recursive: true });
  fs.writeFileSync(UNIT_PATH, unit, 'utf8');

  try {
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync(`systemctl --user enable --now ${UNIT_NAME}`, { stdio: 'inherit' });
    console.log(`\nInstalled and started. Beckon will also start automatically on login.`);
    console.log(`Logs: journalctl --user -u ${UNIT_NAME} -f`);
  } catch (err) {
    console.error('systemctl failed — is systemd user mode available on this system?');
  }
}

function uninstall() {
  try {
    execSync(`systemctl --user disable --now ${UNIT_NAME}`, { stdio: 'inherit' });
    fs.unlinkSync(UNIT_PATH);
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    console.log('Removed.');
  } catch (err) {
    console.error('Failed to remove (it may not be installed).');
  }
}

function status() {
  try {
    execSync(`systemctl --user status ${UNIT_NAME}`, { stdio: 'inherit' });
  } catch (err) {
    console.log('Not installed or not running. Run: beckon install-service');
  }
}

module.exports = { install, uninstall, status };
