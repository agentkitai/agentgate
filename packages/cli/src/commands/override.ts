// @agentgate/cli - Override command (per-agent dynamic guardrails, #14)

import { Command } from 'commander';
import { ApiClient, formatOverrideList, type OverrideAction } from '../api.js';
import { getResolvedConfig } from '../config.js';

const ACTIONS: OverrideAction[] = ['require_approval', 'deny'];

export function createOverrideCommand(): Command {
  const override = new Command('override').description('Manage per-agent tool override guardrails');

  override
    .command('create')
    .description('Create an override that gates a tool for an agent')
    .requiredOption('-a, --agent <id>', 'Verified agent id (agt_...)')
    .requiredOption('-t, --tool <pattern>', 'Tool name or glob pattern (e.g. "fs.*")')
    .option('--action <action>', 'require_approval | deny', 'require_approval')
    .option('-r, --reason <reason>', 'Why the override exists')
    .option('--ttl <seconds>', 'Expire after N seconds (default: no expiry)')
    .option('--json', 'Output as JSON')
    .action(async (options: {
      agent: string;
      tool: string;
      action: string;
      reason?: string;
      ttl?: string;
      json?: boolean;
    }) => {
      try {
        if (!ACTIONS.includes(options.action as OverrideAction)) {
          console.error(`Invalid action. Must be: ${ACTIONS.join(', ')}`);
          process.exit(1);
        }
        let ttlSeconds: number | undefined;
        if (options.ttl !== undefined) {
          ttlSeconds = parseInt(options.ttl, 10);
          if (isNaN(ttlSeconds) || ttlSeconds <= 0) {
            console.error('Invalid --ttl. Must be a positive number of seconds.');
            process.exit(1);
          }
        }

        const created = await new ApiClient().createOverride({
          agentId: options.agent,
          toolPattern: options.tool,
          action: options.action as OverrideAction,
          reason: options.reason,
          ttlSeconds,
        });

        const format = options.json || getResolvedConfig().outputFormat === 'json' ? 'json' : 'plain';
        console.log(formatOverrideList([created], format));
      } catch (error) {
        console.error('Failed to create override:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  override
    .command('list')
    .description('List active overrides')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const { overrides } = await new ApiClient().listOverrides();
        const format = options.json || getResolvedConfig().outputFormat === 'json' ? 'json' : 'plain';
        console.log(formatOverrideList(overrides, format));
      } catch (error) {
        console.error('Failed to list overrides:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  override
    .command('rm <id>')
    .description('Delete an override by id')
    .action(async (id: string) => {
      try {
        await new ApiClient().deleteOverride(id);
        console.log(`Deleted override ${id}`);
      } catch (error) {
        console.error('Failed to delete override:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return override;
}
