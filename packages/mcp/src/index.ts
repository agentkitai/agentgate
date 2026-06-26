#!/usr/bin/env node
/**
 * AgentGate MCP server entrypoint
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ApiConfig } from './types.js';
import { toolDefinitions, executeGatedToolCall } from './tools.js';

const config: ApiConfig = {
  baseUrl: process.env.AGENTGATE_URL ?? 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY ?? '',
  approvalWaitMs: Number(process.env.AGENTGATE_APPROVAL_WAIT_MS ?? 0) || 0,
  approvalPollMs: Number(process.env.AGENTGATE_APPROVAL_POLL_MS ?? 2000) || 2000,
};

const server = new Server(
  { name: 'agentgate', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions],
}));

// Handle tool calls — gate on per-agent guardrails (#14), optionally waiting
// inline for an approval decision when AGENTGATE_APPROVAL_WAIT_MS > 0 (#42).
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return executeGatedToolCall(config, name, args ?? {});
});

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentGate MCP server running');
}

main().catch(console.error);
