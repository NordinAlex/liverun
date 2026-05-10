import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunnerOptions, RunnerResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function startRunner({ script, port, onReady, onCrash, onPortDetected }: RunnerOptions): RunnerResult {
  let child: ChildProcess | null = null;
  let isRestarting = false;
  let isReady = false;
  let activePort = port; // The port the app is actually listening on

  const waitForPort = (targetPort: number, processToWatch: ChildProcess | null) => {
    if (!processToWatch || processToWatch.exitCode !== null) return;

    const socket = new net.Socket();
    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.destroy();
      if (!isReady && onReady) {
        isReady = true;
        onReady();
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      // Retry after timeout
      if (child === processToWatch) {
        setTimeout(() => waitForPort(targetPort, processToWatch), 200);
      }
    });

    socket.on('error', () => {
      socket.destroy();
      setTimeout(() => {
        if (child === processToWatch) {
          waitForPort(targetPort, processToWatch);
        }
      }, 100);
    });

    socket.connect(targetPort, '127.0.0.1');
  };

  let lastErrorOutput = '';

  const spawnProcess = () => {
    isReady = false;
    lastErrorOutput = '';
    activePort = port;

    // Create the preload script that intercepts net.Server.prototype.listen
    // This forces the app to listen on our internal port, regardless of hardcoded values.
    // Only the FIRST listen() call is intercepted — subsequent ones (e.g. a second
    // server on a different port) are assigned separate free ports automatically.
    const preloadPath = path.join(os.tmpdir(), '_liverun_preload.js');
    const preloadCode = `
      const net = require('net');
      const originalListen = net.Server.prototype.listen;
      let listenCallCount = 0;

      net.Server.prototype.listen = function(...args) {
        listenCallCount++;
        const callIndex = listenCallCount;
        const targetPort = process.env._LIVERUN_INTERNAL_PORT
          ? parseInt(process.env._LIVERUN_INTERNAL_PORT, 10)
          : null;

        if (targetPort) {
          // Capture what port the app originally wanted to use
          let originalPort = null;

          if (typeof args[0] === 'number') {
            originalPort = args[0];
          } else if (typeof args[0] === 'string' && !isNaN(Number(args[0]))) {
            originalPort = parseInt(args[0], 10);
          } else if (typeof args[0] === 'object' && args[0] !== null && args[0].port !== undefined) {
            originalPort = args[0].port;
          }

          if (callIndex === 1) {
            // First listen() call — redirect to internal port
            if (typeof args[0] === 'number' || (typeof args[0] === 'string' && !isNaN(Number(args[0])))) {
              args[0] = targetPort;
            } else if (typeof args[0] === 'object' && args[0] !== null && args[0].port !== undefined) {
              args[0] = { ...args[0], port: targetPort };
            }

            // Report the original port back to the parent via IPC
            if (originalPort !== null && process.send) {
              try { process.send({ type: '_liverun_port', port: originalPort }); } catch(e) {}
            }
          } else {
            // Additional listen() calls — let them use port 0 (OS assigns a free port)
            // This prevents EADDRINUSE when the app creates multiple servers
            if (typeof args[0] === 'number' || (typeof args[0] === 'string' && !isNaN(Number(args[0])))) {
              args[0] = 0;
            } else if (typeof args[0] === 'object' && args[0] !== null && args[0].port !== undefined) {
              args[0] = { ...args[0], port: 0 };
            }

            if (process.send) {
              try {
                process.send({
                  type: '_liverun_extra_listen',
                  callIndex: callIndex,
                  originalPort: originalPort
                });
              } catch(e) {}
            }
          }
        }

        // Add EADDRINUSE retry for the first listen() call only
        if (callIndex === 1 && targetPort) {
          const self = this;
          let retryCount = 0;
          const maxRetries = 10;

          const retryOnBusy = (err) => {
            if (err.code === 'EADDRINUSE' && retryCount < maxRetries) {
              retryCount++;
              const nextPort = (typeof args[0] === 'number' ? args[0] : targetPort) + 1;
              args[0] = nextPort;

              if (process.send) {
                try { process.send({ type: '_liverun_port_retry', port: nextPort }); } catch(e) {}
              }

              // Small delay before retry to let the port free up
              setTimeout(() => {
                self.once('error', retryOnBusy);
                originalListen.apply(self, args);
              }, 100);
            }
            // If not EADDRINUSE or max retries reached, let the app's own error handlers deal with it
          };

          this.once('error', retryOnBusy);
        }

        return originalListen.apply(this, args);
      };
    `;
    try {
      fs.writeFileSync(preloadPath, preloadCode, 'utf8');
    } catch (e) {
      logger.error('Failed to create preload script: ' + e);
    }

    child = spawn('node', ['--require', preloadPath, script], {
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
      env: {
        ...process.env,
        PORT: port.toString(),
        _LIVERUN_INTERNAL_PORT: port.toString(),
      }
    });

    // Listen for IPC messages from the preload script
    child.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case '_liverun_port':
          logger.info(`App requested port ${msg.port}`);
          break;

        case '_liverun_port_retry':
          // The internal port was busy, app retried on a new port
          activePort = msg.port;
          logger.warn(`Internal port ${port} was busy, retrying on port ${msg.port}`);
          if (onPortDetected) {
            onPortDetected(msg.port);
          }
          break;

        case '_liverun_extra_listen':
          // App called listen() more than once — this is common with multi-server setups
          logger.info(
            `App has an additional server (listen call #${msg.callIndex}` +
            `${msg.originalPort ? `, originally port ${msg.originalPort}` : ''}) — assigned a random free port`
          );
          break;
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
      lastErrorOutput += data.toString();
      if (lastErrorOutput.length > 10000) {
        lastErrorOutput = lastErrorOutput.slice(-10000);
      }
    });

    waitForPort(port, child);

    child.on('error', (err: Error) => {
      logger.error(`Failed to start server process: ${err.message}`);
      lastErrorOutput += `Failed to start server process: ${err.message}\n`;
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      isReady = false;
      if (!isRestarting) {
        if (signal) {
          // Process was killed by a signal (e.g. SIGTERM during shutdown)
          // This is expected during graceful shutdown, don't treat it as a crash
          child = null;
        } else if (code !== null && code !== 0) {
          logger.error(`Server crashed with code ${code}. Waiting for file changes before restarting...`);
          if (onCrash) {
            // Give some time for stderr to be read before we reload
            setTimeout(onCrash, 100);
          }
          child = null;
        } else {
          child = null;
        }
      }
    });
  };

  const restart = () => {
    if (isRestarting) return;
    isRestarting = true;

    if (child) {
      const killTimeout = setTimeout(() => {
        // Force kill if SIGTERM didn't work after 5 seconds
        if (child) {
          logger.warn('Server did not stop gracefully, force killing...');
          try { child.kill('SIGKILL'); } catch (e) {}
        }
      }, 5000);

      child.once('exit', () => {
        clearTimeout(killTimeout);
        isRestarting = false;
        spawnProcess();
      });

      try {
        child.kill('SIGTERM');
      } catch (e) {
        // Process might already be dead
        clearTimeout(killTimeout);
        isRestarting = false;
        spawnProcess();
      }
    } else {
      isRestarting = false;
      spawnProcess();
    }
  };

  spawnProcess();

  const kill = () => {
    if (child) {
      try { child.kill('SIGTERM'); } catch (e) {}
      child = null;
    }
    const preloadPath = path.join(os.tmpdir(), '_liverun_preload.js');
    try {
      if (fs.existsSync(preloadPath)) {
        fs.unlinkSync(preloadPath);
      }
    } catch (e) {}
  };

  return { restart, getLastError: () => lastErrorOutput, kill };
}
