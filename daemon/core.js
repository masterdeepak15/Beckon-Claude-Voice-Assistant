'use strict';
const EventEmitter = require('events');

/**
 * States:
 *   idle       — listening for a wake phrase, nothing else happening
 *   awake      — wake phrase heard, buffering the command that follows
 *   processing — Claude Code invoked, waiting on/streaming its response
 *
 * Emits (consumed by main.js for tray icon / popup / notifications):
 *   'state'         (state, meta)              — state transition
 *   'transcript'    (text)                      — raw STT text, for debugging/popup captions
 *   'claude-text'   (chunk)                      — streamed response text from Claude Code
 *   'claude-tool'   ({ name, input })            — Claude Code started using a tool (realtime, via stream-json)
 *   'hook-event'    ({ event, payload })         — realtime signal from a Claude Code HTTP hook (ANY session, not just ours)
 *   'notify'        ({ title, body })            — something the tray should surface as an OS notification
 *   'done'          (fullText)                   — command cycle finished, back to idle
 *   'error'         (Error)
 */
class AssistantCore extends EventEmitter {
  constructor({ config, wakePhrases }) {
    super();
    this.config = config;
    this.wakePhrases = wakePhrases;
    this.state = 'idle';
    this.commandBuffer = [];
    this.commandTimer = null;
  }

  setState(state, meta) {
    this.state = state;
    this.emit('state', state, meta);
  }

  containsWakePhrase(text) {
    const lower = text.toLowerCase();
    return this.wakePhrases.find((p) => lower.includes(p));
  }

  /** Called by whichever STT provider is active, for every finalized utterance. */
  handleUtterance(text) {
    if (!text || !text.trim()) return;
    if (this.state === 'paused') return; // "Hold" from the tray menu — ignore everything
    this.emit('transcript', text);

    if (this.state === 'idle') {
      const matched = this.containsWakePhrase(text);
      if (!matched) return; // ignored — no Claude call, no cost

      this.setState('awake', { matched });

      const remainder = text.toLowerCase().split(matched)[1];
      if (remainder && remainder.trim().length > 2) {
        this.commandBuffer.push(remainder.trim());
        // Command arrived in the SAME utterance as the wake word — finalize
        // it on the short grace timer, same as a follow-up utterance would.
        this._armCommandTimer(1200, () => this.runCommand(this.commandBuffer.join(' ')));
        return;
      }

      this._armCommandTimer(this.config.commandWindowMs, () => {
        if (this.commandBuffer.length === 0) {
          this.setState('idle', { reason: 'timeout-no-command' });
        }
      });
      return;
    }

    if (this.state === 'awake') {
      this.commandBuffer.push(text.trim());
      this._armCommandTimer(1200, () => this.runCommand(this.commandBuffer.join(' ')));
    }
  }

  /** Called directly for push-to-talk / manual invocation from the tray menu. */
  handleManualCommand(text) {
    this.setState('awake', { manual: true });
    this.runCommand(text);
  }

  _armCommandTimer(ms, fn) {
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = setTimeout(fn, ms);
  }

  async runCommand(promptText) {
    if (!promptText || !promptText.trim()) {
      this.setState('idle', { reason: 'empty-command' });
      return;
    }

    this.setState('processing', { prompt: promptText });
    this.commandBuffer = [];

    const { runClaudeCommandStreaming } = require('./claude-bridge');
    try {
      const fullText = await runClaudeCommandStreaming({
        claudeBin: this.config.claudeBin,
        workingDirectory: this.config.workingDirectory,
        prompt: promptText,
        onText: (chunk) => this.emit('claude-text', chunk),
        onTool: (tool) => this.emit('claude-tool', tool)
      });
      this.emit('done', fullText);
    } catch (err) {
      this.emit('error', err);
    }

    this.setState('idle', { reason: 'command-complete' });
  }

  /** Fed by hook-server.js — realtime signals from ANY Claude Code session on the machine. */
  handleHookEvent(eventName, payload) {
    this.emit('hook-event', { event: eventName, payload });

    if (eventName === 'Notification') {
      this.emit('notify', {
        title: 'Claude Code needs your attention',
        body: payload && payload.message ? String(payload.message) : 'Check your terminal.'
      });
    }
    // Other events (PreToolUse/PostToolUse/Stop/SessionStart/UserPromptSubmit) are
    // exposed via 'hook-event' for the popup to render live activity from external
    // sessions too, without this core state machine treating them as ITS OWN cycle.
  }

  pause() {
    this.setState('paused');
  }

  resume() {
    this.setState('idle', { reason: 'resumed' });
  }
}

module.exports = { AssistantCore };
