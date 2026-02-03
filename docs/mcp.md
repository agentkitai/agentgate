# MCP Server

AgentGate includes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for integration with Claude Desktop and other MCP-compatible clients.

## Overview

The MCP server allows AI assistants like Claude to request human approvals naturally as part of conversations. When Claude needs to perform a sensitive action, it can use the MCP tools to request approval before proceeding.

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

::: code-group
```json [macOS]
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["@agentgate/mcp"],
      "env": {
        "AGENTGATE_URL": "http://localhost:3000",
        "AGENTGATE_API_KEY": "agk_your_api_key"
      }
    }
  }
}
```

```json [Windows]
// %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["@agentgate/mcp"],
      "env": {
        "AGENTGATE_URL": "http://localhost:3000",
        "AGENTGATE_API_KEY": "agk_your_api_key"
      }
    }
  }
}
```
:::

After saving, restart Claude Desktop.

## Available Tools

The MCP server exposes three tools:

### `request_approval`

Create a new approval request.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Action identifier |
| `params` | object | No | Action parameters |
| `context` | object | No | Additional context |
| `urgency` | string | No | `low`, `normal`, `high`, `critical` |

**Example usage in Claude:**
> "Request approval to send an email to john@example.com"

Claude will call:
```json
{
  "action": "send_email",
  "params": { "to": "john@example.com" },
  "urgency": "normal"
}
```

### `check_request`

Get the status of an approval request.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requestId` | string | Yes | Request ID to check |

**Example usage:**
> "Check the status of request req_abc123"

### `list_requests`

List pending approval requests.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status |
| `limit` | number | No | Max results (default: 10) |

**Example usage:**
> "Show me all pending approval requests"

## Conversation Example

Here's how a typical conversation might flow:

> **User:** Send an email to our investor with the Q4 report attached.
>
> **Claude:** I'll need approval to send that email. Let me request that.
> 
> *[Claude calls request_approval]*
>
> I've created approval request `req_abc123` to send the email. You can approve it in the AgentGate dashboard or Slack. Would you like me to check on the status?
>
> **User:** Yes, check if it's been approved.
>
> *[Claude calls check_request]*
>
> **Claude:** The request has been approved by @jane. I'll send the email now.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTGATE_URL` | Yes | AgentGate server URL |
| `AGENTGATE_API_KEY` | Yes | API key for authentication |

## Running Standalone

For testing or development:

```bash
# Install globally
npm install -g @agentgate/mcp

# Run directly
AGENTGATE_URL=http://localhost:3000 \
AGENTGATE_API_KEY=agk_... \
agentgate-mcp
```

## Building from Source

```bash
# From the monorepo
pnpm --filter @agentgate/mcp build

# Test locally
node packages/mcp/dist/index.js
```

## Other MCP Clients

The MCP server works with any MCP-compatible client, not just Claude Desktop. Configure it as a stdio-based MCP server pointing to `@agentgate/mcp`.
