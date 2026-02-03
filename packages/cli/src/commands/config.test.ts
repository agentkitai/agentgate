// @agentgate/cli - Config command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConfigCommand } from './config.js';

// Mock the config module
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn(() => '/home/test/.agentgate/config.json'),
  setConfigValue: vi.fn(),
}));

import { loadConfig, saveConfig, setConfigValue } from '../config.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockSetConfigValue = vi.mocked(setConfigValue);

describe('createConfigCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('show subcommand', () => {
    it('should display current config', async () => {
      mockLoadConfig.mockReturnValue({
        serverUrl: 'http://localhost:3000',
        apiKey: '',
        timeout: 30000,
        outputFormat: 'table',
      });

      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'show']);

      expect(consoleSpy).toHaveBeenCalledWith('Configuration file:', '/home/test/.agentgate/config.json');
      expect(consoleSpy).toHaveBeenCalledWith('  serverUrl: http://localhost:3000');
      expect(consoleSpy).toHaveBeenCalledWith('  timeout: 30000');
    });

    it('should mask apiKey in display', async () => {
      mockLoadConfig.mockReturnValue({
        serverUrl: 'http://localhost:3000',
        apiKey: 'secret-api-key-12345',
        timeout: 30000,
        outputFormat: 'table',
      });

      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'show']);

      expect(consoleSpy).toHaveBeenCalledWith('  apiKey: ***');
    });

    it('should output JSON with --json flag', async () => {
      const config = {
        serverUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        timeout: 30000,
        outputFormat: 'table' as const,
      };
      mockLoadConfig.mockReturnValue(config);

      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'show', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(config, null, 2));
    });
  });

  describe('set subcommand', () => {
    it('should set serverUrl', async () => {
      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'set', 'serverUrl', 'https://example.com']);

      expect(mockSetConfigValue).toHaveBeenCalledWith('serverUrl', 'https://example.com');
      expect(consoleSpy).toHaveBeenCalledWith('Set serverUrl = https://example.com');
    });

    it('should set apiKey and mask in output', async () => {
      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'set', 'apiKey', 'my-secret-key']);

      expect(mockSetConfigValue).toHaveBeenCalledWith('apiKey', 'my-secret-key');
      expect(consoleSpy).toHaveBeenCalledWith('Set apiKey = ***');
    });

    it('should parse timeout as number', async () => {
      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'set', 'timeout', '60000']);

      expect(mockSetConfigValue).toHaveBeenCalledWith('timeout', 60000);
    });

    it('should reject invalid timeout value', async () => {
      const cmd = createConfigCommand();

      await expect(
        cmd.parseAsync(['node', 'test', 'set', 'timeout', 'not-a-number'])
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith('timeout must be a number');
    });

    it('should reject invalid key', async () => {
      const cmd = createConfigCommand();

      await expect(
        cmd.parseAsync(['node', 'test', 'set', 'invalidKey', 'value'])
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid key: invalidKey');
    });

    it('should reject invalid outputFormat', async () => {
      const cmd = createConfigCommand();

      await expect(
        cmd.parseAsync(['node', 'test', 'set', 'outputFormat', 'xml'])
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'outputFormat must be one of: json, table, plain'
      );
    });

    it('should accept valid outputFormat values', async () => {
      const cmd = createConfigCommand();
      
      await cmd.parseAsync(['node', 'test', 'set', 'outputFormat', 'json']);
      expect(mockSetConfigValue).toHaveBeenCalledWith('outputFormat', 'json');

      await cmd.parseAsync(['node', 'test', 'set', 'outputFormat', 'plain']);
      expect(mockSetConfigValue).toHaveBeenCalledWith('outputFormat', 'plain');

      await cmd.parseAsync(['node', 'test', 'set', 'outputFormat', 'table']);
      expect(mockSetConfigValue).toHaveBeenCalledWith('outputFormat', 'table');
    });
  });

  describe('get subcommand', () => {
    it('should get a specific value', async () => {
      mockLoadConfig.mockReturnValue({
        serverUrl: 'http://myserver.com',
        timeout: 5000,
      });

      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'get', 'serverUrl']);

      expect(consoleSpy).toHaveBeenCalledWith('http://myserver.com');
    });

    it('should mask apiKey value', async () => {
      mockLoadConfig.mockReturnValue({
        apiKey: 'secret-key',
      });

      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'get', 'apiKey']);

      expect(consoleSpy).toHaveBeenCalledWith('***');
    });

    it('should reject invalid key', async () => {
      mockLoadConfig.mockReturnValue({
        serverUrl: 'http://localhost:3000',
      });

      const cmd = createConfigCommand();

      await expect(
        cmd.parseAsync(['node', 'test', 'get', 'unknownKey'])
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid key: unknownKey');
    });
  });

  describe('reset subcommand', () => {
    it('should save empty config', async () => {
      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'reset']);

      expect(mockSaveConfig).toHaveBeenCalledWith({});
      expect(consoleSpy).toHaveBeenCalledWith('Configuration reset to defaults');
    });
  });

  describe('path subcommand', () => {
    it('should print config path', async () => {
      const cmd = createConfigCommand();
      await cmd.parseAsync(['node', 'test', 'path']);

      expect(consoleSpy).toHaveBeenCalledWith('/home/test/.agentgate/config.json');
    });
  });
});
