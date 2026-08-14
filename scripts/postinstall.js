#!/usr/bin/env node
'use strict';
/**
 * Runs automatically after `npm install`. Goal: by the time this finishes,
 * the user should be able to run `beckon start` and have it just work —
 * no separate "now go install the STT engine" step.
 *
 * HARD RULE: this script must NEVER cause `npm install` itself to fail.
 * Every step is best-effort, wrapped, and logged — worst case, the user
 * sees a note about what to run manually, and `beckon setup`/`beckon start`
 * (which reuse the same shared logic, see daemon/model-installer.js and
 * daemon/setup.js) retry it later.
 */
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_ROOT = path.join(__dirname, '..');

function log(msg) { console.log(`[beckon postinstall] ${msg}`); }
function warn(msg) { console.warn(`[beckon postinstall] ${msg}`); }

/** Heuristic: don't do heavy network/download work for a project-local
 * install (e.g. someone required this as a dependency of another tool) or
 * in CI. Global installs are what real end users run. Override with
 * BECKON_FORCE_POSTINSTALL=1 for testing. */
function shouldRunHeavySteps() {
  if (process.env.BECKON_SKIP_POSTINSTALL === '1') return false;
  if (process.env.BECKON_FORCE_POSTINSTALL === '1') return true;
  if (process.env.CI) return false;
  return process.env.npm_config_global === 'true';
}

/** Best-effort: if Claude Code is already on this machine, get the
 * 'assistant' skill installed too, so literally nothing is left to do
 * after `npm install` except complete onboarding (which can't be scripted). */
function ensureAssistantSkillIfClaudePresent() {
  try {
    execSync('claude --version', { stdio: 'ignore' });
  } catch (e) {
    log("Claude Code CLI not found yet — that's fine, 'beckon start' will offer to install it.");
    return;
  }
  try {
    const { ensureAssistantSkillInstalled } = require(path.join(PACKAGE_ROOT, 'daemon', 'setup'));
    const result = ensureAssistantSkillInstalled();
    if (result.ok) log('✅ The "assistant" Claude Code skill is installed.');
    else warn(`Couldn't auto-install the 'assistant' skill (${result.step}) — 'beckon setup' will retry.`);
  } catch (e) {
    warn(`Skill install check failed: ${e.message} — 'beckon setup' will retry.`);
  }
}

async function main() {
  if (!shouldRunHeavySteps()) {
    log('Skipping automatic model download/setup (not a global install or CI detected).');
    log("Run 'beckon setup' any time to finish setup.");
    return;
  }

  log('Setting things up so Beckon works right away...\n');

  const { ensureVoskModel } = require(path.join(PACKAGE_ROOT, 'daemon', 'model-installer'));
  const modelResult = await ensureVoskModel({ log, warn });
  if (!modelResult.ok) {
    warn(`No problem — Windows users don't need this (uses built-in speech recognition).`);
    warn(`Linux users: run 'beckon setup' later to retry, or see CLI.md §3 for manual setup.`);
  }

  ensureAssistantSkillIfClaudePresent();

  log('\nDone. Run `beckon start` — it double-checks everything and launches.');
  log('(If your assistant hasn\'t been named yet, `beckon start` will tell you exactly what to do.)\n');
}

main().catch((err) => {
  // Absolute last resort — must never make `npm install` itself fail.
  warn(`Unexpected error during setup: ${err.message}`);
  warn("No harm done — run 'beckon setup' any time to finish.");
}).finally(() => process.exit(0));

