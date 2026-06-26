# @agentkitai/agentgate-mcp

MCP (Model Context Protocol) server for AgentGate. Enables Claude and other MCP-compatible AI assistants to request approvals.

## Installation

```bash
npm install -g @agentkitai/agentgate-mcp
```

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["@agentkitai/agentgate-mcp"],
      "env": {
        "AGENTGATE_URL": "http://localhost:3000",
        "AGENTGATE_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Available Tools

- **agentgate_request** - Submit an approval request
- **agentgate_get** - Check request status
- **agentgate_list** - List requests with filters
- **agentgate_decide** - Approve or deny (for agent-approvers)

## Environment Variables

- `AGENTGATE_URL` - AgentGate server URL (default: http://localhost:3000)
- `AGENTGATE_API_KEY` - API key for authentication
