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

program
  .version('0.5.2')
  .argument('<script>', 'The express server script to run (e.g. server.js)')
  .option('-p, --port <number>', 'Port for the live-dev proxy to listen on')
  .option('-s, --watch-server <directories>', 'Comma separated directories to watch for server restart', '.,src,routes,models,controllers')
  .option('-c, --watch-client <directories>', 'Comma separated directories to watch for client refresh', 'public,views')
  .action(async (script: string, options: CliOptions) => {
    const targetScript = path.resolve(process.cwd(), script);
    const targetDir = path.dirname(targetScript);

    // Validate that the script file exists
    if (!fs.existsSync(targetScript)) {
      logger.error(`Script not found: ${targetScript}`);
      process.exit(1);
    }

    // --- Port detection from source code ---
    let defaultProxyPort = 3000;

    if (!options.port) {
      try {
        const rawContent = fs.readFileSync(targetScript, 'utf8');

        // Strip comments so we don't match ports in commented-out code
        const content = rawContent
          .replace(/\/\/.*$/gm, '')       // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

        // Check for process.env.PORT usage
        const envPortMatch = content.match(/process\.env\.PORT\s*\|\|\s*['"]?(\d+)['"]?/);
        // Check for hardcoded .listen(number) — a literal number passed directly
        const listenMatch = content.match(/\.listen\(\s*['"]?(\d+)['"]?/);
        // Check for PORT = <number> (hardcoded constant)
        const constPortMatch = content.match(/(?:const|let|var)\s*(?:PORT|port)\s*=\s*['"]?(\d+)['"]?/);

        if (envPortMatch) {
          defaultProxyPort = parseInt(envPortMatch[1], 10);
        } else if (listenMatch) {
          defaultProxyPort = parseInt(listenMatch[1], 10);
        } else if (constPortMatch) {
          defaultProxyPort = parseInt(constPortMatch[1], 10);
        }
      } catch (err) { }
    }

    let proxyPort = options.port ? parseInt(options.port) : defaultProxyPort;

    const checkPort = (p: number): Promise<boolean> => {
      return new Promise(resolve => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => { srv.close(); resolve(true); });
        srv.listen(p);
      });
    };

    // Find an available port starting from the given one
    const findAvailablePort = async (startPort: number): Promise<number> => {
      let p = startPort;
      while (!(await checkPort(p))) {
        p++;
      }
      return p;
    };

    if (!(await checkPort(proxyPort))) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => {
        rl.question(`Port ${proxyPort} is already in use. Would you like to run the app on another available port? (y/n) `, ans => {
          rl.close();
          resolve(ans);
        });
      });
      if (answer.toLowerCase().startsWith('y')) {
        proxyPort = await findAvailablePort(proxyPort + 1);
      } else {
        logger.error(`Cannot start server because port ${proxyPort} is in use.`);
        process.exit(1);
      }
    }

    // Internal port for the actual express server (the preload hook redirects to this)
    let internalPort = await findAvailablePort(proxyPort + 1);

    // Helper to watch both relative to cwd and relative to the target script's directory
    const getWatchDirs = (dirsString: string) => {
      const dirs = dirsString.split(',').map((s: string) => s.trim()).filter(Boolean);
      return Array.from(new Set([
        ...dirs,
        ...dirs.map(d => path.resolve(targetDir, d))
      ]));
    };

    logger.system('Starting...');
    let getRunnerError: (() => string) | null = null;

    const wss = startProxy({
      proxyPort: proxyPort,
      targetPort: internalPort,
      getLastError: () => typeof getRunnerError === 'function' ? getRunnerError() : ''
    });

    const runner = startRunner({
      script: targetScript,
      port: internalPort,
      onReady: () => {
        logger.success('Server is ready!');
        wss.broadcastReload();
      },
      onCrash: () => {
        logger.error('Server crashed! Triggering browser reload to show error...');
        wss.broadcastReload();
      },
      onPortDetected: (newPort: number) => {
        // The child process couldn't bind to the internal port and retried on a new one
        // Update the proxy to forward to the new port
        internalPort = newPort;
        wss.updateTargetPort(newPort);
      }
    });

    getRunnerError = runner.getLastError;

    let serverTimeout: NodeJS.Timeout | null = null;
    let clientTimeout: NodeJS.Timeout | null = null;

    const watcher = startWatcher({
      serverWatch: getWatchDirs(options.watchServer),
      clientWatch: getWatchDirs(options.watchClient),
      onServerChange: (filePath: string) => {
        if (serverTimeout) clearTimeout(serverTimeout);
        serverTimeout = setTimeout(() => {
          logger.system(`Backend file changed: ${filePath}`);
          logger.system('Restarting server...');
          runner.restart();
        }, 200);
      },
      onClientChange: (filePath: string) => {
        if (clientTimeout) clearTimeout(clientTimeout);
        clientTimeout = setTimeout(() => {
          logger.system(`Frontend file changed: ${filePath}`);
          logger.system('Refreshing browser...');
          wss.broadcastReload();
        }, 200);
      }
    });

    let isShuttingDown = false;
    const shutdown = () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.system('\nShutting down liverun...');
      try { runner.kill(); } catch (e) {}
      try { watcher.close(); } catch (e) {}
      try { wss.closeProxy(); } catch (e) {}
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
