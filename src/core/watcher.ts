import chokidar from 'chokidar';
import { WatcherOptions } from '../types';

export function startWatcher({ serverWatch, clientWatch, onServerChange, onClientChange }: WatcherOptions) {
  // Common ignore patterns (node_modules, .git, etc.)
  const ignored = [/(^|[\/\\])\../, '**/node_modules/**'];

  const serverWatcher = chokidar.watch(serverWatch, {
    ignored,
    persistent: true,
    ignoreInitial: true,
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

  clientWatcher.on('all', (event: string, filePath: string) => {
    onClientChange(filePath);
  });
}
