"""AgentGate SDK errors."""

from __future__ import annotations

from typing import Any, Dict, Optional


class AgentGateError(Exception):
    """Base error for AgentGate SDK operations."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        error_type: Optional[str] = None,
        response_data: Optional[Dict[str, Any]] = None,
        is_connectivity_error: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.response_data = response_data
        self.is_connectivity_error = is_connectivity_error
