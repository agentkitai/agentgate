# AgentGate CDK Infrastructure

AWS CDK v2 stack for deploying AgentGate to ECS Fargate.

## Architecture

- **ECS Fargate** — runs the AgentGate Docker image
- **Application Load Balancer** — internet-facing, health checks on `/health`
- **RDS Postgres 16** — primary database
- **ElastiCache Redis** — rate limiting & caching
- **Secrets Manager** — `ADMIN_API_KEY`, `JWT_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`
- **VPC** — 2 AZs, private subnets for compute/data, public for ALB

## Prerequisites

- Node.js 20+
- AWS CLI configured with appropriate credentials
- CDK CLI: `npm install -g aws-cdk`
- Docker (for building the container image)

## Setup

```bash
cd infra
npm install
```

## Context Values

| Context Key      | Values                  | Default   | Description                         |
|------------------|-------------------------|-----------|-------------------------------------|
| `env`            | `staging`, `production` | `staging` | Environment name                    |
| `architecture`   | `ARM64`, `x86_64`       | `ARM64`   | CPU architecture for Fargate tasks  |

## Commands

```bash
# Synthesize CloudFormation template
npx cdk synth --context env=staging

# Diff against deployed stack
npx cdk diff --context env=staging

# Deploy (staging)
npx cdk deploy --context env=staging

# Deploy (production)
npx cdk deploy --context env=production

# Deploy with x86_64 architecture
npx cdk deploy --context env=staging --context architecture=x86_64
```

## Environment Differences

| Resource         | Staging          | Production        |
|------------------|------------------|-------------------|
| Fargate CPU/Mem  | 512 / 1024 MiB   | 1024 / 2048 MiB   |
| Desired count    | 1                | 2                 |
| RDS instance     | t4g.micro        | t4g.small         |
| RDS Multi-AZ     | No               | Yes               |
| Redis nodes      | 1                | 2 (failover)      |
| NAT Gateways     | 1                | 2                 |
| Log retention    | 7 days           | 30 days           |
| RDS removal      | DESTROY          | RETAIN            |

## Post-Deployment

After first deploy, update the `DATABASE_URL` secret in Secrets Manager with the actual connection string constructed from the RDS credentials:

```
postgresql://agentgate:<password>@<rds-endpoint>:5432/agentgate?sslmode=require
```

The `OIDC_CLIENT_SECRET` also needs to be manually set to your identity provider's client secret.

## Health Checks

- **ALB** → `GET /health` (HTTP 200)
- **ECS container** → `GET /ready` (readiness probe)
