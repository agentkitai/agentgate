#!/usr/bin/env node
// @agentgate/cli - CLI entry point

import { Command } from 'commander';
import {
  createConfigCommand,
  createRequestCommand,
  createStatusCommand,
  createListCommand,
  createApproveCommand,
  createDenyCommand,
} from './commands/index.js';

const program = new Command();

program
  .name('agentgate')
  .description('CLI for AgentGate approval management')
  .version('0.0.1');

// Add commands
program.addCommand(createConfigCommand());
program.addCommand(createRequestCommand());
program.addCommand(createStatusCommand());
program.addCommand(createListCommand());
program.addCommand(createApproveCommand());
program.addCommand(createDenyCommand());

// Parse and run
program.parse();
