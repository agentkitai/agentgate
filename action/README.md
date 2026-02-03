# AgentGate GitHub Action

Request approval from AgentGate before proceeding with sensitive workflow steps.

## Features

- Creates an approval request in AgentGate
- Waits for human or policy decision
- Provides GitHub Actions context (repo, actor, workflow, etc.)
- Configurable timeout
- Outputs decision status for conditional logic

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api_url` | AgentGate server URL | Yes | - |
| `api_key` | API key for authentication | Yes | - |
| `action_name` | Name of the action requiring approval | Yes | - |
| `params` | JSON string of parameters for the action | No | `{}` |
| `timeout_seconds` | Timeout in seconds to wait for decision | No | `300` |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Decision status: `approved`, `denied`, `expired`, or `timeout` |
| `request_id` | ID of the approval request |
| `decided_by` | Who made the decision (if applicable) |

## Example Workflow

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm run build

      - name: Request Deployment Approval
        id: approval
        uses: your-org/agentgate-action@v1
        with:
          api_url: ${{ secrets.AGENTGATE_URL }}
          api_key: ${{ secrets.AGENTGATE_API_KEY }}
          action_name: deploy_production
          params: |
            {
              "environment": "production",
              "version": "${{ github.sha }}"
            }
          timeout_seconds: 600

      - name: Deploy
        if: steps.approval.outputs.status == 'approved'
        run: |
          echo "Deploying to production..."
          echo "Approved by: ${{ steps.approval.outputs.decided_by }}"
          # Your deployment commands here

      - name: Handle Denial
        if: steps.approval.outputs.status == 'denied'
        run: |
          echo "Deployment was denied"
          exit 1
```

## Context Provided to AgentGate

The action automatically includes GitHub context in the approval request:

```json
{
  "github": {
    "repository": "my-repo",
    "owner": "my-org",
    "ref": "refs/heads/main",
    "sha": "abc123...",
    "workflow": "Deploy to Production",
    "runId": 12345,
    "runNumber": 42,
    "actor": "octocat",
    "eventName": "push",
    "job": "deploy"
  },
  "environment": {
    "runner_os": "Linux",
    "runner_arch": "X64"
  }
}
```

## Use Cases

### Database Migrations

```yaml
- name: Request Migration Approval
  uses: your-org/agentgate-action@v1
  with:
    api_url: ${{ secrets.AGENTGATE_URL }}
    api_key: ${{ secrets.AGENTGATE_API_KEY }}
    action_name: run_migration
    params: |
      {
        "database": "production",
        "migration": "${{ env.MIGRATION_NAME }}"
      }
```

### AI Agent Actions

```yaml
- name: Approve Agent Action
  uses: your-org/agentgate-action@v1
  with:
    api_url: ${{ secrets.AGENTGATE_URL }}
    api_key: ${{ secrets.AGENTGATE_API_KEY }}
    action_name: ${{ env.AGENT_ACTION }}
    params: ${{ env.AGENT_PARAMS }}
    timeout_seconds: 300
```

### Conditional Approval

```yaml
- name: Request Approval (Production Only)
  if: github.ref == 'refs/heads/main'
  uses: your-org/agentgate-action@v1
  with:
    api_url: ${{ secrets.AGENTGATE_URL }}
    api_key: ${{ secrets.AGENTGATE_API_KEY }}
    action_name: deploy
    params: '{"env": "production"}'
```

## Building

```bash
# Install dependencies
pnpm install

# Build the action (compiles to dist/)
pnpm build

# Run tests
pnpm test
```

## License

MIT
