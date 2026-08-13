#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const PACKAGE_ROOT = path.join(__dirname, '..');
const command = process.argv[2] || 'start';

function printHelp() {
  console.log(`
Beckon — hands-free voice front-end for Claude Code

Usage:
  beckon                    Launch the tray app (same as 'beckon start')
  beckon start               Launch the tray app in the foreground
  beckon install-service     Start Beckon automatically on login
  beckon uninstall-service   Remove the auto-start entry
  beckon service-status      Check if auto-start is registered
  beckon install-hooks       Wire up realtime Claude Code hooks (see CLI.md)
  beckon uninstall-hooks     Remove those hooks (leaves your other hooks alone)
  beckon generate-icons      Regenerate tray icon assets
  beckon --help              Show this message

Full documentation: CLI.md in the package root, or the GitHub repo.
`);
}

function launchTrayApp() {
  // Prefer the locally installed electron binary (works whether this
  // package was installed globally or as a project dependency).
  let electronPath;
  try {
    electronPath = require('electron');
  } catch (e) {
    console.error(
      "Electron isn't installed. Run: npm install electron --no-save\n" +
      "(it's an optionalDependency so platforms without a GUI can skip it)"
    );
    process.exit(1);
  }

  const child = spawn(electronPath, [PACKAGE_ROOT], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code === null ? 0 : code));
}

switch (command) {
  case 'start':
    launchTrayApp();
    break;

  case 'install-service': {
    const mod = process.platform === 'win32' ? './service/windows' : './service/linux';
    require(path.join(PACKAGE_ROOT, 'daemon', mod.slice(2))).install();
    break;
  }
  case 'uninstall-service': {
    const mod = process.platform === 'win32' ? './service/windows' : './service/linux';
    require(path.join(PACKAGE_ROOT, 'daemon', mod.slice(2))).uninstall();
    break;
  }
  case 'service-status': {
    const mod = process.platform === 'win32' ? './service/windows' : './service/linux';
    require(path.join(PACKAGE_ROOT, 'daemon', mod.slice(2))).status();
    break;
  }

  case 'install-hooks':
    require(path.join(PACKAGE_ROOT, 'daemon', 'install-hooks')).installHooks();
    break;
  case 'uninstall-hooks':
    require(path.join(PACKAGE_ROOT, 'daemon', 'install-hooks')).uninstallHooks();
    break;

  case 'generate-icons':
    require(path.join(PACKAGE_ROOT, 'assets', 'generate-icons'));
    break;

  case '--help':
  case '-h':
  case 'help':
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
