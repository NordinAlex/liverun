#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import net from 'net';
import readline from 'readline';
import { startProxy } from '../core/proxy.js';
import { startWatcher } from '../core/watcher.js';
import { startRunner } from '../core/runner.js';
import { logger } from '../utils/logger.js';
import type { CliOptions } from '../types/index.js';

// Extensions to try when the user omits the file extension
const SCRIPT_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs'];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Resolve a script path, trying common extensions if the exact path doesn't exist.
 * Exits the process with an error if no matching file is found.
 */
function resolveScript(script: string): string {
  const absolute = path.resolve(process.cwd(), script);

  if (fs.existsSync(absolute)) return absolute;

  const resolved = SCRIPT_EXTENSIONS
    .map(ext => absolute + ext)
    .find(p => fs.existsSync(p));

  if (resolved) return resolved;

  logger.error(`Script not found: ${absolute}`);
  logger.error(`Also tried: ${SCRIPT_EXTENSIONS.map(ext => path.basename(absolute) + ext).join(', ')}`);
  process.exit(1);
}

/**
 * Detect the port from the script's source code by analysing common patterns:
 *   - process.env.PORT || <number>
 *   - .listen(<number>)
 *   - const PORT = <number>
 */
function detectPortFromSource(scriptPath: string): number {
  const DEFAULT_PORT = 3000;

  try {
    const raw = fs.readFileSync(scriptPath, 'utf8');

    // Strip comments to avoid matching ports in commented-out code
    const source = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const patterns: RegExp[] = [
      /process\.env\.PORT\s*\|\|\s*['"]?(\d+)['"]?/,   // process.env.PORT || 3000
      /\.listen\(\s*['"]?(\d+)['"]?/,                   // .listen(3000)
      /(?:const|let|var)\s*(?:PORT|port)\s*=\s*['"]?(\d+)['"]?/,  // const PORT = 3000
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
  } catch (_) {}

  return DEFAULT_PORT;
}

/**
 * Check whether a TCP port is available.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port);
  });
}

/**
 * Find the next available port starting from `startPort`.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let p = startPort;
  while (!(await isPortAvailable(p))) p++;
  return p;
}

/**
 * Prompt the user to pick an alternative port when the requested one is busy.
 * Returns the chosen port, or exits the process if the user declines.
 */
async function promptForAlternativePort(requestedPort: number): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise<string>(resolve => {
    rl.question(
      `Port ${requestedPort} is already in use. Would you like to run the app on another available port? (y/n) `,
      ans => { rl.close(); resolve(ans); },
    );
  });

  if (answer.toLowerCase().startsWith('y')) {
    return findAvailablePort(requestedPort + 1);
  }

  logger.error(`Cannot start server because port ${requestedPort} is in use.`);
  process.exit(1);
}

/**
 * Build watch directory lists from a comma-separated string.
 * Includes paths relative to both cwd and the target script's directory.
 */
function buildWatchDirs(dirsString: string): string[] {
  return dirsString
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(d => path.resolve(process.cwd(), d));
}

// -------------------------------------------------------------------
// CLI definition
// -------------------------------------------------------------------

program
  .version('0.5.2')
  .argument('<script>', 'The express server script to run (e.g. server.js)')
  .option('-p, --port <number>', 'Port for the live-dev proxy to listen on')
  .option('-s, --watch-server <directories>', 'Comma separated directories to watch for server restart', '.')
  .option('-c, --watch-client <directories>', 'Comma separated directories to watch for client refresh', '.')
  .action(async (script: string, options: CliOptions) => {
    const targetScript = resolveScript(script);
    const targetDir = path.dirname(targetScript);

    // --- Determine proxy port ---
    const detectedPort = options.port
      ? parseInt(options.port)
      : detectPortFromSource(targetScript);

    let proxyPort = detectedPort;

    if (!(await isPortAvailable(proxyPort))) {
      proxyPort = await promptForAlternativePort(proxyPort);
    }

    // Internal port for the actual app (the preload hook redirects to this)
    let internalPort = await findAvailablePort(proxyPort + 1);

    // --- Boot up ---
    logger.system('Starting...');

    let getRunnerError: (() => string) | null = null;

    const proxy = startProxy({
      proxyPort,
      targetPort: internalPort,
      getLastError: () => (typeof getRunnerError === 'function' ? getRunnerError() : ''),
    });

    const runner = startRunner({
      script: targetScript,
      port: internalPort,
      onReady: () => {
        logger.success('Server is ready!');
        proxy.broadcastReload();
      },
      onCrash: () => {
        logger.error('Server crashed! Triggering browser reload to show error...');
        proxy.broadcastReload();
      },
      onPortDetected: (newPort: number) => {
        internalPort = newPort;
        proxy.updateTargetPort(newPort);
      },
    });

    getRunnerError = runner.getLastError;

    // --- File watchers (with debounce) ---
    let serverDebounce: NodeJS.Timeout | null = null;
    let clientDebounce: NodeJS.Timeout | null = null;

    const watcher = startWatcher({
      serverWatch: buildWatchDirs(options.watchServer),
      clientWatch: buildWatchDirs(options.watchClient),
      onServerChange: (filePath: string) => {
        if (serverDebounce) clearTimeout(serverDebounce);
        serverDebounce = setTimeout(() => {
          logger.system(`Backend file changed: ${filePath}`);
          logger.system('Restarting server...');
          runner.restart();
        }, 200);
      },
      onClientChange: (filePath: string) => {
        if (clientDebounce) clearTimeout(clientDebounce);
        clientDebounce = setTimeout(() => {
          logger.system(`Frontend file changed: ${filePath}`);
          logger.system('Refreshing browser...');
          proxy.broadcastReload();
        }, 200);
      },
    });

    // --- Graceful shutdown ---
    let isShuttingDown = false;

    const shutdown = () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.system('\nShutting down liverun...');
      try { runner.kill(); } catch (_) {}
      try { watcher.close(); } catch (_) {}
      try { proxy.closeProxy(); } catch (_) {}
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message || err}`);
      shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
      shutdown();
    });
  });

program.parse(process.argv);
