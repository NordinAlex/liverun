/**
 * Preload script injected into the child process via --require.
 *
 * Intercepts net.Server.prototype.listen to redirect the app's first
 * listen() call to the internal port chosen by liverun. Subsequent
 * listen() calls (multi-server setups) are assigned random free ports
 * to avoid EADDRINUSE collisions.
 *
 * Communication with the parent process happens over Node's IPC channel.
 */
export const preloadScript = `
'use strict';

const net = require('net');
const originalListen = net.Server.prototype.listen;
let listenCallCount = 0;

/**
 * Extract the port from the first argument of listen(), which can be:
 *   - a number:  server.listen(3000)
 *   - a string:  server.listen("3000")
 *   - an object: server.listen({ port: 3000 })
 */
function extractPort(arg) {
  if (typeof arg === 'number') return arg;
  if (typeof arg === 'string' && !isNaN(Number(arg))) return parseInt(arg, 10);
  if (typeof arg === 'object' && arg !== null && arg.port !== undefined) return arg.port;
  return null;
}

/**
 * Replace the port in the first argument, preserving the original shape.
 */
function replacePort(arg, newPort) {
  if (typeof arg === 'number' || (typeof arg === 'string' && !isNaN(Number(arg)))) return newPort;
  if (typeof arg === 'object' && arg !== null && arg.port !== undefined) return { ...arg, port: newPort };
  return arg;
}

/**
 * Safely send a message to the parent process over IPC.
 */
function ipcSend(msg) {
  if (process.send) {
    try { process.send(msg); } catch (_) {}
  }
}

net.Server.prototype.listen = function (...args) {
  listenCallCount++;
  const callIndex = listenCallCount;
  const targetPort = process.env._LIVERUN_INTERNAL_PORT
    ? parseInt(process.env._LIVERUN_INTERNAL_PORT, 10)
    : null;

  if (targetPort) {
    const originalPort = extractPort(args[0]);

    if (callIndex === 1) {
      // First listen() — redirect to liverun's internal port
      args[0] = replacePort(args[0], targetPort);
      if (originalPort !== null) {
        ipcSend({ type: '_liverun_port', port: originalPort });
      }
    } else {
      // Additional listen() calls — use port 0 so the OS picks a free port
      args[0] = replacePort(args[0], 0);
      ipcSend({
        type: '_liverun_extra_listen',
        callIndex: callIndex,
        originalPort: originalPort
      });
    }
  }

  // EADDRINUSE auto-retry for the primary listen() call
  if (callIndex === 1 && targetPort) {
    const self = this;
    let retryCount = 0;
    const maxRetries = 10;

    const retryOnBusy = (err) => {
      if (err.code === 'EADDRINUSE' && retryCount < maxRetries) {
        retryCount++;
        const nextPort = (typeof args[0] === 'number' ? args[0] : targetPort) + 1;
        args[0] = nextPort;
        ipcSend({ type: '_liverun_port_retry', port: nextPort });

        setTimeout(() => {
          self.once('error', retryOnBusy);
          originalListen.apply(self, args);
        }, 100);
      }
    };

    this.once('error', retryOnBusy);
  }

  return originalListen.apply(this, args);
};
`;
