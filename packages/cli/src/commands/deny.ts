// @agentgate/cli - Deny command

import { Command } from 'commander';
import { ApiClient, formatRequest } from '../api.js';
import { getResolvedConfig } from '../config.js';

export function createDenyCommand(): Command {
  const deny = new Command('deny')
    .description('Deny a pending request')
    .argument('<requestId>', 'The request ID to deny')
    .option('-r, --reason <reason>', 'Reason for denial')
    .option('-b, --by <name>', 'Who is denying (default: cli)')
    .option('--json', 'Output as JSON')
    .action(async (requestId: string, options: { reason?: string; by?: string; json?: boolean }) => {
      try {
        const client = new ApiClient();
        const result = await client.denyRequest({
          requestId,
          reason: options.reason,
          decidedBy: options.by,
        });

        const config = getResolvedConfig();
        const format = options.json ? 'json' : config.outputFormat;
        console.log(formatRequest(result, format));
        console.log('\n❌ Request denied');
      } catch (error) {
        console.error('Failed to deny request:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return deny;
}
