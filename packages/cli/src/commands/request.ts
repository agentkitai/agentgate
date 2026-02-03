// @agentgate/cli - Request command

import { Command } from 'commander';
import { ApiClient, formatRequest } from '../api.js';
import { getResolvedConfig } from '../config.js';

export function createRequestCommand(): Command {
  const request = new Command('request')
    .description('Create a new approval request')
    .argument('<action>', 'The action to request approval for')
    .option('-p, --params <json>', 'Parameters as JSON string', '{}')
    .option('-c, --context <json>', 'Context as JSON string', '{}')
    .option('-u, --urgency <level>', 'Urgency level (low, normal, high, critical)', 'normal')
    .option('--json', 'Output as JSON')
    .action(async (action: string, options: {
      params: string;
      context: string;
      urgency: string;
      json?: boolean;
    }) => {
      try {
        let params: Record<string, unknown>;
        let context: Record<string, unknown>;

        try {
          params = JSON.parse(options.params) as Record<string, unknown>;
        } catch {
          console.error('Invalid JSON for params');
          process.exit(1);
        }

        try {
          context = JSON.parse(options.context) as Record<string, unknown>;
        } catch {
          console.error('Invalid JSON for context');
          process.exit(1);
        }

        const urgency = options.urgency as 'low' | 'normal' | 'high' | 'critical';
        if (!['low', 'normal', 'high', 'critical'].includes(urgency)) {
          console.error('Invalid urgency level. Must be: low, normal, high, critical');
          process.exit(1);
        }

        const client = new ApiClient();
        const result = await client.createRequest({
          action,
          params,
          context,
          urgency,
        });

        const config = getResolvedConfig();
        const format = options.json ? 'json' : config.outputFormat;
        console.log(formatRequest(result, format));
      } catch (error) {
        console.error('Failed to create request:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return request;
}
