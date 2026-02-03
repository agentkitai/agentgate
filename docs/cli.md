# Command-Line Interface

The `@agentgate/cli` package provides a command-line interface for managing approval requests.

## Installation

```bash
# Global install
npm install -g @agentgate/cli

# Or run with npx
npx @agentgate/cli --help

# Or from the monorepo
pnpm --filter @agentgate/cli build
```

## Configuration

### Using Environment Variables

```bash
export AGENTGATE_URL=http://localhost:3000
export AGENTGATE_API_KEY=agk_your_api_key
```

### Using the Config Command

```bash
# Set server URL
agentgate config set serverUrl http://localhost:3000

# Set API key
agentgate config set apiKey agk_your_api_key

# View current config
agentgate config show
```

Configuration is stored in `~/.agentgate/config.json`.

## Commands

### `agentgate request <action>`

Create a new approval request.

```bash
agentgate request send_email \
  --params '{"to": "user@example.com", "subject": "Hello"}' \
  --urgency high \
  --context '{"agent": "email-bot"}'
```

**Options:**
| Option | Description |
|--------|-------------|
| `--params, -p` | JSON parameters for the action |
| `--urgency, -u` | Urgency level: `low`, `normal`, `high`, `critical` |
| `--context, -c` | Additional context (JSON) |
| `--json` | Output as JSON |

### `agentgate status <id>`

Get the status of a request.

```bash
agentgate status req_abc123
```

**Output:**
```
Request: req_abc123
Action:  send_email
Status:  pending
Urgency: high
Created: 2024-01-15T10:30:00Z
```

### `agentgate list`

List approval requests.

```bash
# List pending requests
agentgate list --status pending

# List all with limit
agentgate list --limit 20

# Filter by action
agentgate list --action send_email

# Output as JSON
agentgate list --json
```

**Options:**
| Option | Description |
|--------|-------------|
| `--status, -s` | Filter by status |
| `--action, -a` | Filter by action type |
| `--limit, -l` | Maximum results (default: 10) |
| `--offset, -o` | Pagination offset |
| `--json` | Output as JSON |

### `agentgate approve <id>`

Approve a pending request.

```bash
agentgate approve req_abc123 --reason "Looks good to me"
```

**Options:**
| Option | Description |
|--------|-------------|
| `--reason, -r` | Reason for approval |

### `agentgate deny <id>`

Deny a pending request.

```bash
agentgate deny req_abc123 --reason "Not authorized for this action"
```

**Options:**
| Option | Description |
|--------|-------------|
| `--reason, -r` | Reason for denial |

### `agentgate config`

Manage CLI configuration.

```bash
# Show current configuration
agentgate config show

# Set a value
agentgate config set serverUrl http://localhost:3000
agentgate config set apiKey agk_...

# Clear configuration
agentgate config clear
```

## Examples

### Create and Wait for Decision

```bash
# Create request and capture ID
REQUEST_ID=$(agentgate request deploy_production \
  --params '{"version": "1.2.3"}' \
  --urgency high \
  --json | jq -r '.id')

echo "Created request: $REQUEST_ID"

# Poll for decision
while true; do
  STATUS=$(agentgate status $REQUEST_ID --json | jq -r '.status')
  if [ "$STATUS" != "pending" ]; then
    echo "Decision: $STATUS"
    break
  fi
  sleep 5
done
```

### Batch Approve

```bash
# Approve all pending requests for a specific action
agentgate list --status pending --action notify_user --json | \
  jq -r '.[].id' | \
  xargs -I {} agentgate approve {} --reason "Batch approved"
```

### Integration with Scripts

```bash
#!/bin/bash

# Request approval before deployment
RESULT=$(agentgate request deploy \
  --params "{\"env\": \"production\", \"sha\": \"$GIT_SHA\"}" \
  --urgency high \
  --json)

REQUEST_ID=$(echo $RESULT | jq -r '.id')

echo "Waiting for approval: $REQUEST_ID"
echo "Dashboard: http://localhost:5173/requests/$REQUEST_ID"

# Wait up to 10 minutes
for i in {1..120}; do
  STATUS=$(agentgate status $REQUEST_ID --json | jq -r '.status')
  
  case $STATUS in
    approved)
      echo "✅ Approved! Deploying..."
      ./deploy.sh
      exit 0
      ;;
    denied)
      echo "❌ Denied. Aborting deployment."
      exit 1
      ;;
    expired)
      echo "⏰ Request expired. Aborting."
      exit 1
      ;;
  esac
  
  sleep 5
done

echo "Timeout waiting for approval"
exit 1
```

## JSON Output

All commands support `--json` for machine-readable output:

```bash
# Get JSON output
agentgate list --json

# Parse with jq
agentgate list --json | jq '.[] | select(.urgency == "critical")'
```
