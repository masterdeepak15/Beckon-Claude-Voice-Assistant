'use strict';
const http = require('http');

/**
 * Tiny local HTTP server that Claude Code's native HTTP hooks POST to
 * directly (hook type "http" — no curl/shell subprocess needed on either
 * OS). This gives the tray realtime visibility into ANY Claude Code
 * session on the machine (not just ones the daemon itself launched) —
 * e.g. a manual terminal session hitting a permission prompt can still
 * flash the tray icon and fire a system notification.
 *
 * IMPORTANT: this must respond fast (a few ms) and always with valid
 * JSON, because it sits in the request path of the user's real Claude
 * Code sessions system-wide once hooks are installed. It never blocks
 * or denies anything — it only observes and immediately returns `{}`
 * (continue normally).
 */
function startHookServer({ port, onHookEvent }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }

    // URL shape: /hook/<EventName>  e.g. /hook/PreToolUse
    const match = req.url.match(/^\/hook\/([A-Za-z]+)$/);
    const eventName = match ? match[1] : 'Unknown';

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (e) {
        // Malformed body — still ack so we never block the user's real session.
      }

      try {
        onHookEvent(eventName, payload);
      } catch (e) {
        console.error('[hook-server] handler error:', e.message);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}'); // "continue normally" in Claude Code's hook JSON-output format
    });
  });

  server.listen(port, '127.0.0.1');
  server.on('error', (err) => {
    console.error(`[hook-server] Failed to listen on port ${port}: ${err.message}`);
  });

  return {
    stop: () => server.close(),
    port
  };
}

module.exports = { startHookServer };
