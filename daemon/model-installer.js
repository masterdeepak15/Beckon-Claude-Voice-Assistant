'use strict';
/**
 * Shared by scripts/postinstall.js (runs once, at install time) and
 * daemon/setup.js (`beckon setup` — can retry this if install-time
 * download failed, e.g. no internet at npm-install time).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const config = require('./config');

function downloadFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        file.close();
        fs.unlinkSync(destPath);
        return resolve(downloadFile(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const attempts = [
    () => execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' }),
    () => execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'pipe' }),
    () => execSync(`python3 -c "import zipfile; zipfile.ZipFile(r'${zipPath}').extractall(r'${destDir}')"`, { stdio: 'pipe' })
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try { attempt(); return true; } catch (e) { lastError = e; }
  }
  throw lastError || new Error('No working zip extractor found (tried unzip, tar, python3)');
}

/**
 * Downloads and unpacks the small offline Vosk English model, so
 * `sttProvider: "vosk"` works with zero manual steps. Idempotent — skips
 * cleanly if already present. Returns { ok, reason? }, never throws.
 */
async function ensureVoskModel({ log = () => {}, warn = console.warn } = {}) {
  if (!config.isVoskAvailable()) {
    // No point downloading a 40MB model for an engine that can't load.
    // This is expected and fine — not every platform can build ffi-napi's
    // native bindings, and "sapi" (Windows) / "whisper" (any platform)
    // don't need this at all.
    return { ok: false, reason: 'vosk-not-installed', skippedDownload: true };
  }

  if (fs.existsSync(config.BUNDLED_VOSK_MODEL_PATH)) {
    log('Vosk model already present, skipping download.');
    return { ok: true };
  }

  const modelUrl = process.env.BECKON_VOSK_MODEL_URL ||
    `https://alphacephei.com/vosk/models/${config.BUNDLED_VOSK_MODEL_NAME}.zip`;

  log(`Downloading offline speech model (~40MB, one-time)...\n  ${modelUrl}`);
  fs.mkdirSync(config.BUNDLED_MODELS_DIR, { recursive: true });
  const zipPath = path.join(config.BUNDLED_MODELS_DIR, `${config.BUNDLED_VOSK_MODEL_NAME}.zip`);

  try {
    await downloadFile(modelUrl, zipPath);
    extractZip(zipPath, config.BUNDLED_MODELS_DIR);
    fs.unlinkSync(zipPath);

    if (!fs.existsSync(config.BUNDLED_VOSK_MODEL_PATH)) {
      const entries = fs.readdirSync(config.BUNDLED_MODELS_DIR).filter((e) =>
        fs.statSync(path.join(config.BUNDLED_MODELS_DIR, e)).isDirectory()
      );
      if (entries.length === 1) {
        fs.renameSync(path.join(config.BUNDLED_MODELS_DIR, entries[0]), config.BUNDLED_VOSK_MODEL_PATH);
      }
    }

    if (fs.existsSync(config.BUNDLED_VOSK_MODEL_PATH)) {
      log('✅ Speech model ready.');
      return { ok: true };
    }
    warn('Downloaded and extracted, but the model folder ended up somewhere unexpected. ' +
      `Check ${config.BUNDLED_MODELS_DIR} manually, or set voskModelPath yourself.`);
    return { ok: false, reason: 'unexpected folder layout after extraction' };
  } catch (err) {
    warn(`Couldn't auto-download the speech model (${err.message}).`);
    return { ok: false, reason: err.message };
  }
}

module.exports = { ensureVoskModel };
