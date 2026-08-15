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
  beckon                     Check readiness, then launch the tray app
  beckon start                Same as above — checks Claude Code + the
                               'assistant' skill are ready first, auto-fixes
                               what it can, then launches
  beckon setup                 Run just the readiness check/auto-fix, without
                               launching the tray app afterward
  beckon install-service      Start Beckon automatically on login
  beckon uninstall-service    Remove the auto-start entry
  beckon service-status       Check if auto-start is registered
  beckon install-hooks        Wire up realtime Claude Code hooks (see CLI.md)
  beckon uninstall-hooks      Remove those hooks (leaves your other hooks alone)
  beckon generate-icons       Regenerate tray icon assets
  beckon --help                Show this message

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
    // This is a fallback safety net — `beckon start` normally catches and
    // repairs this via daemon/setup.js's electron check before ever
    // reaching here. Seeing this directly usually means `beckon` was
    // invoked in some other way that skipped the setup check.
    console.error(
      "Electron (the GUI runtime — compulsory, not optional) isn't ready.\n" +
      "Run 'beckon setup' to diagnose and attempt an automatic repair.\n" +
      `Raw error: ${e.message}`
    );
    process.exit(1);
  }

  const child = spawn(electronPath, [PACKAGE_ROOT], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code === null ? 0 : code));
}

async function startWithSetupCheck() {
  const { runSetup } = require(path.join(PACKAGE_ROOT, 'daemon', 'setup'));
  const result = await runSetup({ verbose: true });
  if (!result.ready) {
    console.log("\nNot launching yet — fix the above, then run 'beckon start' again.");
    process.exit(1);
  }
  launchTrayApp();
}

function requireServiceModule() {
  const mod = process.platform === 'win32' ? 'windows' : 'linux';
  return require(path.join(PACKAGE_ROOT, 'daemon', 'service', mod));
}

async function main() {
  switch (command) {
    case 'start':
      await startWithSetupCheck();
      break;

    case 'setup': {
      const { runSetup } = require(path.join(PACKAGE_ROOT, 'daemon', 'setup'));
      const result = await runSetup({ verbose: true });
      process.exit(result.ready ? 0 : 1);
      break;
    }

    case 'install-service':
      requireServiceModule().install();
      break;
    case 'uninstall-service':
      requireServiceModule().uninstall();
      break;
    case 'service-status':
      requireServiceModule().status();
      break;

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
}

main();
