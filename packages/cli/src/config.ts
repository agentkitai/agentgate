// @agentgate/cli - Configuration management

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CliConfig, DEFAULT_CONFIG } from './types.js';

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.agentgate');
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Ensure the config directory exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load configuration from disk
 */
export function loadConfig(): CliConfig {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<CliConfig>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    console.error(`Warning: Failed to parse config at ${configPath}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to disk
 */
export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get a single configuration value
 */
export function getConfigValue<K extends keyof CliConfig>(key: K): CliConfig[K] {
  const config = loadConfig();
  return config[key];
}

/**
 * Set a single configuration value
 */
export function setConfigValue<K extends keyof CliConfig>(key: K, value: CliConfig[K]): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

/**
 * Get the resolved configuration with all defaults applied
 */
export function getResolvedConfig(): Required<CliConfig> {
  const config = loadConfig();
  return {
    serverUrl: config.serverUrl ?? DEFAULT_CONFIG.serverUrl,
    apiKey: config.apiKey ?? DEFAULT_CONFIG.apiKey,
    timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    outputFormat: config.outputFormat ?? DEFAULT_CONFIG.outputFormat,
  };
}
