export interface ProxyOptions {
  proxyPort: number;
  targetPort: number;
  getLastError: () => string;
}

export interface RunnerOptions {
  script: string;
  port: number;
  onReady: () => void;
  onCrash: () => void;
}

export interface WatcherOptions {
  serverWatch: string[];
  clientWatch: string[];
  onServerChange: (filePath: string) => void;
  onClientChange: (filePath: string) => void;
}
