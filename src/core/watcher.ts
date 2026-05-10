import chokidar from 'chokidar';
import { WatcherOptions } from '../types';
import { logger } from '../utils/logger';

export function startWatcher({ serverWatch, clientWatch, onServerChange, onClientChange }: WatcherOptions) {
  // Common ignore patterns (node_modules, .git, liverun internals, etc.)
  const ignored = [/(^|[\/\\])\./, '**/node_modules/**', '**/_liverun_preload.js', '**/dist/**'];

  const serverWatcher = chokidar.watch(serverWatch, {
    ignored,
    persistent: true,
    ignoreInitial: true,
  });

  serverWatcher.on('error', (error) => {
    logger.error(`Server watcher error: ${error.message || error}`);
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

  clientWatcher.on('error', (error) => {
    logger.error(`Client watcher error: ${error.message || error}`);
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
