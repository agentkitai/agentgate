"""AgentGate async and sync HTTP clients.

Usage::

    async with AgentGateClient() as client:
        req = await client.request_approval(action="deploy", params={"env": "prod"})
        result = await client.check_decision(req.id)
        policies = await client.list_policies()
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:
    raise ImportError("httpx is required. Install with: pip install agentgate-sdk")

from agentgate.errors import AgentGateError
from agentgate.types import (
    ApprovalRequest,
    DecisionResult,
    FallbackBehavior,
    Policy,
    Urgency,
)

logger = logging.getLogger("agentgate.client")

_DEFAULT_URL = "http://localhost:3000"
_DEFAULT_TIMEOUT = 10.0
_RETRY_BACKOFFS = [0.5, 1.0, 2.0]
_RETRYABLE_STATUS = {500, 502, 503, 504}
_CLIENT_ERROR_STATUS = {400, 401, 403}


class AgentGateClient:
    """Async HTTP client for AgentGate API.

    Parameters:
        url: Base URL. Defaults to ``AGENTGATE_URL`` env var or ``http://localhost:3000``.
        api_key: API key for Bearer auth. Defaults to ``AGENTGATE_API_KEY`` env var.
        timeout: Request timeout in seconds. Defaults to ``AGENTGATE_TIMEOUT`` env var or 10.
        fallback: Behavior when server is unreachable: ``"deny"`` (default) or ``"allow"``.
        max_retries: Max retry attempts on 5xx/connection errors (default 3).
    """

    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: Optional[float] = None,
        fallback: FallbackBehavior | str = FallbackBehavior.DENY,
        max_retries: int = 3,
    ) -> None:
        self._url = (url or os.environ.get("AGENTGATE_URL", _DEFAULT_URL)).rstrip("/")
        self._api_key = api_key or os.environ.get("AGENTGATE_API_KEY", "")
        raw_timeout = timeout if timeout is not None else os.environ.get("AGENTGATE_TIMEOUT")
        self._timeout = float(raw_timeout) if raw_timeout is not None else _DEFAULT_TIMEOUT
        self._fallback = FallbackBehavior(fallback) if isinstance(fallback, str) else fallback
        self._max_retries = max_retries

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        self._http = httpx.AsyncClient(
            base_url=self._url,
            headers=headers,
            timeout=self._timeout,
        )

    async def __aenter__(self) -> "AgentGateClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._http.aclose()

    # ── Public API ────────────────────────────────────────────────────

    async def request_approval(
        self,
        action: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        urgency: Urgency | str = Urgency.NORMAL,
        expires_at: Optional[str] = None,
    ) -> ApprovalRequest:
        """Create an approval request.

        Args:
            action: The action requiring approval (e.g. ``"deploy"``).
            params: Parameters for the action.
            context: Additional context for policy evaluation.
            urgency: Urgency level (low/normal/high/critical).
            expires_at: ISO 8601 expiration timestamp.

        Returns:
            The created ApprovalRequest.

        Raises:
            AgentGateError: On API or connectivity error (unless graceful degradation applies).
        """
        body: Dict[str, Any] = {"action": action}
        if params:
            body["params"] = params
        if context:
            body["context"] = context
        body["urgency"] = urgency.value if isinstance(urgency, Urgency) else urgency
        if expires_at:
            body["expiresAt"] = expires_at

        data = await self._request("POST", "/api/requests", json_data=body)
        return ApprovalRequest.from_response(data)

    async def check_decision(self, request_id: str) -> DecisionResult:
        """Check the decision status of an approval request.

        Args:
            request_id: The approval request ID.

        Returns:
            DecisionResult with current status and decision.

        Raises:
            AgentGateError: On API or connectivity error.
        """
        data = await self._request("GET", f"/api/requests/{request_id}")
        return DecisionResult.from_response(data)

    async def list_policies(self) -> List[Policy]:
        """List all policies.

        Returns:
            List of Policy objects.

        Raises:
            AgentGateError: On API or connectivity error.
        """
        data = await self._request("GET", "/api/policies")
        if isinstance(data, list):
            return [Policy.from_response(p) for p in data]
        # Some APIs wrap in {"policies": [...]}
        policies = data.get("policies", data.get("data", []))
        return [Policy.from_response(p) for p in policies]

    async def request_approval_safe(
        self,
        action: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        urgency: Urgency | str = Urgency.NORMAL,
        expires_at: Optional[str] = None,
    ) -> ApprovalRequest:
        """Like :meth:`request_approval` but with graceful degradation.

        On connectivity failure, returns a synthetic ApprovalRequest with
        status based on the configured ``fallback`` behavior.
        """
        try:
            return await self.request_approval(
                action, params=params, context=context, urgency=urgency, expires_at=expires_at
            )
        except AgentGateError as exc:
            if exc.is_connectivity_error:
                return self._fallback_request(action, params, context)
            raise

    def _fallback_request(
        self,
        action: str,
        params: Optional[Dict[str, Any]],
        context: Optional[Dict[str, Any]],
    ) -> ApprovalRequest:
        """Create a synthetic fallback ApprovalRequest."""
        if self._fallback == FallbackBehavior.ALLOW:
            status = "approved"
            decision = "approved"
        else:
            status = "denied"
            decision = "denied"

        logger.warning(
            "AgentGate unreachable — returning fallback %s for action=%s",
            status,
            action,
        )
        return ApprovalRequest(
            id="fallback",
            action=action,
            status=status,
            decision=decision,
            params=params or {},
            context=context or {},
            raw={"_fallback": True},
        )

    # ── Internals ─────────────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_data: Optional[Any] = None,
    ) -> Any:
        """Make HTTP request with retry and error handling."""
        last_exc: Optional[Exception] = None
        backoffs = _RETRY_BACKOFFS[: self._max_retries]

        for attempt in range(1 + len(backoffs)):
            try:
                resp = await self._http.request(method, path, json=json_data)

                # Client errors: no retry
                if resp.status_code in _CLIENT_ERROR_STATUS:
                    data = resp.json()
                    error_info = data.get("error", {}) if isinstance(data, dict) else {}
                    raise AgentGateError(
                        error_info.get("message", f"HTTP {resp.status_code}"),
                        status_code=resp.status_code,
                        error_type=error_info.get("type"),
                        response_data=data,
                    )

                # Retryable server errors
                if resp.status_code in _RETRYABLE_STATUS and attempt < len(backoffs):
                    logger.warning(
                        "AgentGate returned %d (attempt %d/%d), retrying in %.1fs",
                        resp.status_code,
                        attempt + 1,
                        len(backoffs) + 1,
                        backoffs[attempt],
                    )
                    await asyncio.sleep(backoffs[attempt])
                    continue

                data = resp.json()

                if resp.status_code >= 400:
                    error_info = data.get("error", {}) if isinstance(data, dict) else {}
                    raise AgentGateError(
                        error_info.get("message", f"HTTP {resp.status_code}"),
                        status_code=resp.status_code,
                        error_type=error_info.get("type"),
                        response_data=data,
                    )

                return data

            except AgentGateError:
                raise
            except (httpx.ConnectError, httpx.TimeoutException, httpx.ConnectTimeout) as exc:
                last_exc = exc
                if attempt < len(backoffs):
                    logger.warning(
                        "AgentGate connection error (attempt %d/%d): %s, retrying in %.1fs",
                        attempt + 1,
                        len(backoffs) + 1,
                        exc,
                        backoffs[attempt],
                    )
                    await asyncio.sleep(backoffs[attempt])
                    continue
                raise AgentGateError(
                    f"Connection failed: {exc}",
                    is_connectivity_error=True,
                ) from exc
            except Exception as exc:
                raise AgentGateError(
                    f"Unexpected error: {exc}",
                    is_connectivity_error=True,
                ) from exc

        if last_exc:
            raise AgentGateError(
                f"Connection failed after retries: {last_exc}",
                is_connectivity_error=True,
            ) from last_exc
        raise RuntimeError("Retry loop exhausted unexpectedly")


class AgentGateClientSync:
    """Synchronous wrapper around AgentGateClient.

    Usage::

        client = AgentGateClientSync(api_key="sk-...")
        req = client.request_approval("deploy", params={"env": "prod"})
        result = client.check_decision(req.id)
        client.close()
    """

    def __init__(self, **kwargs: Any) -> None:
        self._async_client = AgentGateClient(**kwargs)

    def __enter__(self) -> "AgentGateClientSync":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._run(self._async_client.close())

    def request_approval(
        self,
        action: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        urgency: Urgency | str = Urgency.NORMAL,
        expires_at: Optional[str] = None,
    ) -> ApprovalRequest:
        """Create an approval request. See :meth:`AgentGateClient.request_approval`."""
        return self._run(
            self._async_client.request_approval(
                action, params=params, context=context, urgency=urgency, expires_at=expires_at
            )
        )

    def request_approval_safe(
        self,
        action: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        urgency: Urgency | str = Urgency.NORMAL,
        expires_at: Optional[str] = None,
    ) -> ApprovalRequest:
        """Graceful-degradation version. See :meth:`AgentGateClient.request_approval_safe`."""
        return self._run(
            self._async_client.request_approval_safe(
                action, params=params, context=context, urgency=urgency, expires_at=expires_at
            )
        )

    def check_decision(self, request_id: str) -> DecisionResult:
        """Check decision status. See :meth:`AgentGateClient.check_decision`."""
        return self._run(self._async_client.check_decision(request_id))

    def list_policies(self) -> List[Policy]:
        """List policies. See :meth:`AgentGateClient.list_policies`."""
        return self._run(self._async_client.list_policies())

    @staticmethod
    def _run(coro: Any) -> Any:
        """Run a coroutine, handling nested event loops."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result()
        else:
            return asyncio.run(coro)
