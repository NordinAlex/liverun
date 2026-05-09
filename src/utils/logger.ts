export const logger = {
  info: (message: string) => console.log(`\x1b[34m[liverun]\x1b[0m ${message}`),
  success: (message: string) => console.log(`\x1b[32m[liverun]\x1b[0m ${message}`),
  warn: (message: string) => console.warn(`\x1b[33m[liverun]\x1b[0m ${message}`),
  error: (message: string) => console.error(`\x1b[31m[liverun] Error:\x1b[0m ${message}`),
  system: (message: string) => console.log(`[liverun] ${message}`),
  raw: (message: string) => console.log(message),
};
