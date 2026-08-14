'use strict';
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SPYDER_MARKETPLACE = 'masterdeepak15/Spyder';
const ASSISTANT_PLUGIN = 'assistant@spyder';

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
    return { ok: true, output: out };
  } catch (err) {
    // execSync throws on nonzero exit — stdout/stderr are still attached to the error.
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    return { ok: false, output, error: err };
  }
}

function isClaudeInstalled() {
  const result = run('claude --version');
  return result.ok;
}

/**
 * Runs Claude Code's official native installer for the current platform.
 * Commands per https://docs.claude.com (verified before writing this —
 * see CLI.md changelog note) — if Anthropic changes these, this step
 * will just fail loudly with the real error rather than silently doing
 * the wrong thing.
 */
function installClaudeCode() {
  console.log('Claude Code CLI not found. Installing via the official native installer...\n');

  if (process.platform === 'win32') {
    const result = run('powershell.exe -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"', { stdio: 'inherit' });
    return result;
  }
  if (process.platform === 'linux') {
    // `set -o pipefail` is essential here — without it, a failed curl
    // (network down, 403, etc.) piped into bash still exits 0 because
    // bash's default exit status only reflects the LAST command in the
    // pipe, and an empty stdin to that inner bash exits cleanly. Found
    // this the hard way: without pipefail, a failed download was being
    // reported as a successful install.
    const result = run('bash -c "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash"', { stdio: 'inherit' });
    return result;
  }
  return { ok: false, output: `Unsupported platform for auto-install: ${process.platform}` };
}

/**
 * Idempotent — safe to call whether or not the marketplace/plugin is
 * already present. Claude Code's CLI returns a nonzero exit with an
 * "already installed"/"already exists"-style message in that case rather
 * than a clean success, so we treat that specific shape as success too.
 */
function alreadyPresent(output) {
  return /already (installed|exists|added|present)/i.test(output);
}

function ensureAssistantSkillInstalled() {
  console.log('Checking the "assistant" Claude Code skill...');

  const marketplaceResult = run(`claude plugin marketplace add ${SPYDER_MARKETPLACE}`);
  if (!marketplaceResult.ok && !alreadyPresent(marketplaceResult.output)) {
    return { ok: false, step: 'marketplace add', output: marketplaceResult.output };
  }

  const installResult = run(`claude plugin install ${ASSISTANT_PLUGIN}`);
  if (!installResult.ok && !alreadyPresent(installResult.output)) {
    return { ok: false, step: 'plugin install', output: installResult.output };
  }

  return { ok: true };
}

function isOnboarded() {
  // A real name means onboarding actually ran, not just that the skill
  // is installed — installing the plugin alone doesn't create ~/.assistant/.
  return !!config.readAssistantName();
}

/**
 * Full setup flow. Returns { ready: boolean, messages: string[] } — never
 * throws, so callers (CLI or the tray app on startup) can decide what to
 * do with a not-fully-ready result instead of crashing.
 */
async function runSetup({ verbose = true } = {}) {
  const log = (msg) => { if (verbose) console.log(msg); };
  const messages = [];

  log('\n🔧 Beckon setup check\n');

  // 1. Claude Code CLI
  if (isClaudeInstalled()) {
    log('✅ Claude Code CLI is installed.');
  } else {
    const installResult = installClaudeCode();
    if (!installResult.ok) {
      const msg = `❌ Couldn't auto-install Claude Code. Install it manually:\n` +
        `   Windows: irm https://claude.ai/install.ps1 | iex\n` +
        `   Linux:   curl -fsSL https://claude.ai/install.sh | bash\n` +
        `   Then run 'beckon setup' again.`;
      log(msg);
      messages.push(msg);
      return { ready: false, messages };
    }
    log('✅ Claude Code installer ran.');
    log('⚠️  Open a NEW terminal (so `claude` is on PATH), then run `beckon setup` again to finish.');
    messages.push('Claude Code was just installed — restart your terminal and re-run `beckon setup`.');
    return { ready: false, messages };
  }

  // 2. The 'assistant' skill (Spyder marketplace)
  const skillResult = ensureAssistantSkillInstalled();
  if (!skillResult.ok) {
    const msg = `❌ Couldn't install the 'assistant' skill (failed at: ${skillResult.step}).\n` +
      `   Try manually: claude plugin marketplace add ${SPYDER_MARKETPLACE}\n` +
      `                 claude plugin install ${ASSISTANT_PLUGIN}\n` +
      `   Details: ${skillResult.output.trim().slice(0, 300)}`;
    log(msg);
    messages.push(msg);
    return { ready: false, messages };
  }
  log('✅ The "assistant" skill is installed.');

  // 2.5. Speech model for the configured engine — retries the download here
  // if it failed or was skipped during `npm install` (e.g. no internet at
  // install time). Only relevant for "vosk"; "sapi" needs nothing and
  // "whisper" downloads its model lazily on first real use.
  const currentConfig = config.loadConfig();
  if (currentConfig.sttProvider === 'vosk') {
    const fs = require('fs');

    if (!config.isVoskAvailable()) {
      // vosk itself never built — most likely its ffi-napi dependency, a
      // known-fragile native compile especially on Windows/newer Node.
      // No point retrying a model download for an engine that can't load.
      const msg = `⚠️  Vosk (your configured speech engine) isn't actually installed — ` +
        `its native dependency didn't build. Switch to "whisper" from the tray's Voice ` +
        `Engine menu (needs no native compilation), or "sapi" if you're on Windows.`;
      log(msg);
      messages.push(msg);
    } else if (fs.existsSync(config.BUNDLED_VOSK_MODEL_PATH) || currentConfig.voskModelPath) {
      log('✅ Vosk speech model is ready.');
    } else {
      log('Speech model missing — retrying download...');
      const { ensureVoskModel } = require('./model-installer');
      const modelResult = await ensureVoskModel({ log, warn: log });
      if (modelResult.ok) {
        log('✅ Vosk speech model is ready.');
      } else {
        const msg = `⚠️  Couldn't download the Vosk speech model (${modelResult.reason}). ` +
          `Switch to "sapi" (Windows) from the tray menu, or download a model manually — see CLI.md §3.`;
        log(msg);
        messages.push(msg);
        // Not a hard blocker — sapi/whisper are still switchable from the tray, so don't return early.
      }
    }
  }

  // 3. Onboarding — this genuinely can't be automated, it's a real
  // conversation where the user names their assistant. Just detect it.
  if (isOnboarded()) {
    const name = config.readAssistantName();
    log(`✅ Onboarding already done — your assistant is named "${name}".`);
  } else {
    const msg = 'Almost there: open a terminal, run `claude`, and just say hi — ' +
      'onboarding will kick in automatically and ask what to name your assistant. ' +
      'Run `beckon setup` again afterward, or just `beckon start` — it checks this itself.';
    log(`⚠️  ${msg}`);
    messages.push(msg);
    return { ready: false, messages };
  }

  log('\n🎉 Everything is ready. Run `beckon start` (or just `beckon`) to launch.\n');
  return { ready: true, messages };
}

module.exports = { runSetup, isClaudeInstalled, isOnboarded, ensureAssistantSkillInstalled };
