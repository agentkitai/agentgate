// @agentgate/cli - CLI tests

import { describe, it, expect } from 'vitest';
import { VERSION } from './version.js';
import { DEFAULT_CONFIG } from './types.js';

describe('CLI', () => {
  describe('VERSION', () => {
    it('should export version string', () => {
      expect(VERSION).toBe('0.0.1');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CONFIG.serverUrl).toBe('http://localhost:3000');
      expect(DEFAULT_CONFIG.apiKey).toBe('');
      expect(DEFAULT_CONFIG.timeout).toBe(30000);
      expect(DEFAULT_CONFIG.outputFormat).toBe('table');
    });
  });
});
