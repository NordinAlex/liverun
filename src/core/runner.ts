import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunnerOptions, RunnerResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { preloadScript } from './preload.js';

/** Unique path for the preload script, scoped to this process to avoid collisions */
const PRELOAD_PATH = path.join(os.tmpdir(), `liverun-preload-${process.pid}.cjs`);

/**
 * Write the preload script to disk once. It's reused across restarts.
 */
function ensurePreloadScript(): void {
  try {
    fs.writeFileSync(PRELOAD_PATH, preloadScript, 'utf8');
  } catch (e) {
    logger.error(`Failed to create preload script: ${e}`);
  }
}

/**
 * Remove the preload script from disk.
 */
function cleanupPreloadScript(): void {
  try {
    if (fs.existsSync(PRELOAD_PATH)) {
      fs.unlinkSync(PRELOAD_PATH);
    }
  } catch (_) {}
}

/**
 * Poll a TCP port until it accepts connections.
 * Resolves the callback once, then stops polling.
 */
function waitForPort(
  targetPort: number,
  shouldContinue: () => boolean,
  onReachable: () => void,
): void {
  if (!shouldContinue()) return;

  const socket = new net.Socket();
  socket.setTimeout(2000);

  const retry = (delay: number) => {
    if (shouldContinue()) {
      setTimeout(() => waitForPort(targetPort, shouldContinue, onReachable), delay);
    }
  };

  socket.on('connect', () => {
    socket.destroy();
    onReachable();
  });

  socket.on('timeout', () => {
    socket.destroy();
    retry(200);
  });

  socket.on('error', () => {
    socket.destroy();
    retry(100);
  });

  socket.connect(targetPort, '127.0.0.1');
}

export function startRunner({ script, port, onReady, onCrash, onPortDetected }: RunnerOptions): RunnerResult {
  let child: ChildProcess | null = null;
  let isRestarting = false;
  let isReady = false;
  let lastErrorOutput = '';

  // Write preload script once at startup
  ensurePreloadScript();

  const spawnProcess = () => {
    isReady = false;
    lastErrorOutput = '';

    child = spawn('node', ['--require', PRELOAD_PATH, script], {
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
      env: {
        ...process.env,
        PORT: port.toString(),
        _LIVERUN_INTERNAL_PORT: port.toString(),
      },
    });

    const currentChild = child;

    // --- IPC messages from the preload script ---
    child.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case '_liverun_port':
          logger.info(`App requested port ${msg.port}`);
          break;

        case '_liverun_port_retry':
          logger.warn(`Internal port ${port} was busy, retrying on port ${msg.port}`);
          if (onPortDetected) onPortDetected(msg.port);
          break;

        case '_liverun_extra_listen':
          logger.info(
            `App has an additional server (listen call #${msg.callIndex}` +
            `${msg.originalPort ? `, originally port ${msg.originalPort}` : ''}) — assigned a random free port`,
          );
          break;
      }
    });

    // --- Capture stderr for error overlay ---
    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
      lastErrorOutput += data.toString();
      // Cap the buffer to prevent unbounded memory growth
      if (lastErrorOutput.length > 10_000) {
        lastErrorOutput = lastErrorOutput.slice(-10_000);
      }
    });

    // --- Wait for the app's port to become reachable ---
    waitForPort(
      port,
      () => child === currentChild && currentChild.exitCode === null,
      () => {
        if (!isReady && onReady) {
          isReady = true;
          onReady();
        }
      },
    );

    // --- Process lifecycle ---
    child.on('error', (err: Error) => {
      logger.error(`Failed to start server process: ${err.message}`);
      lastErrorOutput += `Failed to start server process: ${err.message}\n`;
    });

    child.on('exit', (code: number | null, signal: string | null) => {
      isReady = false;

      if (isRestarting) return; // restart() handles re-spawning

      if (signal) {
        // Killed by signal (e.g. SIGTERM during shutdown) — expected, not a crash
        child = null;
      } else if (code !== null && code !== 0) {
        logger.error(`Server crashed with code ${code}. Waiting for file changes before restarting...`);
        child = null;
        // Give stderr a moment to flush before triggering the error overlay
        if (onCrash) setTimeout(onCrash, 100);
      } else {
        child = null;
      }
    });
  };

  const restart = () => {
    if (isRestarting) return;
    isRestarting = true;

    if (child) {
      // Force-kill fallback if SIGTERM doesn't work within 5 seconds
      const killTimeout = setTimeout(() => {
        if (child) {
          logger.warn('Server did not stop gracefully, force killing...');
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }, 5_000);

      child.once('exit', () => {
        clearTimeout(killTimeout);
        isRestarting = false;
        spawnProcess();
      });

      try {
        child.kill('SIGTERM');
      } catch (_) {
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

  const kill = () => {
    if (child) {
      try { child.kill('SIGTERM'); } catch (_) {}
      child = null;
    }
    cleanupPreloadScript();
  };

  // Start the first process
  spawnProcess();

  return { restart, getLastError: () => lastErrorOutput, kill };
}
