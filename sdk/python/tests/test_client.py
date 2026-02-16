"""Tests for AgentGate SDK client."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentgate import (
    AgentGateClient,
    AgentGateClientSync,
    AgentGateError,
    FallbackBehavior,
)


BASE_URL = "http://localhost:3000"


# ── Async client tests ────────────────────────────────────────────────


@pytest.fixture
def client() -> AgentGateClient:
    return AgentGateClient(url=BASE_URL, api_key="test-key")


class TestRequestApproval:
    @respx.mock
    async def test_success(self, client: AgentGateClient) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "req_123",
                    "action": "deploy",
                    "status": "pending",
                    "params": {"env": "prod"},
                    "context": {},
                    "urgency": "normal",
                },
            )
        )

        req = await client.request_approval("deploy", params={"env": "prod"})
        assert req.id == "req_123"
        assert req.action == "deploy"
        assert req.status == "pending"
        assert req.params == {"env": "prod"}

    @respx.mock
    async def test_auto_approved(self, client: AgentGateClient) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "req_456",
                    "action": "read_file",
                    "status": "approved",
                    "decision": "approved",
                    "params": {},
                    "context": {},
                    "urgency": "low",
                },
            )
        )

        req = await client.request_approval("read_file", urgency="low")
        assert req.status == "approved"
        assert req.decision == "approved"


class TestCheckDecision:
    @respx.mock
    async def test_pending(self, client: AgentGateClient) -> None:
        respx.get(f"{BASE_URL}/api/requests/req_123").mock(
            return_value=httpx.Response(
                200,
                json={"id": "req_123", "action": "deploy", "status": "pending"},
            )
        )

        result = await client.check_decision("req_123")
        assert result.status == "pending"
        assert result.is_decided is False

    @respx.mock
    async def test_decided(self, client: AgentGateClient) -> None:
        respx.get(f"{BASE_URL}/api/requests/req_123").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "req_123",
                    "action": "deploy",
                    "status": "approved",
                    "decision": "approved",
                },
            )
        )

        result = await client.check_decision("req_123")
        assert result.status == "approved"
        assert result.decision == "approved"
        assert result.is_decided is True


class TestListPolicies:
    @respx.mock
    async def test_list(self, client: AgentGateClient) -> None:
        respx.get(f"{BASE_URL}/api/policies").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {"id": "pol_1", "name": "Auto-approve reads", "rules": [], "priority": 1, "enabled": True},
                    {"id": "pol_2", "name": "Deny deletes", "rules": [], "priority": 2, "enabled": True},
                ],
            )
        )

        policies = await client.list_policies()
        assert len(policies) == 2
        assert policies[0].name == "Auto-approve reads"


class TestRetry:
    @respx.mock
    async def test_retry_on_500(self, client: AgentGateClient) -> None:
        route = respx.get(f"{BASE_URL}/api/requests/req_1")
        route.side_effect = [
            httpx.Response(500, json={"error": "internal"}),
            httpx.Response(200, json={"id": "req_1", "action": "x", "status": "pending"}),
        ]

        result = await client.check_decision("req_1")
        assert result.id == "req_1"
        assert route.call_count == 2

    @respx.mock
    async def test_no_retry_on_401(self, client: AgentGateClient) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(401, json={"error": {"message": "Unauthorized"}})
        )

        with pytest.raises(AgentGateError) as exc_info:
            await client.request_approval("deploy")
        assert exc_info.value.status_code == 401

    @respx.mock
    async def test_no_retry_on_403(self, client: AgentGateClient) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(403, json={"error": {"message": "Forbidden"}})
        )

        with pytest.raises(AgentGateError) as exc_info:
            await client.request_approval("deploy")
        assert exc_info.value.status_code == 403

    @respx.mock
    async def test_retry_on_connection_error(self) -> None:
        client = AgentGateClient(url=BASE_URL, api_key="test", max_retries=1)
        route = respx.get(f"{BASE_URL}/api/requests/req_1")
        route.side_effect = [
            httpx.ConnectError("refused"),
            httpx.Response(200, json={"id": "req_1", "action": "x", "status": "pending"}),
        ]

        result = await client.check_decision("req_1")
        assert result.id == "req_1"
        assert route.call_count == 2


class TestGracefulDegradation:
    @respx.mock
    async def test_fallback_deny(self) -> None:
        client = AgentGateClient(url=BASE_URL, fallback="deny", max_retries=0)
        respx.post(f"{BASE_URL}/api/requests").mock(side_effect=httpx.ConnectError("refused"))

        req = await client.request_approval_safe("deploy")
        assert req.id == "fallback"
        assert req.status == "denied"
        assert req.decision == "denied"

    @respx.mock
    async def test_fallback_allow(self) -> None:
        client = AgentGateClient(url=BASE_URL, fallback="allow", max_retries=0)
        respx.post(f"{BASE_URL}/api/requests").mock(side_effect=httpx.ConnectError("refused"))

        req = await client.request_approval_safe("deploy")
        assert req.id == "fallback"
        assert req.status == "approved"
        assert req.decision == "approved"

    @respx.mock
    async def test_fallback_not_used_on_client_error(self) -> None:
        client = AgentGateClient(url=BASE_URL, fallback="allow", max_retries=0)
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(401, json={"error": {"message": "Unauthorized"}})
        )

        with pytest.raises(AgentGateError) as exc_info:
            await client.request_approval_safe("deploy")
        assert exc_info.value.status_code == 401


class TestEnvVars:
    def test_env_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGENTGATE_URL", "http://custom:9999")
        monkeypatch.setenv("AGENTGATE_API_KEY", "env-key")
        monkeypatch.setenv("AGENTGATE_TIMEOUT", "30")

        client = AgentGateClient()
        assert client._url == "http://custom:9999"
        assert client._api_key == "env-key"
        assert client._timeout == 30.0


# ── Sync client tests ─────────────────────────────────────────────────


class TestSyncClient:
    @respx.mock
    def test_request_approval(self) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "req_sync",
                    "action": "deploy",
                    "status": "pending",
                    "params": {},
                    "context": {},
                    "urgency": "normal",
                },
            )
        )

        with AgentGateClientSync(url=BASE_URL, api_key="test") as client:
            req = client.request_approval("deploy")
            assert req.id == "req_sync"

    @respx.mock
    def test_check_decision(self) -> None:
        respx.get(f"{BASE_URL}/api/requests/req_1").mock(
            return_value=httpx.Response(
                200,
                json={"id": "req_1", "action": "x", "status": "approved", "decision": "approved"},
            )
        )

        with AgentGateClientSync(url=BASE_URL, api_key="test") as client:
            result = client.check_decision("req_1")
            assert result.is_decided is True

    @respx.mock
    def test_list_policies(self) -> None:
        respx.get(f"{BASE_URL}/api/policies").mock(
            return_value=httpx.Response(
                200,
                json=[{"id": "p1", "name": "Test", "rules": [], "priority": 0, "enabled": True}],
            )
        )

        with AgentGateClientSync(url=BASE_URL, api_key="test") as client:
            policies = client.list_policies()
            assert len(policies) == 1

    @respx.mock
    def test_graceful_degradation(self) -> None:
        respx.post(f"{BASE_URL}/api/requests").mock(side_effect=httpx.ConnectError("refused"))

        with AgentGateClientSync(url=BASE_URL, fallback="allow", max_retries=0) as client:
            req = client.request_approval_safe("deploy")
            assert req.status == "approved"
