"""AgentGate SDK types."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class Decision(str, Enum):
    """Approval decision values."""

    APPROVED = "approved"
    DENIED = "denied"
    PENDING = "pending"
    EXPIRED = "expired"


class Urgency(str, Enum):
    """Request urgency levels."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class FallbackBehavior(str, Enum):
    """Behavior when the server is unreachable."""

    ALLOW = "allow"
    DENY = "deny"


@dataclass
class ApprovalRequest:
    """An approval request returned by the API."""

    id: str
    action: str
    status: str
    decision: Optional[str] = None
    params: Dict[str, Any] = field(default_factory=dict)
    context: Dict[str, Any] = field(default_factory=dict)
    urgency: str = "normal"
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_response(cls, data: Dict[str, Any]) -> "ApprovalRequest":
        return cls(
            id=data.get("id", ""),
            action=data.get("action", ""),
            status=data.get("status", "pending"),
            decision=data.get("decision"),
            params=data.get("params", {}),
            context=data.get("context", {}),
            urgency=data.get("urgency", "normal"),
            decided_by=data.get("decidedBy"),
            decided_at=data.get("decidedAt"),
            expires_at=data.get("expiresAt"),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
            raw=data,
        )


@dataclass
class Policy:
    """A policy returned by the API."""

    id: str
    name: str
    rules: List[Dict[str, Any]] = field(default_factory=list)
    priority: int = 0
    enabled: bool = True
    raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_response(cls, data: Dict[str, Any]) -> "Policy":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            rules=data.get("rules", []),
            priority=data.get("priority", 0),
            enabled=data.get("enabled", True),
            raw=data,
        )


@dataclass
class DecisionResult:
    """Result of checking a decision."""

    id: str
    status: str
    decision: Optional[str] = None
    is_decided: bool = False

    @classmethod
    def from_response(cls, data: Dict[str, Any]) -> "DecisionResult":
        status = data.get("status", "pending")
        decision = data.get("decision")
        return cls(
            id=data.get("id", ""),
            status=status,
            decision=decision,
            is_decided=status in ("approved", "denied", "expired"),
        )
