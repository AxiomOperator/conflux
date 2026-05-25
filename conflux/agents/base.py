from __future__ import annotations

"""Base agent dataclass and exceptions."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentConfig:
    """Resolved agent configuration for a run."""

    agent_id: str
    name: str
    agent_type: str
    system_prompt: str
    model_policy: dict[str, Any]
    tool_allowlist: list[str]
    retrieval_tags: list[str]
    max_iterations: int = 20
    wiki_rag_enabled: bool = True


@dataclass
class RunContext:
    """Runtime context for an agent run."""

    run_id: str
    user_id: str | None
    session_id: str | None
    tenant_id: str | None
    project_id: str | None
    parent_run_id: str | None = None
    channel: str = "api"
    input_messages: list[dict[str, Any]] = field(default_factory=list)


class AgentError(Exception):
    def __init__(self, message: str, run_id: str | None = None):
        super().__init__(message)
        self.run_id = run_id


class MaxIterationsError(AgentError):
    pass


class ProviderNotFoundError(AgentError):
    pass
