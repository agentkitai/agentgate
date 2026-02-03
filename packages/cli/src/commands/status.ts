// @agentgate/cli - Status command

import { Command } from 'commander';
import { ApiClient, formatRequest } from '../api.js';
import { getResolvedConfig } from '../config.js';

export function createStatusCommand(): Command {
  const status = new Command('status')
    .description('Get status of a request')
    .argument('<requestId>', 'The request ID to check')
    .option('--json', 'Output as JSON')
    .action(async (requestId: string, options: { json?: boolean }) => {
      try {
        const client = new ApiClient();
        const result = await client.getRequest(requestId);

        const config = getResolvedConfig();
        const format = options.json ? 'json' : config.outputFormat;
        console.log(formatRequest(result, format));
      } catch (error) {
        console.error('Failed to get status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return status;
}
