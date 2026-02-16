# AgentGate Python SDK

Python client for [AgentGate](https://github.com/your-org/agentgate) — human-in-the-loop approval gates for AI agents.

## Installation

```bash
pip install agentgate-sdk
```

## Quick Start

### Async

```python
import asyncio
from agentgate import AgentGateClient

async def main():
    async with AgentGateClient(
        url="http://localhost:3000",
        api_key="your-api-key",
    ) as client:
        # Request approval
        req = await client.request_approval(
            "deploy",
            params={"env": "production", "service": "api"},
            urgency="high",
        )
        print(f"Request {req.id}: {req.status}")

        # Poll for decision
        result = await client.check_decision(req.id)
        if result.is_decided:
            print(f"Decision: {result.decision}")

        # List policies
        policies = await client.list_policies()
        for p in policies:
            print(f"  {p.name} (priority={p.priority})")

asyncio.run(main())
```

### Sync

```python
from agentgate import AgentGateClientSync

with AgentGateClientSync(api_key="your-api-key") as client:
    req = client.request_approval("deploy", params={"env": "prod"})
    result = client.check_decision(req.id)
    print(result.decision)
```

## Configuration

| Parameter | Env Var | Default |
|-----------|---------|---------|
| `url` | `AGENTGATE_URL` | `http://localhost:3000` |
| `api_key` | `AGENTGATE_API_KEY` | — |
| `timeout` | `AGENTGATE_TIMEOUT` | `10.0` |
| `fallback` | — | `"deny"` |

## Graceful Degradation

When AgentGate is unreachable, use `request_approval_safe()` to get a fallback response instead of an exception:

```python
client = AgentGateClient(fallback="allow")  # or "deny" (default)

# Returns synthetic approved/denied request on connection failure
req = await client.request_approval_safe("deploy")
```

## Retry Behavior

- **3 retries** with backoff: 0.5s → 1s → 2s
- Retries on: 500, 502, 503, 504, connection errors, timeouts
- **No retry** on: 400, 401, 403 (client errors)

## Development

```bash
cd sdk/python
pip install -e ".[dev]"
python -m pytest tests/ -v
```
