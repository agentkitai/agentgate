# GitHub Action

The AgentGate GitHub Action allows you to request human approval before proceeding with sensitive workflow steps.

## Features

- Creates approval requests in AgentGate
- Waits for human or policy decision
- Provides GitHub context (repo, actor, workflow, etc.)
- Configurable timeout
- Outputs decision status for conditional logic

## Usage

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
          ./deploy.sh

      - name: Handle Denial
        if: steps.approval.outputs.status == 'denied'
        run: |
          echo "Deployment was denied"
          exit 1
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api_url` | AgentGate server URL | Yes | - |
| `api_key` | API key for authentication | Yes | - |
| `action_name` | Name of the action requiring approval | Yes | - |
| `params` | JSON string of parameters | No | `{}` |
| `timeout_seconds` | Timeout to wait for decision | No | `300` |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Decision: `approved`, `denied`, `expired`, or `timeout` |
| `request_id` | ID of the approval request |
| `decided_by` | Who made the decision (if applicable) |

## Context Provided

The action automatically includes GitHub context in requests:

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
  id: migration
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

- name: Run Migration
  if: steps.migration.outputs.status == 'approved'
  run: npm run db:migrate
```

### AI Agent Workflows

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

### Release Process

```yaml
- name: Request Release Approval
  id: release
  uses: your-org/agentgate-action@v1
  with:
    api_url: ${{ secrets.AGENTGATE_URL }}
    api_key: ${{ secrets.AGENTGATE_API_KEY }}
    action_name: publish_release
    params: |
      {
        "version": "${{ github.ref_name }}",
        "package": "@myorg/core"
      }
    timeout_seconds: 1800  # 30 minutes

- name: Publish to npm
  if: steps.release.outputs.status == 'approved'
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Conditional Approval

Only require approval for production:

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

## Setting Up Secrets

In your GitHub repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Add the following secrets:
   - `AGENTGATE_URL`: Your AgentGate server URL
   - `AGENTGATE_API_KEY`: An API key with `request:create` and `request:read` scopes

## Combining with Notifications

For best experience, combine with Slack or Discord notifications:

1. Configure [Slack integration](/integrations/slack)
2. When the action creates a request, approvers get notified
3. Approve/deny directly in Slack
4. Workflow continues or fails based on decision
