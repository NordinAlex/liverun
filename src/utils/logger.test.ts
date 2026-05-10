import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from './logger.js';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('info() logs with blue ANSI prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test message');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[liverun]');
    expect(spy.mock.calls[0][0]).toContain('test message');
    // Blue ANSI code \x1b[34m
    expect(spy.mock.calls[0][0]).toContain('\x1b[34m');
  });

  it('success() logs with green ANSI prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.success('done');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('\x1b[32m');
    expect(spy.mock.calls[0][0]).toContain('done');
  });

  it('warn() uses console.warn with yellow ANSI prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('careful');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('\x1b[33m');
    expect(spy.mock.calls[0][0]).toContain('careful');
  });

  it('error() uses console.error with red ANSI prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('fail');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('\x1b[31m');
    expect(spy.mock.calls[0][0]).toContain('Error:');
    expect(spy.mock.calls[0][0]).toContain('fail');
  });

  it('system() logs with plain prefix (no color)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.system('booting');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe('[liverun] booting');
  });

  it('raw() logs without any prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.raw('plain text');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe('plain text');
  });
});
