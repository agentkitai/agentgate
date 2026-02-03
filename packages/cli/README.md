# @agentgate/cli

Command-line interface for AgentGate approval management.

## Installation

```bash
pnpm add -g @agentgate/cli
```

## Usage

### Configuration

```bash
# Show current configuration
agentgate config show

# Set server URL
agentgate config set serverUrl http://localhost:3000

# Set API key
agentgate config set apiKey your-api-key

# Set output format (json, table, plain)
agentgate config set outputFormat table

# Show config file path
agentgate config path
```

### Creating Requests

```bash
# Create a simple request
agentgate request send_email

# Create a request with parameters
agentgate request transfer_funds -p '{"amount": 1000, "to": "user@example.com"}'

# Create an urgent request
agentgate request deploy_production -u critical
```

### Viewing Requests

```bash
# Get status of a specific request
agentgate status <request-id>

# List all requests
agentgate list

# List pending requests
agentgate list -s pending

# List with pagination
agentgate list -l 10 -o 20
```

### Approving/Denying Requests

```bash
# Approve a request
agentgate approve <request-id>

# Approve with reason
agentgate approve <request-id> -r "Looks good"

# Deny a request
agentgate deny <request-id>

# Deny with reason
agentgate deny <request-id> -r "Not authorized"
```

### Output Formats

All commands support `--json` flag for JSON output:

```bash
agentgate list --json
agentgate status <request-id> --json
```

## Configuration File

Configuration is stored in `~/.agentgate/config.json`:

```json
{
  "serverUrl": "http://localhost:3000",
  "apiKey": "your-api-key",
  "timeout": 30000,
  "outputFormat": "table"
}
```

## API

The CLI can also be used programmatically:

```typescript
import { ApiClient, loadConfig } from '@agentgate/cli';

const client = new ApiClient();
const requests = await client.listRequests({ status: 'pending' });
```
