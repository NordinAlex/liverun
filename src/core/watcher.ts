import chokidar from 'chokidar';
import type { WatcherOptions, WatcherResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function startWatcher({ serverWatch, clientWatch, onServerChange, onClientChange }: WatcherOptions): WatcherResult {
  // Common ignore patterns (node_modules, .git, liverun internals, etc.)
  const ignored = [/(^|[\/\\])\./, '**/node_modules/**', '**/_liverun_preload.js', '**/dist/**'];

  const serverWatcher = chokidar.watch(serverWatch, {
    ignored,
    persistent: true,
    ignoreInitial: true,
  });

  serverWatcher.on('error', (error: unknown) => {
    logger.error(`Server watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  serverWatcher.on('all', (event: string, filePath: string) => {
    // Only restart for JS/TS/JSON files
    if (filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.json')) {
      onServerChange(filePath);
    }
  });

  const clientWatcher = chokidar.watch(clientWatch, {
    ignored,
    persistent: true,
    ignoreInitial: true,
  });

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
