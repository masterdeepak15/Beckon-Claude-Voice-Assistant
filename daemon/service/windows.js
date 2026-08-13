'use strict';
const { execSync } = require('child_process');
const path = require('path');

const TASK_NAME = 'BeckonVoiceAssistant';
const PACKAGE_ROOT = path.join(__dirname, '..', '..');

function install() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch (e) {
    console.error("Electron isn't installed — run 'npm install electron --no-save' first.");
    return;
  }

  const cmd = `schtasks /Create /TN "${TASK_NAME}" /TR "\\"${electronPath}\\" \\"${PACKAGE_ROOT}\\"" /SC ONLOGON /RL LIMITED /F`;
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`\nInstalled. Beckon will start automatically next time you log in.`);
    console.log(`To start it right now: schtasks /Run /TN "${TASK_NAME}"`);
  } catch (err) {
    console.error('Failed to register scheduled task. Try running this terminal as Administrator.');
  }
}

function uninstall() {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'inherit' });
    console.log('Removed.');
  } catch (err) {
    console.error('Failed to remove scheduled task (it may not be installed).');
  }
}

function status() {
  try {
    execSync(`schtasks /Query /TN "${TASK_NAME}"`, { stdio: 'inherit' });
  } catch (err) {
    console.log('Not installed. Run: beckon install-service');
  }
}

module.exports = { install, uninstall, status };
