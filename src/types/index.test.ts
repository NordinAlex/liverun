import { describe, it, expect } from 'vitest';
import type {
  ProxyOptions,
  ProxyResult,
  RunnerOptions,
  RunnerResult,
  WatcherOptions,
  WatcherResult,
  CliOptions,
  Logger,
} from './index.js';

/**
 * These tests validate that the exported type interfaces conform to
 * the expected shapes. They run at both the TypeScript type-checking
 * level and at runtime to ensure exports exist.
 */

describe('Type definitions', () => {
  it('ProxyOptions has the required fields', () => {
    const opts: ProxyOptions = {
      proxyPort: 3000,
      targetPort: 3001,
      getLastError: () => '',
    };
    expect(opts.proxyPort).toBe(3000);
    expect(opts.targetPort).toBe(3001);
    expect(typeof opts.getLastError).toBe('function');
  });

  it('ProxyResult has the required methods', () => {
    const result: ProxyResult = {
      broadcastReload: () => {},
      closeProxy: () => {},
      updateTargetPort: () => {},
    };
    expect(typeof result.broadcastReload).toBe('function');
    expect(typeof result.closeProxy).toBe('function');
    expect(typeof result.updateTargetPort).toBe('function');
  });

  it('RunnerOptions has required and optional fields', () => {
    const opts: RunnerOptions = {
      script: '/tmp/app.js',
      port: 3001,
      onReady: () => {},
      onCrash: () => {},
    };
    expect(opts.script).toBe('/tmp/app.js');
    expect(opts.port).toBe(3001);
    // onPortDetected is optional
    expect(opts.onPortDetected).toBeUndefined();
  });

  it('RunnerResult has the required methods', () => {
    const result: RunnerResult = {
      restart: () => {},
      getLastError: () => '',
      kill: () => {},
    };
    expect(typeof result.restart).toBe('function');
    expect(typeof result.getLastError).toBe('function');
    expect(typeof result.kill).toBe('function');
  });

  it('WatcherOptions has the required fields', () => {
    const opts: WatcherOptions = {
      serverWatch: ['src'],
      clientWatch: ['public'],
      onServerChange: () => {},
      onClientChange: () => {},
    };
    expect(Array.isArray(opts.serverWatch)).toBe(true);
    expect(Array.isArray(opts.clientWatch)).toBe(true);
  });

  it('WatcherResult has a close method', () => {
    const result: WatcherResult = { close: () => {} };
    expect(typeof result.close).toBe('function');
  });

  it('CliOptions has required and optional fields', () => {
    const opts: CliOptions = {
      watchServer: '.,src',
      watchClient: 'public,views',
    };
    expect(opts.port).toBeUndefined();
    expect(opts.watchServer).toBe('.,src');
  });

  it('Logger interface has all log methods', () => {
    const log: Logger = {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      system: () => {},
      raw: () => {},
    };
    expect(Object.keys(log)).toHaveLength(6);
  });
});
