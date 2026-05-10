/** Options for the HTTP proxy server */
export interface ProxyOptions {
  /** Port the proxy listens on (user-facing) */
  proxyPort: number;
  /** Port the actual app server listens on (internal) */
  targetPort: number;
  /** Returns the latest stderr output from the app process */
  getLastError: () => string;
}

/** Object returned by startProxy() */
export interface ProxyResult {
  /** Send a reload message to all connected browser clients */
  broadcastReload: () => void;
  /** Gracefully shut down the proxy, HTTP server, and WebSocket server */
  closeProxy: () => void;
  /** Update the target port the proxy forwards traffic to */
  updateTargetPort: (newPort: number) => void;
}

/** Options for the child process runner */
export interface RunnerOptions {
  /** Absolute path to the script to execute */
  script: string;
  /** Internal port the app should listen on */
  port: number;
  /** Called when the app's port becomes reachable */
  onReady: () => void;
  /** Called when the app process exits with a non-zero code */
  onCrash: () => void;
  /** Called when the preload hook detects a port change (e.g. EADDRINUSE retry) */
  onPortDetected?: (port: number) => void;
}

/** Object returned by startRunner() */
export interface RunnerResult {
  /** Kill the current process and spawn a new one */
  restart: () => void;
  /** Returns the accumulated stderr output */
  getLastError: () => string;
  /** Kill the child process and clean up the preload script */
  kill: () => void;
}

/** Options for the file system watcher */
export interface WatcherOptions {
  /** Directories to watch for server-side file changes (triggers restart) */
  serverWatch: string[];
  /** Directories to watch for client-side file changes (triggers reload) */
  clientWatch: string[];
  /** Called when a server-side file changes */
  onServerChange: (filePath: string) => void;
  /** Called when a client-side file changes */
  onClientChange: (filePath: string) => void;
}

/** Object returned by startWatcher() */
export interface WatcherResult {
  /** Stop watching and release file system handles */
  close: () => void;
}

/** CLI options parsed by Commander */
export interface CliOptions {
  /** Custom proxy port (overrides auto-detection) */
  port?: string;
  /** Comma-separated directories to watch for server restart */
  watchServer: string;
  /** Comma-separated directories to watch for client refresh */
  watchClient: string;
}

/** Logger interface */
export interface Logger {
  info: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  system: (message: string) => void;
  raw: (message: string) => void;
}
