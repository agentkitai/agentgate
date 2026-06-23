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
import { toolDefinitions, handleToolCall, authorizeTool, guardrailBlockResult } from './tools.js';

const config: ApiConfig = {
  baseUrl: process.env.AGENTGATE_URL ?? 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY ?? '',
};

const server = new Server(
  { name: 'agentgate', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions],
}));

// Handle tool calls — gate on per-agent guardrails (issue #14) before executing.
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const verdict = await authorizeTool(config, name, args ?? {});
  // deny → synchronous error; requires_approval → pending; else run the tool.
  const blocked = guardrailBlockResult(verdict);
  if (blocked) return blocked;
  return handleToolCall(config, name, args ?? {});
});

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentGate MCP server running');
}

main().catch(console.error);
