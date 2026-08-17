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
function timestamp() {
  return new Date().toLocaleTimeString();
}

class AssistantCore extends EventEmitter {
  constructor({ config, wakePhrases }) {
    super();
    this.config = config;
    this.wakePhrases = wakePhrases;
    this.state = 'idle';
    this.commandBuffer = [];
    this.commandTimer = null;
    this.activeCommand = null; // { interrupt() } handle for the in-flight Claude process, while state === 'processing'
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
    console.log(`[USER ${timestamp()}]`, text.trim());
    this.emit('transcript', text);

    if (this.state === 'processing') {
      // Barge-in: the user started talking again while Claude was still
      // working (or still being spoken back to them via TTS) — like
      // interrupting someone mid-sentence on a call. Cancel the in-flight
      // command and any speech immediately, then treat this new utterance
      // as the new command right away — no need to repeat the wake word,
      // since we're already mid-conversation.
      console.log(`[INTERRUPT ${timestamp()}] barging in, cancelling in-flight command`);
      this.interrupt();
      // Strip a leading wake phrase if the user happened to repeat it
      // (natural on a call — "Maya, actually wait...") but don't require
      // one, since we're already mid-conversation.
      const matched = this.containsWakePhrase(text);
      const newCommand = matched ? text.toLowerCase().split(matched)[1] || text : text;
      this.runCommand(newCommand.trim());
      return;
    }

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

  /** Cancels whatever's currently in flight — the Claude process and any TTS playback. Safe to call anytime. */
  interrupt() {
    if (this.activeCommand) {
      this.activeCommand.interrupt();
      this.activeCommand = null;
    }
    try { require('./tts').stop(); } catch (e) { /* tts module load/stop failure shouldn't block the interrupt */ }
  }

  async runCommand(promptText) {
    if (!promptText || !promptText.trim()) {
      this.setState('idle', { reason: 'empty-command' });
      return;
    }

    console.log(`[USER->CLAUDE ${timestamp()}]`, promptText);
    this.setState('processing', { prompt: promptText });
    this.commandBuffer = [];

    // A barge-in can start a NEW runCommand() before this one's killed
    // process has finished emitting its 'exit' event — that stale cleanup
    // must not be allowed to clobber the newer call's activeCommand/state.
    // Comparing identity against this call's OWN handle (not just checking
    // "is activeCommand null") makes the cleanup below safe regardless of
    // which finishes its async cleanup last.
    let ownHandle = null;

    const { runClaudeCommandStreaming } = require('./claude-bridge');
    try {
      const result = await runClaudeCommandStreaming({
        claudeBin: this.config.claudeBin,
        workingDirectory: this.config.workingDirectory,
        prompt: promptText,
        onSpawn: (handle) => { ownHandle = handle; this.activeCommand = handle; },
        onText: (chunk) => this.emit('claude-text', chunk),
        onTool: (tool) => this.emit('claude-tool', tool)
      });
      if (this.activeCommand === ownHandle) this.activeCommand = null;

      if (result.interrupted) {
        // Barged in on itself — a NEW runCommand() is already about to take
        // over (handleUtterance called it right after interrupt()), so
        // don't emit 'done' for this stale, truncated response — that
        // would incorrectly notify/speak a half-finished answer.
        console.log(`[INTERRUPTED ${timestamp()}] partial response discarded:`, result.text.trim() || '(no text yet)');
        return;
      }

      console.log(`[ASSISTANT ${timestamp()}]`, result.text.trim());
      this.emit('done', result.text);
    } catch (err) {
      if (this.activeCommand === ownHandle) this.activeCommand = null;
      console.error(`[ERROR ${timestamp()}]`, err.message);
      this.emit('error', err);
    }

    // Only reset to idle if THIS call's handle is still the active one —
    // if a barge-in already replaced it with a newer command, leave the
    // 'processing' state alone; the newer call owns it now.
    if (this.activeCommand === null && this.state === 'processing') {
      this.setState('idle', { reason: 'command-complete' });
    }
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
