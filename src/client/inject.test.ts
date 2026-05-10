import { describe, it, expect } from 'vitest';
import { injectScriptContent } from './inject.js';

describe('injectScriptContent', () => {
  it('is a non-empty string', () => {
    expect(typeof injectScriptContent).toBe('string');
    expect(injectScriptContent.length).toBeGreaterThan(0);
  });

  it('contains WebSocket connection logic', () => {
    expect(injectScriptContent).toContain('WebSocket');
    expect(injectScriptContent).toContain('/_live_dev_ws');
  });

  it('handles the RELOAD message type', () => {
    expect(injectScriptContent).toContain("'RELOAD'");
    expect(injectScriptContent).toContain('window.location.reload()');
  });

  it('implements reconnection with exponential backoff', () => {
    expect(injectScriptContent).toContain('reconnectAttempts');
    expect(injectScriptContent).toContain('setTimeout');
  });

  it('is a self-executing IIFE', () => {
    expect(injectScriptContent).toMatch(/^\(function\(\)\s*\{/);
    expect(injectScriptContent).toMatch(/\}\)\(\);?\s*$/);
  });

  it('selects the correct WS protocol based on page protocol', () => {
    expect(injectScriptContent).toContain("'wss:'");
    expect(injectScriptContent).toContain("'ws:'");
  });
});
