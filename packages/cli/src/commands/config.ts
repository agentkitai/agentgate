// @agentgate/cli - Config command

import { Command } from 'commander';
import { loadConfig, saveConfig, getConfigPath, setConfigValue } from '../config.js';
import type { CliConfig } from '../types.js';

export function createConfigCommand(): Command {
  const config = new Command('config')
    .description('Manage CLI configuration');

  config
    .command('show')
    .description('Show current configuration')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const currentConfig = loadConfig();
      
      if (options.json) {
        console.log(JSON.stringify(currentConfig, null, 2));
      } else {
        console.log('Configuration file:', getConfigPath());
        console.log('');
        for (const [key, value] of Object.entries(currentConfig)) {
          const displayValue = key === 'apiKey' && value ? '***' : value;
          console.log(`  ${key}: ${displayValue}`);
        }
      }
    });

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const validKeys: (keyof CliConfig)[] = ['serverUrl', 'apiKey', 'timeout', 'outputFormat'];
      
      if (!validKeys.includes(key as keyof CliConfig)) {
        console.error(`Invalid key: ${key}`);
        console.error(`Valid keys: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      let parsedValue: string | number = value;
      if (key === 'timeout') {
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue)) {
          console.error('timeout must be a number');
          process.exit(1);
        }
      }

      if (key === 'outputFormat' && !['json', 'table', 'plain'].includes(value)) {
        console.error('outputFormat must be one of: json, table, plain');
        process.exit(1);
      }

      setConfigValue(key as keyof CliConfig, parsedValue as never);
      console.log(`Set ${key} = ${key === 'apiKey' ? '***' : value}`);
    });

  config
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const currentConfig = loadConfig();
      const validKeys = Object.keys(currentConfig);
      
      if (!validKeys.includes(key)) {
        console.error(`Invalid key: ${key}`);
        console.error(`Valid keys: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      const value = currentConfig[key as keyof CliConfig];
      const displayValue = key === 'apiKey' && value ? '***' : value;
      console.log(displayValue);
    });

  config
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      saveConfig({});
      console.log('Configuration reset to defaults');
    });

  config
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(getConfigPath());
    });

  return config;
}
