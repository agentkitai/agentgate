// @agentgate/cli - List command

import { Command } from 'commander';
import { ApiClient, formatRequestList } from '../api.js';
import { getResolvedConfig } from '../config.js';

export function createListCommand(): Command {
  const list = new Command('list')
    .description('List approval requests')
    .option('-s, --status <status>', 'Filter by status (pending, approved, denied, expired)')
    .option('-l, --limit <number>', 'Maximum number of results', '20')
    .option('-o, --offset <number>', 'Offset for pagination', '0')
    .option('--json', 'Output as JSON')
    .action(async (options: {
      status?: string;
      limit: string;
      offset: string;
      json?: boolean;
    }) => {
      try {
        if (options.status && !['pending', 'approved', 'denied', 'expired'].includes(options.status)) {
          console.error('Invalid status. Must be: pending, approved, denied, expired');
          process.exit(1);
        }

        const limit = parseInt(options.limit, 10);
        const offset = parseInt(options.offset, 10);

        if (isNaN(limit) || limit < 1) {
          console.error('Invalid limit. Must be a positive number.');
          process.exit(1);
        }

        if (isNaN(offset) || offset < 0) {
          console.error('Invalid offset. Must be a non-negative number.');
          process.exit(1);
        }

        const client = new ApiClient();
        const { requests, pagination } = await client.listRequests({
          status: options.status as 'pending' | 'approved' | 'denied' | 'expired' | undefined,
          limit,
          offset,
        });

        const config = getResolvedConfig();
        const format = options.json ? 'json' : config.outputFormat;
        console.log(formatRequestList(requests, format));
        
        if (format !== 'json' && pagination.hasMore) {
          console.log(`\nShowing ${requests.length} of ${pagination.total} requests. Use --offset to paginate.`);
        }
      } catch (error) {
        console.error('Failed to list requests:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return list;
}
