// @agentgate/cli - Approve command

import { Command } from 'commander';
import { ApiClient, formatRequest } from '../api.js';
import { getResolvedConfig } from '../config.js';

export function createApproveCommand(): Command {
  const approve = new Command('approve')
    .description('Approve a pending request')
    .argument('<requestId>', 'The request ID to approve')
    .option('-r, --reason <reason>', 'Reason for approval')
    .option('-b, --by <name>', 'Who is approving (default: cli)')
    .option('--json', 'Output as JSON')
    .action(async (requestId: string, options: { reason?: string; by?: string; json?: boolean }) => {
      try {
        const client = new ApiClient();
        const result = await client.approveRequest({
          requestId,
          reason: options.reason,
          decidedBy: options.by,
        });

        const config = getResolvedConfig();
        const format = options.json ? 'json' : config.outputFormat;
        console.log(formatRequest(result, format));
        console.log('\n✅ Request approved successfully');
      } catch (error) {
        console.error('Failed to approve request:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return approve;
}
