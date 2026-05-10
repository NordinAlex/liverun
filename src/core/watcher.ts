import chokidar, { type ChokidarOptions } from 'chokidar';
import path from 'path';
import type { WatcherOptions, WatcherResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// File extensions that should trigger a server restart
const SERVER_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs', '.json']);

// Patterns to ignore across all watchers
const IGNORED = [
  /(^|[\/\\])\./,          // Dotfiles and directories (.git, .env, etc.)
  '**/node_modules/**',
  '**/dist/**',
  '**/package-lock.json',
];

/**
 * Returns the file extension (e.g. '.js') or an empty string for extensionless files.
 */
function getExtension(filePath: string): string {
  const base = path.basename(filePath);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(dotIndex) : '';
}

export function startWatcher({ serverWatch, clientWatch, onServerChange, onClientChange }: WatcherOptions): WatcherResult {
  const watcherOptions: ChokidarOptions = {
    ignored: IGNORED,
    persistent: true,
    ignoreInitial: true,
  };

  const serverWatcher = chokidar.watch(serverWatch, watcherOptions);

  serverWatcher.on('error', (error: unknown) => {
    logger.error(`Server watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  serverWatcher.on('all', (event: string, filePath: string) => {
    // Restart for known server extensions and extensionless files (e.g. bin/www)
    const ext = getExtension(filePath);
    if (SERVER_EXTENSIONS.has(ext) || ext === '') {
      onServerChange(filePath);
    }
  });

  const clientWatcher = chokidar.watch(clientWatch, watcherOptions);

  clientWatcher.on('error', (error: unknown) => {
    logger.error(`Client watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  clientWatcher.on('all', (event: string, filePath: string) => {
    onClientChange(filePath);
  });

  return {
    close: () => {
      serverWatcher.close();
      clientWatcher.close();
    }
  };
}

