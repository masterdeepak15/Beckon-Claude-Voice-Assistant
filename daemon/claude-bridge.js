'use strict';
const { spawn } = require('child_process');
const readline = require('readline');

/**
 * Invokes Claude Code non-interactively and parses its streamed JSON output
 * line-by-line as it arrives, so the tray can show realtime status ("using
 * tool X", live text) instead of only the final result after exit.
 *
 * Flags: `-p` (print/non-interactive), `-c` (continue most recent session),
 * `--output-format stream-json --verbose` (line-delimited JSON events incl.
 * tool_use blocks). Verify against `claude --help` for your installed
 * version — these flags can change between Claude Code releases.
 *
 * The exact JSON shape of stream-json events can also evolve between
 * versions; this parser is defensive (checks a few known shapes rather
 * than assuming one) and falls back to raw stdout text if a line isn't
 * JSON it recognizes, so a format change degrades gracefully instead of
 * crashing the daemon.
 */
function runClaudeCommandStreaming({ claudeBin, workingDirectory, prompt, onText, onTool, onSpawn }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '-c', '--output-format', 'stream-json', '--verbose'];
    const child = spawn(claudeBin, args, {
      cwd: workingDirectory,
      shell: process.platform === 'win32'
    });

    // Set when the CALLER deliberately kills this process (barge-in / user
    // interrupted) rather than it failing on its own — lets the exit handler
    // resolve cleanly instead of rejecting as if something went wrong.
    let interrupted = false;
    if (onSpawn) {
      onSpawn({
        pid: child.pid,
        interrupt: () => { interrupted = true; child.kill(); }
      });
    }

    let fullText = '';
    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      let event;
      try {
        event = JSON.parse(line);
      } catch (e) {
        // Not JSON (older CLI, or a plain text line) — treat as raw text.
        fullText += line + '\n';
        if (onText) onText(line + '\n');
        return;
      }

      // Defensive shape-checking — stream-json event shapes have varied
      // across Claude Code versions. Handle the common cases explicitly.
      const content = event.message && event.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text;
            if (onText) onText(block.text);
          } else if (block.type === 'tool_use') {
            if (onTool) onTool({ name: block.name, input: block.input });
          }
        }
      } else if (event.type === 'text' && event.text) {
        fullText += event.text;
        if (onText) onText(event.text);
      } else if (event.type === 'tool_use') {
        if (onTool) onTool({ name: event.name, input: event.input });
      }
    });

    child.stderr.on('data', (chunk) => {
      console.error('[claude-bridge]', chunk.toString().trim());
    });

    child.on('error', (err) => {
      reject(new Error(
        `Couldn't launch Claude Code ('${claudeBin}'). Is it installed and on PATH? ${err.message}`
      ));
    });

    child.on('exit', (code) => {
      if (interrupted) {
        // Deliberately killed by the caller (barge-in) — not a failure.
        // Resolve with whatever text streamed before the interrupt.
        resolve({ text: fullText, interrupted: true });
        return;
      }
      if (code === 0) resolve({ text: fullText, interrupted: false });
      else reject(new Error(`Claude Code exited with code ${code}`));
    });
  });
}

module.exports = { runClaudeCommandStreaming };
