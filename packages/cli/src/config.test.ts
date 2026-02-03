// @agentgate/cli - Config tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  getConfigDir,
  getConfigPath,
  ensureConfigDir,
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  getResolvedConfig,
} from './config.js';
import { DEFAULT_CONFIG } from './types.js';

// Mock node modules
vi.mock('node:fs');
vi.mock('node:os');

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

describe('config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getConfigDir', () => {
    it('should return ~/.agentgate path', () => {
      const result = getConfigDir();
      expect(result).toBe('/home/testuser/.agentgate');
    });

    it('should use os.homedir for home directory', () => {
      mockOs.homedir.mockReturnValue('/Users/mac');
      const result = getConfigDir();
      expect(result).toBe('/Users/mac/.agentgate');
      expect(mockOs.homedir).toHaveBeenCalled();
    });
  });

  describe('getConfigPath', () => {
    it('should return config.json in config dir', () => {
      const result = getConfigPath();
      expect(result).toBe('/home/testuser/.agentgate/config.json');
    });
  });

  describe('ensureConfigDir', () => {
    it('should create directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      ensureConfigDir();
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/home/testuser/.agentgate',
        { recursive: true }
      );
    });

    it('should not create directory if it exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      
      ensureConfigDir();
      
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('loadConfig', () => {
    it('should return defaults if config file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const config = loadConfig();
      
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should load and merge config with defaults', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        serverUrl: 'https://custom.example.com',
        apiKey: 'secret-key',
      }));
      
      const config = loadConfig();
      
      expect(config.serverUrl).toBe('https://custom.example.com');
      expect(config.apiKey).toBe('secret-key');
      expect(config.timeout).toBe(DEFAULT_CONFIG.timeout);
      expect(config.outputFormat).toBe(DEFAULT_CONFIG.outputFormat);
    });

    it('should return defaults on parse error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not valid json');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const config = loadConfig();
      
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to parse config')
      );
      consoleSpy.mockRestore();
    });

    it('should handle empty config file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');
      
      const config = loadConfig();
      
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('saveConfig', () => {
    it('should create config directory and write file', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      saveConfig({ serverUrl: 'https://example.com' });
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/home/testuser/.agentgate',
        { recursive: true }
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.agentgate/config.json',
        JSON.stringify({ serverUrl: 'https://example.com' }, null, 2),
        'utf-8'
      );
    });

    it('should preserve all config values when saving', () => {
      mockFs.existsSync.mockReturnValue(true);
      
      const fullConfig = {
        serverUrl: 'http://test.com',
        apiKey: 'key123',
        timeout: 5000,
        outputFormat: 'json' as const,
      };
      
      saveConfig(fullConfig);
      
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(fullConfig, null, 2),
        'utf-8'
      );
    });
  });

  describe('getConfigValue', () => {
    it('should return specific config value', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        serverUrl: 'http://myserver.com',
      }));
      
      const value = getConfigValue('serverUrl');
      
      expect(value).toBe('http://myserver.com');
    });

    it('should return default for unset values', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const value = getConfigValue('timeout');
      
      expect(value).toBe(DEFAULT_CONFIG.timeout);
    });
  });

  describe('setConfigValue', () => {
    it('should update single value while preserving others', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        serverUrl: 'http://old.com',
        apiKey: 'existing-key',
      }));
      
      setConfigValue('serverUrl', 'http://new.com');
      
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const savedConfig = JSON.parse(writeCall[1] as string);
      
      expect(savedConfig.serverUrl).toBe('http://new.com');
      expect(savedConfig.apiKey).toBe('existing-key');
    });

    it('should set numeric values correctly', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      setConfigValue('timeout', 10000);
      
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const savedConfig = JSON.parse(writeCall[1] as string);
      
      expect(savedConfig.timeout).toBe(10000);
    });
  });

  describe('getResolvedConfig', () => {
    it('should return all defaults when no config exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const config = getResolvedConfig();
      
      expect(config).toEqual({
        serverUrl: 'http://localhost:3000',
        apiKey: '',
        timeout: 30000,
        outputFormat: 'table',
      });
    });

    it('should merge partial config with defaults', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        serverUrl: 'https://prod.example.com',
      }));
      
      const config = getResolvedConfig();
      
      expect(config.serverUrl).toBe('https://prod.example.com');
      expect(config.apiKey).toBe('');
      expect(config.timeout).toBe(30000);
      expect(config.outputFormat).toBe('table');
    });

    it('should handle null values by falling back to defaults', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        serverUrl: null,
        timeout: null,
      }));
      
      const config = getResolvedConfig();
      
      expect(config.serverUrl).toBe('http://localhost:3000');
      expect(config.timeout).toBe(30000);
    });
  });
});
