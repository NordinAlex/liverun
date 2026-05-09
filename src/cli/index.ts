#!/usr/bin/env node

// Override util._extend with Object.assign to prevent DEP0060 warning from http-proxy
import util from 'util';
if ((util as any)._extend) {
  (util as any)._extend = Object.assign;
}

import { program } from 'commander';
import path from 'path';
import { startProxy } from '../core/proxy';
import { startWatcher } from '../core/watcher';
import { startRunner } from '../core/runner';
import { logger } from '../utils/logger';

program
  .version('0.5.0')
  .argument('<script>', 'The express server script to run (e.g. server.js)')
  .option('-p, --port <number>', 'Port for the live-dev proxy to listen on', '3000')
  .option('-s, --watch-server <directories>', 'Comma separated directories to watch for server restart', '.,src,routes,models,controllers')
  .option('-c, --watch-client <directories>', 'Comma separated directories to watch for client refresh', 'public,views')
  .action((script: string, options: any) => {
    const targetScript = path.resolve(process.cwd(), script);
    const targetDir = path.dirname(targetScript);
    
    // Internal port for the actual express server
    const internalPort = parseInt(options.port) + 1;
    
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
      proxyPort: parseInt(options.port),
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
      }
    });
    
    getRunnerError = runner.getLastError;
    
    startWatcher({
      serverWatch: getWatchDirs(options.watchServer),
      clientWatch: getWatchDirs(options.watchClient),
      onServerChange: (filePath: string) => {
        logger.system(`Backend file changed: ${filePath}`);
        logger.system('Restarting server...');
        runner.restart();
      },
      onClientChange: (filePath: string) => {
        logger.system(`Frontend file changed: ${filePath}`);
        logger.system('Refreshing browser...');
        wss.broadcastReload();
      }
    });
  });

program.parse(process.argv);
